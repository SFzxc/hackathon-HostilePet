import type { EscalationLevel, PetAction, PetMood } from './outcome'

/**
 * The context package — the only thing the agent ever sees.
 *
 * `docs/agent.md` §2 lists what may be in it and what may not. Nothing here is page content:
 * a host, a category, counts and seconds. No URL with a query string, no page text, no tab or
 * document identifiers, no secrets. The event-log window arrives already redacted by
 * construction (`src/main/events/event-log.ts`).
 */
export type AgentFact = {
  site: string
  category: string
  label: string
  intensity: 'low' | 'normal' | 'high'
  qualifyingSeconds: number
  documents: number
}

export type AgentLogLine = {
  at: number
  kind: string
  site: string | null
  category: string | null
  detail: string
}

export type AgentContext = {
  locale: 'vi'
  nowIso: string
  localTime: string
  dayPart: 'morning' | 'afternoon' | 'evening' | 'night'
  level: EscalationLevel
  levelLabel: string
  /** Sites currently observed with time on them, longest first. */
  facts: AgentFact[]
  totals: {
    observedSeconds: number
    sites: number
    sessions: number
    turns: number
    minutesSinceLastLine: number | null
  }
  /** Recent event-log lines, newest last. This is what "analyse the logs" means. */
  recentLog: AgentLogLine[]
  /** The last few lines the pet said, so it does not repeat itself (`docs/tone.md` §5). */
  lastLines: string[]
  tone: { profile: 'roast' | 'blunt' | 'gentle'; intensity: 'low' | 'normal' | 'high' }
  allowed: { moods: readonly PetMood[]; actions: readonly PetAction[] }
  character: { name: string; look: string }
}
