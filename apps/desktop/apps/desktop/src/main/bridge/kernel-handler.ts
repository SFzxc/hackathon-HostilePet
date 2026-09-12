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
 * It does **not** call the model. It reports that a record was written, and the turn runner
 * alone decides when that becomes a turn — asking a model about every tick is how a companion
 * becomes a metronome (`docs/agent.md` §1 forbids triggering the agent on a scroll or a timer
 * tick).
 *
 * When no site catalog could be loaded there is no tracker and no classification, so signals are
 * dropped with a reason instead of being guessed at: an unclassifiable host is an absence, not
 * an `other` that a rule could act on. This is also why no threshold value appears below — every
 * number lives in `packs/site-catalog.json` (non-negotiable 1).
 */
function isSessionTick(payload: SignalPayload): payload is { schema: 'signal.session.tick@1'; data: SessionTick } {
  return payload.schema === 'signal.session.tick@1'
}

export function createKernelHandler(options: {
  catalog: SiteCatalog | null
  eventLog: EventLog
  /**
   * Called after an observation reaches the log, and only then — it fires on what was recorded,
   * not on every message the bridge received. The handler stays domain-agnostic: it reports
   * "a record was written", and what that means for the agent is the shell's business.
   */
  onRecorded?: () => void
  /**
   * How long one site waits between two `site.observed` records. The tracker accrues every tick
   * regardless — this only bounds how often that accrual becomes a log line, and so how often
   * the agent is nudged. The browser now ticks once a second, which makes this the first of the
   * three slower clocks; without it a fast transport would write a log line per second per site
   * and turn a resolution improvement into a flood.
   */
  observeThrottleMs?: number
  /** Handed to the tracker unchanged: how long a silent page still counts as being looked at. */
  presenceStaleMs?: number
  /** Handed to the tracker unchanged: how long a silent page keeps its accrued time. */
  pageStaleMs?: number
}): {
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
      options.onRecorded?.()
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
    options.onRecorded?.()
  }

  const tracker = catalog
    ? createSiteTracker(catalog, record, {
      observeThrottleMs: options.observeThrottleMs,
      presenceStaleMs: options.presenceStaleMs,
      pageStaleMs: options.pageStaleMs
    })
    : null

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
