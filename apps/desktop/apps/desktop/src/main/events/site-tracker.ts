import type { SessionTick } from '@hostile-pet/contracts'
import { classifySite, type SiteCatalog, type SiteClassification } from './site-catalog'

/**
 * Turns page-scoped ticks into per-**domain** observations.
 *
 * Two rules from `docs/architecture.md` §6 are kept here on purpose:
 *
 * 1. Only qualifying time counts — active tab, focused window, visible document, not idle.
 * 2. Two tabs of one site MUST NOT be added together: qualifying time is credited once, so a
 *    site's observed time is the **maximum** over its pages, never the sum. Summing is how a
 *    companion starts exaggerating what it saw.
 *
 * The tracker owns no policy of its own beyond the category threshold it reports; what to do
 * about a crossing is decided by the turn runner, and what the pet says is decided by the
 * agent.
 */
export type SiteObservation = SiteClassification & {
  qualifyingMs: number
  documents: number
  firstAt: number
  lastAt: number
}

export type ObserveReason = 'watch' | 'threshold' | 'disconnect'

export type TrackerRecord = { observation: SiteObservation; reason: ObserveReason }

export type TrackerTick = {
  connectionId: string
  documentId: string
  tick: SessionTick
  windowFocused: boolean
  at: number
}

export type TrackerSnapshot = {
  /** Longest single-page observed time across every site: the escalation input. */
  observedMs: number
  sessions: number
  sites: SiteObservation[]
  lastActivityAt: number | null
}

interface Page {
  connectionId: string
  documentId: string
  site: string
  qualifyingMs: number
  lastSeq: number
  firstAt: number
  lastAt: number
  announcedThreshold: boolean
  /** What this page's newest tick said about being looked at: visible, in the focused window. */
  present: boolean
}

export interface SiteTracker {
  accept(tick: TrackerTick): void
  dropConnection(connectionId: string): void
  snapshot(at?: number): TrackerSnapshot
  /**
   * The sites with a page the person is looking at right now.
   *
   * Each page's own newest tick is authoritative for that page, so a visible tab cannot keep a
   * hidden one present: presence is per page, never a global "a browser is open somewhere". A
   * page that goes hidden says so on its next tick, which is what lets the pet stop reacting to
   * a tab the person has left. A page that simply stops ticking — the tab was closed, and a
   * closed tab sends no usable goodbye — stops being present after `PRESENCE_STALE_MS`.
   */
  presentSites(at?: number): ReadonlySet<string>
}

/**
 * How long a page may stay silent and still count as being looked at.
 *
 * A page the person is looking at ticks about once a second, so this is many missed ticks rather
 * than a close call. It matters because a closed tab is never announced: the extension's
 * `pagehide` tick used to arrive claiming to be visible and focused, and even once that is fixed
 * the kernel should not depend on a dying document to report its own death.
 */
const PRESENCE_STALE_MS = 15_000

/**
 * How long a page may stay silent before it is forgotten entirely, accrued time and all.
 *
 * Longer than `PRESENCE_STALE_MS` because the two answer different questions. A hidden tab is
 * throttled to roughly one tick a minute, so a page silent for longer than this is not hidden —
 * it is gone, and keeping its qualifying time would let it go on feeding the escalation level
 * after the person left. Kept below the catalog's `decayAfterSeconds` (120 s) so that leaving a
 * site is what decays the level, rather than this sweep arriving first and doing it silently.
 */
const PAGE_STALE_MS = 90_000

export type SiteTrackerOptions = {
  observeThrottleMs?: number
  /**
   * How long a page that stopped talking still counts as being looked at. This is the whole of
   * "close the tab and the pet stops reacting": presence expiring is what drops the agent's face,
   * and a demo cannot wait the default quarter-minute to show it.
   */
  presenceStaleMs?: number
  /**
   * How long a silent page keeps its accrued time. Raised to `presenceStaleMs` when a caller
   * sets the two the wrong way round, because a page present at a moment its time has already
   * been forgotten would be a contradiction rather than a tuning mistake.
   */
  pageStaleMs?: number
}

export function createSiteTracker(
  catalog: SiteCatalog,
  onRecord: (record: TrackerRecord) => void,
  options: SiteTrackerOptions = {}
): SiteTracker {
  const observeThrottleMs = options.observeThrottleMs ?? 10_000
  const presenceStaleMs = options.presenceStaleMs ?? PRESENCE_STALE_MS
  const pageStaleMs = Math.max(presenceStaleMs, options.pageStaleMs ?? PAGE_STALE_MS)
  const pages = new Map<string, Page>()
  const lastEmit = new Map<string, number>()
  let lastActivityAt: number | null = null

  /**
   * The site's observed time is the max over its pages, never the sum (see the note above).
   *
   * The pages to read are the caller's business, not this function's. Ending a session has to
   * read figures from pages that are on their way out, and they cannot be read once they have
   * left `pages` — which is exactly how a session used to end with no record of its time.
   */
  function aggregate(site: string, considered: Iterable<Page>): SiteObservation | null {
    let found: SiteObservation | null = null
    for (const page of considered) {
      if (page.site !== site) continue
      const classification = classifySite(catalog, site)
      if (!found) {
        found = { ...classification, qualifyingMs: 0, documents: 0, firstAt: page.firstAt, lastAt: page.lastAt }
      }
      found.documents += 1
      found.qualifyingMs = Math.max(found.qualifyingMs, page.qualifyingMs)
      found.firstAt = Math.min(found.firstAt, page.firstAt)
      found.lastAt = Math.max(found.lastAt, page.lastAt)
    }
    return found
  }

  /** The pages still young enough to count, which is every page except the ones swept away. */
  function livePages(at: number): Page[] {
    return [...pages.values()].filter(page => at - page.lastAt <= pageStaleMs)
  }

  function observationFor(site: string, at: number): SiteObservation | null {
    return aggregate(site, livePages(at))
  }

  function emit(site: string, reason: ObserveReason, at: number): void {
    const observation = observationFor(site, at)
    if (!observation) return
    lastEmit.set(site, at)
    onRecord({ observation, reason })
  }

  /**
   * Forget pages that stopped talking, and report what they reached before they go.
   *
   * This runs on the write path rather than on read, so that painting a status or running a turn
   * can never be the thing that emits a record into the log. A tick arriving is also the only
   * proof that a page is still alive, which makes it the natural moment to look for the ones
   * that are not.
   */
  function sweep(at: number): void {
    const ending: Page[] = []
    for (const [key, page] of pages) {
      if (at - page.lastAt <= pageStaleMs) continue
      ending.push(page)
      pages.delete(key)
    }
    if (ending.length === 0) return
    // Read the figures from the pages that just ended, so the log closes a session with the time
    // it reached instead of leaving a dangling `watch` record behind.
    for (const site of new Set(ending.map(page => page.site))) {
      const observation = aggregate(site, ending)
      if (observation && observation.qualifyingMs > 0) onRecord({ observation, reason: 'disconnect' })
      if (!observationFor(site, at)) lastEmit.delete(site)
    }
  }

  return {
    accept({ connectionId, documentId, tick, windowFocused, at }) {
      sweep(at)
      // A tick with no site cannot be classified, and guessing one would be fabrication.
      if (!tick.site) return
      // A host the catalog does not list is ignored outright: no page, no accrued time, no
      // record, and no place in the agent's context. The catalog is the whole of what this build
      // watches, so "not listed" is an absence rather than a site to guess a category for — and
      // policing a site nobody opted into would be enforcement without a commitment
      // (non-negotiable 5). This returns before `lastActivityAt`, so time spent on an unlisted
      // site reads as silence and the ladder is free to decay through it.
      const classification = classifySite(catalog, tick.site)
      if (!classification.watched) return
      const key = `${connectionId}:${documentId}`
      const page = pages.get(key) ?? {
        connectionId,
        documentId,
        site: tick.site,
        qualifyingMs: 0,
        lastSeq: -1,
        firstAt: at,
        lastAt: at,
        announcedThreshold: false,
        present: false
      }
      // A counter that went backwards is a replay; it adds nothing and is not counted.
      if (tick.seq <= page.lastSeq) return
      page.lastSeq = tick.seq
      page.lastAt = at
      page.present = tick.visible && windowFocused
      page.qualifyingMs += tick.active && tick.visible && !tick.idle && windowFocused ? tick.activeMs : 0
      pages.set(key, page)
      lastActivityAt = at

      const hasThreshold = classification.thresholdMs > 0
      if (hasThreshold && !page.announcedThreshold && page.qualifyingMs >= classification.thresholdMs) {
        page.announcedThreshold = true
        emit(page.site, 'threshold', at)
        return
      }
      const previous = lastEmit.get(page.site)
      if (previous === undefined || at - previous >= observeThrottleMs) emit(page.site, 'watch', at)
    },

    dropConnection(connectionId) {
      const ending: Page[] = []
      for (const [key, page] of pages) {
        if (page.connectionId !== connectionId) continue
        ending.push(page)
        pages.delete(key)
      }
      // Report the site once more before its pages disappear, so the log ends a session with
      // the time it actually reached instead of leaving a dangling "watch" record. That figure
      // has to come from `ending`: `pages` no longer holds these, so reading it there is how
      // this record came out empty and the session ended silently.
      for (const site of new Set(ending.map(page => page.site))) {
        const observation = aggregate(site, ending)
        if (observation && observation.qualifyingMs > 0) onRecord({ observation, reason: 'disconnect' })
        lastEmit.delete(site)
      }
    },

    snapshot(at = Date.now()) {
      const sites: SiteObservation[] = []
      for (const site of new Set([...pages.values()].map(page => page.site))) {
        const observation = observationFor(site, at)
        if (observation && observation.qualifyingMs > 0) sites.push(observation)
      }
      sites.sort((a, b) => b.qualifyingMs - a.qualifyingMs)
      return {
        observedMs: sites[0]?.qualifyingMs ?? 0,
        sessions: sites.reduce((total, site) => total + site.documents, 0),
        sites,
        lastActivityAt
      }
    },

    presentSites(at = Date.now()) {
      const present = new Set<string>()
      for (const page of pages.values()) {
        // A page that went quiet is not in front of anyone, whatever its last tick claimed. This
        // is the whole of "closing the tab changes the pet" for a tab that never got to say
        // goodbye: presence expires here, the presenter drops the mood, and the Focus expression
        // underneath shows through on the next paint.
        if (page.present && at - page.lastAt <= presenceStaleMs) present.add(page.site)
      }
      return present
    }
  }
}
