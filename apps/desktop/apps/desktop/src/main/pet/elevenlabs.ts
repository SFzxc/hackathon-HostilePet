/**
 * ElevenLabs text to speech.
 *
 * Synthesized in the main process so the API key never reaches a window: the renderer receives
 * MP3 bytes and nothing else (`docs/agent.md` §2).
 *
 * Every knob is an env override with a pinned default, because the voice is content — the demo
 * has to sound the same on a machine whose `.env` nobody edited, and tuning it must not need a
 * rebuild. Values are clamped to the ranges the API actually enforces instead of being passed
 * through: `ELEVENLAB_SPEED=abc` should fall back to the default, and a value one digit outside
 * the range should be pulled back, not mute the pet with a rejected call.
 */

export type SpeechSettings = {
  voiceId: string
  modelId: string
  /** Forced language for the turbo/flash models; `null` leaves the API to auto-detect. */
  languageCode: string | null
  speed: number
  stability: number
  similarityBoost: number
  style: number
  useSpeakerBoost: boolean
}

/**
 * The pet's voice as it ships. `eleven_flash_v2_5` is the low-latency model, which is what a
 * one-line quip needs; `speed 1.1` keeps a nag from dragging and `stability 0.45` leaves enough
 * variation that the same complaint does not land identically twice.
 *
 * The voice is the premade `George`, because a **library** voice is refused through the API on a
 * free plan — measured, not assumed: `eGSd0uV8dNQnZuEEX9lu` answers 402 `paid_plan_required`
 * ("Free users cannot use library voices via the API"). A paid plan turns that back into a
 * one-line `.env` change, and nothing else in this file moves.
 */
export const SPEECH_DEFAULTS = {
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',
  modelId: 'eleven_flash_v2_5',
  speed: 1.1,
  stability: 0.45,
  similarityBoost: 0.8,
  style: 0.2,
  useSpeakerBoost: true
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A number from the environment, or the default when it is absent or not a number. */
function numeric(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback
}

/** Absent means the default; `false`, `0`, `no` and `off` are the ways to say off. */
function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return !['false', '0', 'no', 'off'].includes(raw)
}

/**
 * `language_code` is only accepted by the turbo/flash v2.5 models. On those the pet pins `vi`:
 * its lines are one short sentence, which is exactly where auto-detect picks the wrong language.
 * Anywhere else the field is left out rather than sent and refused.
 */
function languageCode(env: NodeJS.ProcessEnv, modelId: string): string | null {
  const raw = env.ELEVENLAB_LANGUAGE_CODE?.trim()
  if (raw) return raw
  return modelId.includes('flash') || modelId.includes('turbo') ? 'vi' : null
}

export function readSpeechSettings(env: NodeJS.ProcessEnv = process.env): SpeechSettings {
  const modelId = env.ELEVENLAB_MODEL_ID?.trim() || SPEECH_DEFAULTS.modelId
  return {
    voiceId: env.ELEVENLAB_VOICE_ID?.trim() || SPEECH_DEFAULTS.voiceId,
    modelId,
    languageCode: languageCode(env, modelId),
    // Measured, not read: the API answers `invalid_voice_settings` outside 0.7–1.2 ("expected to
    // be greater or equal to 0.7 and less or equal to 1.2"). The published parameter table says
    // 0.25–4.0, which is wrong for this endpoint — a value from that table would mute the pet.
    speed: numeric(env, 'ELEVENLAB_SPEED', SPEECH_DEFAULTS.speed, 0.7, 1.2),
    stability: numeric(env, 'ELEVENLAB_STABILITY', SPEECH_DEFAULTS.stability, 0, 1),
    similarityBoost: numeric(env, 'ELEVENLAB_SIMILARITY_BOOST', SPEECH_DEFAULTS.similarityBoost, 0, 1),
    style: numeric(env, 'ELEVENLAB_STYLE', SPEECH_DEFAULTS.style, 0, 1),
    useSpeakerBoost: flag(env, 'ELEVENLAB_USE_SPEAKER_BOOST', SPEECH_DEFAULTS.useSpeakerBoost)
  }
}

function flat(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * The MP3 for one line, or `null` when there is no key or nothing to say — a voice that is
 * switched off is not a failure. A rejected request throws, and the caller records it: the
 * status alone cannot tell a wrong voice id from a refused setting, so the API's own message
 * travels with it. That body never contains the key; the line may appear in it, and the line is
 * already on screen.
 */
export async function synthesizePetSpeech(text: string, env: NodeJS.ProcessEnv = process.env): Promise<Uint8Array | null> {
  const apiKey = env.ELEVENLAB_API_KEY?.trim()
  if (!apiKey || !text.trim()) return null

  const settings = readSpeechSettings(env)
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.trim(),
        model_id: settings.modelId,
        ...(settings.languageCode ? { language_code: settings.languageCode } : {}),
        voice_settings: {
          speed: settings.speed,
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
          style: settings.style,
          use_speaker_boost: settings.useSpeakerBoost
        }
      }),
      signal: AbortSignal.timeout(20_000)
    }
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ELEVENLABS_${response.status}${body ? `: ${flat(body)}` : ''}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
