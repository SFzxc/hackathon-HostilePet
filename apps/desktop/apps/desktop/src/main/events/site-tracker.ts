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
}

export interface SiteTracker {
  accept(tick: TrackerTick): void
  dropConnection(connectionId: string): void
  snapshot(): TrackerSnapshot
}

export function createSiteTracker(
  catalog: SiteCatalog,
  onRecord: (record: TrackerRecord) => void,
  options: { observeThrottleMs?: number } = {}
): SiteTracker {
  const observeThrottleMs = options.observeThrottleMs ?? 10_000
  const pages = new Map<string, Page>()
  const lastEmit = new Map<string, number>()
  let lastActivityAt: number | null = null

  /** The site's observed time is the max over its pages, never the sum (see the note above). */
  function observationFor(site: string): SiteObservation | null {
    let found: SiteObservation | null = null
    for (const page of pages.values()) {
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

  function emit(site: string, reason: ObserveReason, at: number): void {
    const observation = observationFor(site)
    if (!observation) return
    lastEmit.set(site, at)
    onRecord({ observation, reason })
  }

  return {
    accept({ connectionId, documentId, tick, windowFocused, at }) {
      // A tick with no site cannot be classified, and guessing one would be fabrication.
      if (!tick.site) return
      const key = `${connectionId}:${documentId}`
      const page = pages.get(key) ?? {
        connectionId,
        documentId,
        site: tick.site,
        qualifyingMs: 0,
        lastSeq: -1,
        firstAt: at,
        lastAt: at,
        announcedThreshold: false
      }
      // A counter that went backwards is a replay; it adds nothing and is not counted.
      if (tick.seq <= page.lastSeq) return
      page.lastSeq = tick.seq
      page.lastAt = at
      page.qualifyingMs += tick.active && tick.visible && !tick.idle && windowFocused ? tick.activeMs : 0
      pages.set(key, page)
      lastActivityAt = at

      const classification = classifySite(catalog, page.site)
      const watched = classification.watched && classification.thresholdMs > 0
      if (watched && !page.announcedThreshold && page.qualifyingMs >= classification.thresholdMs) {
        page.announcedThreshold = true
        emit(page.site, 'threshold', at)
        return
      }
      const previous = lastEmit.get(page.site)
      if (previous === undefined || at - previous >= observeThrottleMs) emit(page.site, 'watch', at)
    },

    dropConnection(connectionId) {
      const affected = new Set<string>()
      for (const [key, page] of pages) {
        if (page.connectionId !== connectionId) continue
        affected.add(page.site)
        pages.delete(key)
      }
      // Report the site once more before its pages disappear, so the log ends a session with
      // the time it actually reached instead of leaving a dangling "watch" record.
      for (const site of affected) {
        const observation = observationFor(site)
        if (observation && observation.qualifyingMs > 0) onRecord({ observation, reason: 'disconnect' })
        lastEmit.delete(site)
      }
    },

    snapshot() {
      const sites: SiteObservation[] = []
      for (const site of new Set([...pages.values()].map(page => page.site))) {
        const observation = observationFor(site)
        if (observation && observation.qualifyingMs > 0) sites.push(observation)
      }
      sites.sort((a, b) => b.qualifyingMs - a.qualifyingMs)
      return {
        observedMs: sites[0]?.qualifyingMs ?? 0,
        sessions: sites.reduce((total, site) => total + site.documents, 0),
        sites,
        lastActivityAt
      }
    }
  }
}
