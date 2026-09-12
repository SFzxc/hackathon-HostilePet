import {
  escalationLadder,
  runTurn,
  type AgentContext,
  type AgentFact,
  type AgentLogLine,
  type AgentOutcome,
  type AgentProvider,
  type EscalationLevel
} from '@hostile-pet/agent'
import type { EventLog, EventLogRecord } from '../events/event-log'
import type { SiteCatalog } from '../events/site-catalog'
import type { SiteTracker } from '../events/site-tracker'

/**
 * When the agent runs, and with what.
 *
 * Two decisions live here, and both are the kernel's, not the model's:
 *
 * 1. **Cadence.** A turn is requested when a burst of observations goes quiet (`settleMs`,
 *    default 20 s), never on a tick, and never later than `maxWaitMs` after that burst opened
 *    however busy the stream stays. The old fixed 30–60 s timer remains as a slow backstop for
 *    a stream that stopped without ever opening a burst. The user's events are accumulated and
 *    logged continuously; the model is asked to look at the window, not at each scroll.
 * 2. **Level.** How forceful a turn may be comes from observed qualifying time on one page,
 *    compared against the catalog's ladder. The model chooses within the band it is given and
 *    cannot raise its own ceiling (`docs/agent.md` §4, non-negotiable 3).
 *
 * A turn is skipped, and logged as skipped in memory only, when nothing new happened: calling
 * a model about silence is how a companion becomes noise.
 */
export type TurnReport = {
  at: number
  level: EscalationLevel
  reason: 'turn' | 'no-activity' | 'too-soon' | 'no-catalog'
  outcome: AgentOutcome | null
  issues: string[]
  clamped: string[]
}

export type TurnRunner = {
  start(): void
  stop(): void
  /** Run one turn now, ignoring the cadence — used by the tray's "Ask now". */
  runNow(reason?: string): Promise<TurnReport>
  /**
   * Something was observed. Opens, or extends, the quiet window before the model is asked.
   *
   * Called from the kernel's record path rather than from every bridge message, so it fires on
   * what was actually logged: `site-tracker` already throttles its observations, and this
   * inherits that floor instead of inventing a second one.
   */
  notifyActivity(): void
  state(): {
    turns: number
    skipped: number
    thinking: boolean
    /** A turn is pending or in flight — what the pet wears as `review`. */
    reviewing: boolean
    level: EscalationLevel
    last: TurnReport | null
  }
  /** The level as of the last evaluation, without running a turn. */
  level(): EscalationLevel
}

export type TurnRunnerOptions = {
  catalog: SiteCatalog
  tracker: SiteTracker
  eventLog: EventLog
  provider: AgentProvider
  /** Applies one outcome to the pet. Returns what actually happened, for the log. */
  apply: (outcome: AgentOutcome, level: EscalationLevel, site: string | null) => { result: string; detail: string | null }
  intervalMs?: number
  /** Floor between two turns, so a manual "ask now" cannot become a loop. */
  minIntervalMs?: number
  /** Quiet time after the last observation before that burst is sent to the model. */
  settleMs?: number
  /**
   * The longest a burst may keep a turn waiting, however busy the stream stays.
   *
   * Without this the settle timer would be reset forever by a person who keeps browsing —
   * events arrive faster than `settleMs`, so a pure debounce would mean the model is never
   * asked at all. This is the guarantee that a turn happens; `settleMs` is only how long it
   * waits for the stream to go quiet first.
   */
  maxWaitMs?: number
  now?: () => number
  /** Plain-language provider note, surfaced in the UI. */
  providerDetail?: string | null
  onTurn?: (report: TurnReport) => void
}

const DEFAULT_INTERVAL_MS = 45_000
const DEFAULT_MIN_INTERVAL_MS = 30_000
const DEFAULT_SETTLE_MS = 20_000
const DEFAULT_MAX_WAIT_MS = 60_000
const LOG_WINDOW = 40

function dayPart(hour: number): AgentContext['dayPart'] {
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 23) return 'evening'
  return 'night'
}

/** Event-log lines as the model sees them: typed facts, no page data. */
function toLogLine(record: EventLogRecord): AgentLogLine {
  if (record.kind === 'site.observed' || record.kind === 'site.session') {
    return {
      at: record.at,
      kind: record.kind,
      site: record.site,
      category: record.category,
      detail: `${Math.round(record.qualifyingSeconds)}s observed, ${record.documents} page(s), ${record.reason}`
    }
  }
  if (record.kind === 'agent.turn') {
    return {
      at: record.at,
      kind: record.kind,
      site: record.site,
      category: record.category,
      detail: `level ${record.level}, ${record.action} → ${record.actionResult}${record.say ? `, said: ${record.say}` : ''}`
    }
  }
  return { at: record.at, kind: record.kind, site: null, category: null, detail: `${record.code}: ${record.detail}` }
}

export function createTurnRunner(options: TurnRunnerOptions): TurnRunner {
  const intervalMs = Math.max(30_000, Math.min(60_000, options.intervalMs ?? DEFAULT_INTERVAL_MS))
  const settleMs = Math.max(0, options.settleMs ?? DEFAULT_SETTLE_MS)
  const maxWaitMs = Math.max(settleMs, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS)
  // The settle window is itself the floor. A longer floor would silently swallow the trigger
  // the rest of this file advertises: a burst that settles at 20 s would be recorded as
  // `too-soon` and skipped, and the pet would look like it was ignoring the user.
  const minIntervalMs = options.minIntervalMs ?? Math.min(DEFAULT_MIN_INTERVAL_MS, settleMs)
  const now = options.now ?? (() => Date.now())
  const lastLines: string[] = []
  let lastTurnAt: number | null = null
  let lastAnalyzedAt: number | null = null
  let turns = 0
  let skipped = 0
  let thinking = false
  let lastReport: TurnReport | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let level: EscalationLevel = 0
  /** Settles the current burst: reset by every observation, so it fires on quiet. */
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  /** Caps the current burst: armed once and never reset, so a busy stream still gets a turn. */
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  /** Non-null while a burst is open. Its presence is what "reviewing" means. */
  let burstAt: number | null = null

  function clearBurst(): void {
    if (settleTimer) clearTimeout(settleTimer)
    if (maxTimer) clearTimeout(maxTimer)
    settleTimer = null
    maxTimer = null
    burstAt = null
  }

  /**
   * The burst settled, or ran out of patience: ask the model about it.
   *
   * The burst is closed *before* the turn starts, so the pet stops reviewing as soon as the
   * answer is applied rather than when the next burst begins — and so a turn that skips
   * (nothing new, or too soon) does not leave the pet stuck in `review` forever.
   */
  function fireBurst(): void {
    clearBurst()
    void run('activity').catch(() => {})
  }

  /**
   * The level, and the numbers it was read from. Only sites that are not marked as work can
   * escalate — the ladder is about distraction, and a work site is not evidence of one — and the
   * same figures go into the context, so the model's arithmetic and the kernel's agree.
   */
  function observe(snapshot: ReturnType<SiteTracker['snapshot']>, at: number): { level: EscalationLevel; observedSeconds: number; pages: number; idleSeconds: number; site: string | null } {
    const distractions = snapshot.sites.filter(site => site.intensity !== 'low')
    const observedSeconds = Math.max(0, ...distractions.map(site => site.qualifyingMs / 1000))
    const pages = distractions.reduce((total, site) => total + site.documents, 0)
    const idleSeconds = snapshot.lastActivityAt === null ? Number.POSITIVE_INFINITY : (at - snapshot.lastActivityAt) / 1000
    const ladder = options.catalog.escalation
    // `sites` is sorted by observed time, so the head is the site this turn is really about.
    // The pet wears the line while that site is still in front of the person and drops it when
    // they leave, which is why the turn has to say which site it was reacting to.
    const site = distractions[0]?.site ?? null

    // Decay before escalation: no qualifying activity for long enough drops one rung, so a
    // return to work is visible instead of the pet staying angry at a finished session.
    if (idleSeconds >= ladder.decayAfterSeconds) {
      level = Math.max(0, level - 1) as EscalationLevel
      return { level, observedSeconds, pages, idleSeconds, site }
    }
    if (observedSeconds >= ladder.hostileSeconds || pages >= 3) level = 3
    else if (observedSeconds >= ladder.concernedSeconds || pages >= 2) level = 2
    else if (observedSeconds >= ladder.watchSeconds || pages >= 1) level = 1
    return { level, observedSeconds, pages, idleSeconds, site }
  }

  async function run(reason: string): Promise<TurnReport> {
    const at = now()
    const snapshot = options.tracker.snapshot()
    const skip = (kind: TurnReport['reason']): TurnReport => {
      skipped += 1
      const report: TurnReport = { at, level, reason: kind, outcome: null, issues: [], clamped: [] }
      lastReport = report
      options.onTurn?.(report)
      return report
    }

    // Nothing observed at all: there is no evidence to analyse, so no turn is asked for.
    if (snapshot.lastActivityAt === null) return skip('no-activity')
    const hasNewActivity = lastAnalyzedAt === null || snapshot.lastActivityAt > lastAnalyzedAt
    if (!hasNewActivity && reason !== 'manual') return skip('no-activity')
    if (reason !== 'manual' && lastTurnAt !== null && at - lastTurnAt < minIntervalMs) return skip('too-soon')

    const observation = observe(snapshot, at)
    const band = escalationLadder[level]
    const previousTurnAt = lastTurnAt
    lastAnalyzedAt = snapshot.lastActivityAt
    lastTurnAt = at
    thinking = true

    const facts: AgentFact[] = snapshot.sites.map(site => ({
      site: site.site,
      category: site.category,
      label: site.label,
      intensity: site.intensity,
      qualifyingSeconds: Math.round(site.qualifyingMs / 1000),
      documents: site.documents
    }))
    const date = new Date(at)
    const context: AgentContext = {
      locale: 'vi',
      nowIso: date.toISOString(),
      localTime: date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      dayPart: dayPart(date.getHours()),
      level,
      levelLabel: band.label,
      facts,
      totals: {
        // The same figure the ladder was read from, so the model cannot contradict the kernel.
        observedSeconds: Math.round(observation.observedSeconds),
        sites: snapshot.sites.length,
        sessions: snapshot.sessions,
        turns,
        minutesSinceLastLine: previousTurnAt === null ? null : Math.round((at - previousTurnAt) / 60_000)
      },
      recentLog: options.eventLog.tail(LOG_WINDOW).map(toLogLine),
      lastLines: [...lastLines],
      tone: { profile: 'roast', intensity: band.toneIntensity },
      allowed: { moods: band.moods, actions: band.actions },
      // Placeholder character until a character pack exists (`docs/pet-visual-brief.md`).
      character: { name: 'HostilePet', look: 'a small geometric creature on the desktop' }
    }

    let report: TurnReport
    try {
      const result = await runTurn({ context, provider: options.provider })
      const applied = options.apply(result.outcome, level, observation.site)
      if (result.outcome.say.trim().length > 0) {
        lastLines.push(result.outcome.say)
        if (lastLines.length > 5) lastLines.shift()
      }
      turns += 1
      options.eventLog.append({
        at: now(),
        kind: 'agent.turn',
        level,
        provider: result.outcome.provider,
        source: result.outcome.source,
        promptVersion: result.outcome.promptVersion,
        site: facts[0]?.site ?? null,
        category: facts[0]?.category ?? null,
        say: result.outcome.say.trim().length > 0 ? result.outcome.say : null,
        mood: result.outcome.mood,
        action: result.outcome.action,
        actionResult: applied.detail ? `${applied.result}: ${applied.detail}` : applied.result,
        latencyMs: result.outcome.latencyMs
      })
      report = {
        at,
        level,
        reason: 'turn',
        outcome: result.outcome,
        issues: result.issues.map(issue => `${issue.check}: ${issue.detail}`),
        clamped: result.clamped
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'turn failed'
      options.eventLog.append({ at: now(), kind: 'agent.error', code: error instanceof Error ? error.name : 'UNKNOWN', detail: detail.slice(0, 200) })
      report = { at, level, reason: 'turn', outcome: null, issues: [detail], clamped: [] }
    } finally {
      thinking = false
    }

    lastReport = report
    options.onTurn?.(report)
    return report
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => {
        void run('interval').catch(() => {})
      }, intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      clearBurst()
      options.eventLog.flush()
    },
    notifyActivity() {
      const at = now()
      if (burstAt === null) {
        burstAt = at
        // Armed once, never reset: this is the promise that the burst is eventually sent.
        maxTimer = setTimeout(fireBurst, maxWaitMs)
        maxTimer.unref?.()
      } else if (settleTimer) {
        clearTimeout(settleTimer)
      }
      settleTimer = setTimeout(fireBurst, settleMs)
      settleTimer.unref?.()
    },
    runNow: reason => run(reason ?? 'manual'),
    // `burstAt !== null` covers the wait, `thinking` covers the call, and the two together are
    // the whole span the pet should be wearing `review`.
    state: () => ({ turns, skipped, thinking, reviewing: burstAt !== null || thinking, level, last: lastReport }),
    level: () => level
  }
}
