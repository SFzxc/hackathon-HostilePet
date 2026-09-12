import type { AgentContext } from './context'
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
 * One turn: `generate → clamp → validate → (fail) retry once with the reason → (fail) silence`
 * (`docs/tone.md` §6). Nothing in here decides *when* a turn happens — the turn runner does
 * that from observed time — and nothing in here changes a rule.
 *
 * The last rung is silence, not a stand-in line: the model owns every word the pet says, so a
 * turn that could not get one from a model changes the face and says nothing at all (ADR 0011).
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
  // records that no model produced this turn (`docs/tone.md` §6). There is no curated copy to
  // reach for, so the turn carries no line — `mood_only` is the one action that can be taken
  // without words, and taking a weaker action than the band allows is never a widening of it.
  const band = escalationLadder[context.level]
  const silent: PetDecision = { say: '', mood: band.defaultMood, action: 'mood_only' }
  return { outcome: outcome(silent, 'fallback'), issues, clamped, attempts: 3 }
}
