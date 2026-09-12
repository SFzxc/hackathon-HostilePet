import type { AgentContext } from './context'
import { bucketFor, FALLBACK_LINES } from './lines/vi'
import {
  agentOutcomeSchema,
  clampDecision,
  escalationLadder,
  petDecisionSchema,
  type AgentOutcome,
  type PetDecision
} from './outcome'
import type { AgentProvider } from './provider'
import { PROMPT_VERSION } from './provider'
import { validateDecision, type ValidationIssue } from './validate'

/**
 * One turn: `generate → clamp → validate → (fail) retry once with the reason → (fail) fallback`
 * (`docs/tone.md` §6). Nothing in here decides *when* a turn happens — the turn runner does
 * that from observed time — and nothing in here changes a rule.
 */
export type TurnResult = {
  outcome: AgentOutcome
  issues: ValidationIssue[]
  clamped: string[]
  attempts: number
}

function describe(issues: ValidationIssue[]): string {
  return issues.map(issue => `${issue.check}: ${issue.detail}`).join('; ')
}

/** The curated line for this level and site kind. Used when the provider fails twice. */
export function fallbackDecision(context: AgentContext): PetDecision {
  const band = escalationLadder[context.level]
  const level = context.level >= 1 ? (context.level as 1 | 2 | 3) : 1
  const lines = FALLBACK_LINES[level][bucketFor(context.facts[0]?.category ?? 'other')]
  return { say: lines[0] ?? '', mood: band.defaultMood, action: band.defaultAction }
}

export async function runTurn({ context, provider }: { context: AgentContext; provider: AgentProvider }): Promise<TurnResult> {
  const startedAt = Date.now()
  let issues: ValidationIssue[] = []
  let clamped: string[] = []

  const outcome = (decision: PetDecision, source: 'model' | 'fallback'): AgentOutcome =>
    agentOutcomeSchema.parse({
      ...decision,
      source,
      provider: provider.id,
      // A prompt version only means something when a prompt was actually sent.
      promptVersion: provider.isModel ? PROMPT_VERSION : null,
      latencyMs: Date.now() - startedAt
    })

  for (let attempt = 1; attempt <= 2; attempt++) {
    let proposed: PetDecision
    try {
      proposed = petDecisionSchema.parse(await provider.decide(context, attempt === 1 ? undefined : describe(issues)))
    } catch (error) {
      issues = [{ check: 'provider', detail: error instanceof Error ? error.message : 'provider failed' }]
      continue
    }
    const clamp = clampDecision(proposed, context.level)
    clamped = clamp.clamped
    issues = validateDecision(clamp.decision, context)
    if (issues.length === 0) return { outcome: outcome(clamp.decision, provider.isModel ? 'model' : 'fallback'), issues, clamped, attempts: attempt }
  }

  // The intervention is never blocked by bad copy: the pet still changes face, and the log
  // records that the line came from a fallback (`docs/tone.md` §6).
  const fallback = fallbackDecision(context)
  const remaining = validateDecision(fallback, context)
  if (remaining.length > 0) {
    const band = escalationLadder[context.level]
    const silent: PetDecision = { say: '', mood: band.defaultMood, action: 'mood_only' }
    return { outcome: outcome(silent, 'fallback'), issues: [...issues, ...remaining], clamped, attempts: 3 }
  }
  return { outcome: outcome(fallback, 'fallback'), issues, clamped, attempts: 3 }
}
