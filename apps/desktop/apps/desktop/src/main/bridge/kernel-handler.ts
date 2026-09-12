import type { DeclaredSensor, SessionTick, SignalMessage, SignalPayload } from '@hostile-pet/contracts'
import type { EventLog } from '../events/event-log'
import { isDemoCatalog, type SiteCatalog } from '../events/site-catalog'
import { createSiteTracker, type SiteTracker, type TrackerRecord } from '../events/site-tracker'
import type { BridgeHandler, HandlerContext } from './types'

/**
 * The handler behind the bridge: the desktop's real front door for browser events.
 *
 * It does exactly two things with a signal, and deliberately not a third:
 *
 * 1. **Accumulate** qualifying time per domain (`site-tracker`), which is deterministic.
 * 2. **Log** what was observed, redacted, into the event log.
 *
 * It does **not** call the model. Turns are requested by the turn runner on a 30–60 s cadence,
 * from the accumulated picture — asking a model about every tick is how a companion becomes a
 * metronome (`docs/agent.md` §1 forbids triggering the agent on a scroll or a timer tick).
 *
 * When no site catalog could be loaded there is no tracker and no classification, so signals are
 * dropped with a reason instead of being guessed at: an unclassifiable host is an absence, not
 * an `other` that a rule could act on. This is also why no threshold value appears below — every
 * number lives in `packs/site-catalog.json` (non-negotiable 1).
 */
function isSessionTick(payload: SignalPayload): payload is { schema: 'signal.session.tick@1'; data: SessionTick } {
  return payload.schema === 'signal.session.tick@1'
}

export function createKernelHandler(options: { catalog: SiteCatalog | null; eventLog: EventLog }): {
  handler: BridgeHandler
  tracker: SiteTracker | null
} {
  const { catalog, eventLog } = options
  const demoMode = catalog !== null && isDemoCatalog(catalog)

  /** Event-log lines, redacted by construction: host, category, counts. No page data. */
  function record({ observation, reason }: TrackerRecord): void {
    const at = Date.now()
    if (reason === 'disconnect') {
      eventLog.append({
        at,
        kind: 'site.session',
        site: observation.site,
        category: observation.category,
        qualifyingSeconds: Math.round(observation.qualifyingMs / 1000),
        documents: observation.documents,
        reason: 'disconnect'
      })
      return
    }
    eventLog.append({
      at,
      kind: 'site.observed',
      site: observation.site,
      category: observation.category,
      qualifyingSeconds: Math.round(observation.qualifyingMs / 1000),
      documents: observation.documents,
      reason,
      // The badge follows the fact: it is true exactly when a lowered threshold is what put
      // this observation in the log (`docs/hackathon.md` §4).
      demoMode: demoMode && observation.qualifyingMs >= catalog.escalation.watchSeconds * 1000
    })
  }

  const tracker = catalog ? createSiteTracker(catalog, record) : null

  const handler: BridgeHandler = {
    id: 'kernel',

    onSignal(message: SignalMessage, sensor: DeclaredSensor, payload: SignalPayload, ctx: HandlerContext) {
      if (!isSessionTick(payload)) {
        ctx.log({
          event: 'bridge.signal.dropped',
          connectionId: ctx.connectionId,
          signal: message.type,
          reason: 'unhandled_schema',
          detail: `${sensor.packId} declared a schema this handler does not read`
        })
        return
      }
      if (!tracker) {
        ctx.log({
          event: 'bridge.signal.dropped',
          connectionId: ctx.connectionId,
          signal: message.type,
          reason: 'no_catalog',
          detail: 'no site catalog is loaded, so a host cannot be classified'
        })
        return
      }
      tracker.accept({
        connectionId: ctx.connectionId,
        documentId: message.context.documentId,
        tick: payload.data,
        windowFocused: message.context.windowFocused,
        at: ctx.now()
      })
    },

    onDisconnected(connectionId: string) {
      tracker?.dropConnection(connectionId)
    }
  }

  return { handler, tracker }
}
