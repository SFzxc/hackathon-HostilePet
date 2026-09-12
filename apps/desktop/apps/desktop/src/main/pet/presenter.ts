import { Notification } from 'electron'
import type { AgentOutcome } from '@hostile-pet/agent'
import type { PetExpression } from '../../shared/desktop'

/**
 * Applies one agent outcome to the pet: the face, the bubble, and — only from the level that
 * permits it — a desktop notification.
 *
 * The presenter is the only place a line becomes visible, which is what keeps the honesty
 * rules checkable in one file: a line always carries its provenance, a fallback says it is a
 * fallback, and every line can be dismissed. It never decides *whether* to speak — the kernel
 * and the validator already did.
 */
export type PetLine = {
  say: string | null
  mood: PetExpression
  action: AgentOutcome['action']
  source: 'model' | 'fallback'
  level: number
  at: number
  /** Shown next to the line so a stand-in is never mistaken for generated copy. */
  badge: string | null
  /** The site this line was about, or null when it was not about any one site. */
  site: string | null
}

export type ApplyResult = { result: string; detail: string | null }

export interface Presenter {
  present(outcome: AgentOutcome, level: number, site?: string | null): ApplyResult
  current(at?: number): PetLine | null
  /** What the pet wears because of the agent, or null when the agent has nothing to say. */
  expression(at?: number, present?: ReadonlySet<string>): PetExpression | null
  dismiss(): void
}

export function createPresenter(options: { lineTtlMs?: number; onChange?: () => void; notify?: boolean } = {}): Presenter {
  const lineTtlMs = options.lineTtlMs ?? 60_000
  const wantsNotification = options.notify ?? true
  let line: PetLine | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearLater(): void {
    if (timer) clearTimeout(timer)
    const at = line?.at ?? 0
    timer = setTimeout(() => {
      // Only the line that scheduled this expiry may clear itself.
      if (line && line.at === at) {
        line = null
        options.onChange?.()
      }
    }, lineTtlMs)
    timer.unref?.()
  }

  function accept(line_: PetLine | null): void {
    line = line_
    if (line) clearLater()
    options.onChange?.()
  }

  return {
    present(outcome, level, site = null) {
      // `none` is a decision to do nothing at all: no face change, no line, no notification.
      if (outcome.action === 'none') return { result: 'none', detail: null }
      const say = outcome.say.trim().length > 0 ? outcome.say.trim() : null
      const next: PetLine = {
        say,
        mood: outcome.mood,
        action: outcome.action,
        source: outcome.source,
        level,
        at: Date.now(),
        badge: outcome.source === 'fallback' ? 'fallback' : null,
        site
      }
      accept(next)
      if (outcome.action !== 'notify') return { result: say ? 'bubble' : 'mood', detail: null }
      if (!wantsNotification) return { result: 'bubble', detail: 'notifications disabled' }
      try {
        if (!Notification.isSupported()) return { result: 'bubble', detail: 'notifications unsupported on this system' }
        new Notification({ title: 'HostilePet', body: say ?? 'Quay lại việc đi.', silent: true }).show()
        return { result: 'notify', detail: null }
      } catch (error) {
        // A refused notification must not swallow the line: the bubble already went out.
        return { result: 'bubble', detail: `notification failed (${error instanceof Error ? error.name : 'unknown'})` }
      }
    },
    current(at = Date.now()) {
      if (!line) return null
      return at - line.at > lineTtlMs ? null : line
    },
    /**
     * The face the agent earned, for as long as it still means something.
     *
     * A line about a site stops being true about the room the moment the person leaves that
     * site: the pet would be pulling a face at a tab nobody is looking at, for the rest of the
     * TTL. Dropping it here rather than shortening the TTL keeps the line's own lifetime intact
     * for the bubble, and a line that was about no particular site keeps its full TTL because
     * nothing about it has stopped being true.
     */
    expression(at = Date.now(), present) {
      const current = this.current(at)
      if (!current) return null
      if (current.site !== null && present && !present.has(current.site)) return null
      return current.mood
    },
    dismiss() {
      if (timer) clearTimeout(timer)
      timer = null
      accept(null)
    }
  }
}
