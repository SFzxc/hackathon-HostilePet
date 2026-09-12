import { execFileSync } from 'node:child_process'

/**
 * The one secret this build has, and the only place it is read from: the login Keychain
 * (non-negotiable 8). It is never written to `state.json`, never logged, never sent to the
 * renderer — `readKey` returns it to the caller and the caller hands it straight to the provider.
 *
 * Store one with:
 *   security add-generic-password -s hostilepet.openai -a "$USER" -w
 */
export const OPENAI_KEY_SERVICE = 'hostilepet.openai'

export const keySetupCommand = `security add-generic-password -s ${OPENAI_KEY_SERVICE} -a "$USER" -w`

export type KeyLookup = { key: string | null; detail: string | null }

export function readOpenAiKey(): KeyLookup {
  try {
    const value = execFileSync('security', ['find-generic-password', '-s', OPENAI_KEY_SERVICE, '-w'], {
      encoding: 'utf8',
      timeout: 2000,
      // stderr is dropped on purpose: it can name the item, and there is nothing useful in it.
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (value.length === 0) {
      return { key: null, detail: `The Keychain item "${OPENAI_KEY_SERVICE}" is empty. Store a key with: ${keySetupCommand}` }
    }
    return { key: value, detail: null }
  } catch {
    return { key: null, detail: `No API key in Keychain under "${OPENAI_KEY_SERVICE}". Store one with: ${keySetupCommand}` }
  }
}
