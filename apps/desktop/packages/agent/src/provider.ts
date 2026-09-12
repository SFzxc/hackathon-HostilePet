import type { AgentContext } from './context'
import { bucketFor, FALLBACK_LINES } from './lines/vi'
import { escalationLadder, type PetDecision } from './outcome'

/**
 * Where the words come from.
 *
 * The turn runner does not care which provider it holds: it builds a context, asks, validates
 * and clamps. That is what makes "fake first, OpenAI later" a swap of one object and not a
 * rewrite of the loop (ADR 0006 decision 4).
 */
export interface AgentProvider {
  readonly id: 'fake' | 'openai'
  /** False for anything that is not a model, so provenance can never be overclaimed. */
  readonly isModel: boolean
  decide(context: AgentContext, retryReason?: string): Promise<PetDecision>
}

/** The version of the persona prompt a model turn would be assembled from (`docs/tone.md` §8). */
export const PROMPT_VERSION = 'persona-vi@2'

/**
 * Deterministic stand-in. It reads the same context a model would and picks a curated line for
 * the level and bucket, rotating so the demo does not repeat itself — but it analyses nothing,
 * and every turn it produces is labelled `fallback`.
 */
export function createFakeProvider(): AgentProvider {
  let turn = 0
  return {
    id: 'fake',
    isModel: false,
    async decide(context) {
      const level = context.level >= 1 ? (context.level as 1 | 2 | 3) : 1
      const bucket = bucketFor(context.facts[0]?.category ?? 'other')
      const lines = FALLBACK_LINES[level][bucket]
      const say = lines[turn % lines.length] ?? lines[0] ?? ''
      turn += 1
      const band = escalationLadder[context.level]
      return { say, mood: band.defaultMood, action: band.defaultAction }
    }
  }
}

/**
 * Provider selection. `HOSTILEPET_PROVIDER=openai` is recognised but not implemented: the key
 * belongs in Keychain (non-negotiable 8) and the model ID is still an open decision, so the
 * honest answer today is the fake provider plus a reason the UI can show. It never silently
 * pretends a model ran.
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env): { provider: AgentProvider; detail: string | null } {
  if (env.HOSTILEPET_PROVIDER === 'openai') {
    return {
      provider: createFakeProvider(),
      detail: 'OpenAI is selected but not implemented yet: the key would come from Keychain and the model ID is still open (ADR 0006). Using the curated fallback lines — no model ran.'
    }
  }
  return { provider: createFakeProvider(), detail: null }
}
