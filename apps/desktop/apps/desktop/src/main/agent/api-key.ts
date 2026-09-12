import { readOpenAiKey } from './keychain'

/**
 * The environment variable that may carry the model key.
 *
 * The Keychain is still the store this project would rather use, but `.env` already holds the
 * provider, the model and the endpoint, and requiring a `security add-generic-password` round
 * trip on every machine made the flag harder to try than it needed to be.
 * `docs/adr/0010-api-key-from-env.md` records the trade, and the Keychain is kept working.
 */
export const OPENAI_KEY_ENV = 'HOSTILEPET_OPENAI_API_KEY'

export type ApiKeySource = 'env' | 'keychain'

/**
 * `source` is part of the answer on purpose: Settings says where the key came from, so a run
 * that used a key somebody pasted into a file never reads as one that used the Keychain.
 */
export type ApiKeyLookup = { key: string | null; source: ApiKeySource | null; detail: string | null }

/**
 * The key, from the environment first and the login Keychain second.
 *
 * The environment wins because it is the one a developer can change without touching Keychain;
 * the Keychain stays the fallback so a machine that already stores the key keeps working with no
 * `.env` at all. An empty or whitespace-only value counts as absent, so a bare
 * `HOSTILEPET_OPENAI_API_KEY=` falls through instead of sending an empty bearer token.
 *
 * The value is returned to the caller and goes straight to the provider. It is never logged,
 * never written to the event log, and never sent to a window.
 */
export function resolveOpenAiKey(env: NodeJS.ProcessEnv = process.env): ApiKeyLookup {
  const fromEnv = (env[OPENAI_KEY_ENV] ?? '').trim()
  if (fromEnv.length > 0) return { key: fromEnv, source: 'env', detail: null }

  const keychain = readOpenAiKey()
  if (keychain.key !== null) return { key: keychain.key, source: 'keychain', detail: null }

  return {
    key: null,
    source: null,
    detail: `${keychain.detail ?? 'No API key was found.'} Or set ${OPENAI_KEY_ENV} in .env.`
  }
}
