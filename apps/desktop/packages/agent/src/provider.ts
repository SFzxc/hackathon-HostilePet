import type { AgentContext } from './context'
import { escalationLadder, petDecisionSchema, type PetDecision } from './outcome'
import { buildPersonaPrompt } from './prompt'

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

/** The version of the persona prompt a model turn is assembled from (`docs/tone.md` §8). */
export const PROMPT_VERSION = 'persona-vi@3'

/** The model this build calls. Overridable with `HOSTILEPET_MODEL`; ADR 0006 records the choice. */
export const DEFAULT_MODEL = 'gpt-5.6-luna'
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * The stand-in for a run with no model behind it. It reads the same context a model would and
 * picks the face that context earns — but it owns no words, so it never speaks: the model owns
 * every line the pet says, and a stand-in has none of its own (ADR 0011). Every turn it
 * produces is stamped `source: 'fallback'`, and every one of them reaches the user as a face
 * and an event-log record, not a sentence.
 */
export function createFakeProvider(): AgentProvider {
  return {
    id: 'fake',
    isModel: false,
    async decide(context) {
      const band = escalationLadder[context.level]
      // `mood_only` is the one action in every band that carries no words; `notify` and
      // `say_bubble` would need a line this provider does not have.
      return { say: '', mood: band.defaultMood, action: 'mood_only' }
    }
  }
}

export type OpenAiProviderOptions = {
  /** Read from the environment or the login Keychain by the caller. Never logged, never persisted. */
  apiKey: string
  model?: string
  baseUrl?: string
  /** The runtime persona artifact with its placeholders still unresolved (`prompts/persona.md`). */
  personaTemplate: string
  timeoutMs?: number
  /** Injected so the request can be exercised without a network (`scripts/agent-check.cjs`). */
  fetchImpl?: typeof fetch
}

/** A model answer, whether it came wrapped in a code fence or as bare JSON. */
function parseDecision(content: string): PetDecision {
  const stripped = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('model did not answer with JSON')
  const raw: unknown = JSON.parse(stripped.slice(start, end + 1))
  if (raw === null || typeof raw !== 'object') throw new Error('model answer was not an object')
  const record = raw as Record<string, unknown>
  // The artifact also describes the future tool contract. Until tools exist, a model that answers
  // in that shape is read as "speak this line", never as permission to do something.
  const say = typeof record.say === 'string' ? record.say : ''
  const action = typeof record.action === 'string' ? record.action : say.trim().length > 0 ? 'say_bubble' : 'mood_only'
  return petDecisionSchema.parse({ say, mood: record.mood, action })
}

function trim(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * The real provider: one chat completion per turn, JSON out, no tools.
 *
 * Every failure mode — no network, a 401, a timeout, prose instead of JSON — throws, and the
 * turn ends without a line: the pet changes face and the log records what went wrong
 * (`docs/tone.md` §6). There is no stand-in copy to hide an outage behind, so Settings is where
 * a person finds out the model did not answer (ADR 0011).
 */
export function createOpenAiProvider(options: OpenAiProviderOptions): AgentProvider {
  const model = options.model ?? DEFAULT_MODEL
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? 12_000
  const doFetch = options.fetchImpl ?? fetch

  return {
    id: 'openai',
    isModel: true,
    async decide(context, retryReason) {
      const prompt = buildPersonaPrompt(options.personaTemplate, context, retryReason)
      let response: Response
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ],
            // The artifact already says "only JSON"; this makes the API enforce it.
            response_format: { type: 'json_object' }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'request failed'
        throw new Error(`${model}: ${detail}`)
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`${model} answered ${response.status}${body ? `: ${trim(body)}` : ''}`)
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim().length === 0) throw new Error(`${model} returned no content`)
      return parseDecision(content)
    }
  }
}

export type ProviderSetup = {
  /** The persona artifact, or null when it could not be read. */
  personaTemplate: string | null
  /** The model key from the environment or the Keychain, or null when neither has one. */
  apiKey: string | null
  /**
   * Where the key came from. Provenance is shown, not guessed: a run that used a key pasted into
   * `.env` must not read as one that used the Keychain (ADR 0010).
   */
  keySource?: 'env' | 'keychain' | null
  model?: string
  baseUrl?: string
  /** Plain-language reason the key or artifact is missing, shown in the UI. */
  detail?: string | null
}

/**
 * Provider selection. `HOSTILEPET_PROVIDER=openai` calls the model; anything missing — no key in
 * the environment or the Keychain, no readable persona artifact — falls back to the provider
 * that has no words **and says why**. It never silently pretends a model ran.
 */
export function createProvider(
  env: NodeJS.ProcessEnv = process.env,
  setup: ProviderSetup = { personaTemplate: null, apiKey: null }
): { provider: AgentProvider; detail: string | null } {
  if (env.HOSTILEPET_PROVIDER !== 'openai') return { provider: createFakeProvider(), detail: null }

  const model = env.HOSTILEPET_MODEL ?? setup.model ?? DEFAULT_MODEL
  if (setup.apiKey === null || setup.apiKey.trim().length === 0) {
    return {
      provider: createFakeProvider(),
      detail: `${setup.detail ?? 'OpenAI is selected but no API key was found in the environment or the Keychain.'} No model ran, so the pet has no lines to say.`
    }
  }
  if (setup.personaTemplate === null) {
    return {
      provider: createFakeProvider(),
      detail: `${setup.detail ?? `OpenAI is selected but the persona artifact (prompts/persona.md) could not be read (${PROMPT_VERSION}).`} No model ran, so the pet has no lines to say.`
    }
  }
  return {
    provider: createOpenAiProvider({
      apiKey: setup.apiKey,
      model,
      baseUrl: env.HOSTILEPET_OPENAI_BASE_URL ?? setup.baseUrl,
      personaTemplate: setup.personaTemplate
    }),
    detail: `${model} · ${PROMPT_VERSION} · key from ${setup.keySource === 'keychain' ? 'Keychain' : 'env'}`
  }
}
