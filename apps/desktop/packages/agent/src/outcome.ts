import { z } from 'zod'

/**
 * The output contract for one turn: **one message and one action**.
 *
 * The model proposes; policy clamps (`clampDecision`). Nothing here can enable, widen or
 * disable a rule — `docs/agent.md` §4, non-negotiable 3.
 */
export const petMoodSchema = z.enum(['idle', 'thinking', 'suspicious', 'intervene', 'pleased'])
export type PetMood = z.infer<typeof petMoodSchema>

export const petActionSchema = z.enum(['say_bubble', 'mood_only', 'notify', 'none'])
export type PetAction = z.infer<typeof petActionSchema>

export const petDecisionSchema = z
  .object({
    /** One line, Vietnamese, ≤ 160 characters. */
    say: z.string().max(160),
    mood: petMoodSchema,
    action: petActionSchema
  })
  .strict()

export type PetDecision = z.infer<typeof petDecisionSchema>

/**
 * Provenance is stamped by the runtime, never by the source that produced the words: a model
 * does not get to declare that a fallback line was model-generated (`docs/tone.md` §6).
 */
export const agentOutcomeSchema = petDecisionSchema.extend({
  source: z.enum(['model', 'fallback']),
  provider: z.string().min(1).max(32),
  promptVersion: z.string().min(1).max(64).nullable(),
  latencyMs: z.number().nonnegative()
})

export type AgentOutcome = z.infer<typeof agentOutcomeSchema>

export type EscalationLevel = 0 | 1 | 2 | 3

/**
 * What each escalation level permits. The ladder is deterministic and lives here rather than
 * in the prompt, so the strongest thing a turn can do is decided by observed time, not by the
 * model's mood. `maxLevelFor` in the turn runner decides which rung applies.
 */
export const escalationLadder: Record<EscalationLevel, {
  label: string
  toneIntensity: 'low' | 'normal' | 'high'
  moods: readonly PetMood[]
  actions: readonly PetAction[]
  defaultMood: PetMood
  defaultAction: PetAction
}> = {
  0: { label: 'quiet', toneIntensity: 'low', moods: ['idle', 'thinking', 'pleased'], actions: ['none', 'mood_only'], defaultMood: 'idle', defaultAction: 'none' },
  1: { label: 'noticed', toneIntensity: 'low', moods: ['idle', 'thinking', 'suspicious', 'pleased'], actions: ['say_bubble', 'mood_only', 'none'], defaultMood: 'suspicious', defaultAction: 'say_bubble' },
  2: { label: 'concerned', toneIntensity: 'normal', moods: ['thinking', 'suspicious', 'intervene'], actions: ['say_bubble', 'mood_only', 'notify'], defaultMood: 'suspicious', defaultAction: 'say_bubble' },
  3: { label: 'hostile', toneIntensity: 'high', moods: ['suspicious', 'intervene'], actions: ['notify', 'say_bubble'], defaultMood: 'intervene', defaultAction: 'notify' }
}

/**
 * Policy clamp: an out-of-band proposal is downgraded, not obeyed and not silently dropped.
 * The caller logs what was clamped, so "the pet went quiet" is never mistaken for a decision
 * the model made.
 */
export function clampDecision(decision: PetDecision, level: EscalationLevel): { decision: PetDecision; clamped: string[] } {
  const band = escalationLadder[level]
  const clamped: string[] = []
  let mood = decision.mood
  let action = decision.action
  if (!band.moods.includes(mood)) {
    clamped.push(`mood:${mood}`)
    mood = band.defaultMood
  }
  if (!band.actions.includes(action)) {
    clamped.push(`action:${action}`)
    action = band.defaultAction
  }
  return { decision: { ...decision, mood, action }, clamped }
}
