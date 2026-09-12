const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'

/** Generate the MP3 in the main process so the API key never reaches a window. */
export async function synthesizePetSpeech(text: string, env: NodeJS.ProcessEnv = process.env): Promise<Uint8Array | null> {
  const apiKey = env.ELEVENLAB_API_KEY?.trim()
  if (!apiKey || !text.trim()) return null

  const voiceId = env.ELEVENLAB_VOICE_ID?.trim() || DEFAULT_VOICE_ID
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: text.trim(), model_id: 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(20_000)
    }
  )

  if (!response.ok) throw new Error(`ELEVENLABS_${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
