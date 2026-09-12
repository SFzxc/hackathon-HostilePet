import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

/**
 * The event log: what the desktop actually observed and what the pet actually decided.
 *
 * It is a **capped ring buffer** written as one JSON array, redacted by construction: every
 * record below is a closed union of typed facts — a host, a category, counts and the one line
 * the pet said. No page text, no URL with a query string, no tab identifiers, no secrets
 * (`docs/protocol.md` §2, `docs/engineering.md` §2).
 *
 * Persisting is debounced and atomic (tmp → rename), so a tick storm cannot turn into a write
 * storm and a crash mid-write cannot leave a half file. A log that fails to load starts empty
 * and says so in `stats()`; it never crashes the pet window.
 */
export const EVENT_LOG_CAP = 500

const siteFields = {
  at: z.number().int().nonnegative(),
  site: z.string().min(1).max(128),
  category: z.string().min(1).max(64),
  qualifyingSeconds: z.number().nonnegative(),
  documents: z.number().int().nonnegative()
}

export const eventLogRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...siteFields,
      kind: z.literal('site.observed'),
      reason: z.enum(['watch', 'threshold']),
      demoMode: z.boolean()
    })
    .strict(),
  z
    .object({
      ...siteFields,
      kind: z.literal('site.session'),
      reason: z.enum(['disconnect'])
    })
    .strict(),
  z
    .object({
      at: z.number().int().nonnegative(),
      kind: z.literal('agent.turn'),
      level: z.number().int().min(0).max(3),
      provider: z.string().min(1).max(32),
      source: z.enum(['model', 'fallback']),
      promptVersion: z.string().min(1).max(64).nullable(),
      site: z.string().min(1).max(128).nullable(),
      category: z.string().min(1).max(64).nullable(),
      say: z.string().min(1).max(160).nullable(),
      mood: z.string().min(1).max(32).nullable(),
      action: z.string().min(1).max(32),
      actionResult: z.string().min(1).max(64),
      latencyMs: z.number().nonnegative()
    })
    .strict(),
  z
    .object({
      at: z.number().int().nonnegative(),
      kind: z.literal('agent.error'),
      code: z.string().min(1).max(64),
      detail: z.string().min(1).max(200)
    })
    .strict()
])

export type EventLogRecord = z.infer<typeof eventLogRecordSchema>

export type EventLogStats = {
  path: string
  total: number
  loaded: number
  /** Plain language, shown to a person: a log that could not be read says so. */
  detail: string | null
}

export interface EventLog {
  append(record: EventLogRecord): void
  tail(count: number): EventLogRecord[]
  all(): EventLogRecord[]
  stats(): EventLogStats
  flush(): void
}

export function createEventLog(file: string, options: { cap?: number; flushDebounceMs?: number } = {}): EventLog {
  const cap = options.cap ?? EVENT_LOG_CAP
  const flushDebounceMs = options.flushDebounceMs ?? 1000
  let records: EventLogRecord[] = []
  let loaded = 0
  let detail: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) {
      for (const candidate of parsed) {
        const result = eventLogRecordSchema.safeParse(candidate)
        if (result.success) records.push(result.data)
      }
      loaded = records.length
      if (loaded !== parsed.length) detail = `${parsed.length - loaded} record(s) were unreadable and were dropped`
      if (records.length > cap) records = records.slice(-cap)
    } else {
      detail = 'the event log file was not an array; starting a new one'
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    // A missing file is the first run, not a failure.
    if (code !== 'ENOENT') detail = `the event log could not be read (${code ?? 'unknown'}); starting a new one`
  }

  function write(): void {
    dirty = false
    try {
      mkdirSync(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      writeFileSync(temporary, JSON.stringify(records, null, 2), 'utf8')
      renameSync(temporary, file)
    } catch (error) {
      // Keep running in memory. The next append retries; the log is a record, not policy.
      detail = `the event log could not be written (${error instanceof Error ? error.name : 'unknown'})`
    }
  }

  function schedule(): void {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (dirty) write()
    }, flushDebounceMs)
    timer.unref?.()
  }

  return {
    append(record) {
      records.push(record)
      if (records.length > cap) records = records.slice(-cap)
      schedule()
    },
    tail(count) {
      return records.slice(-count)
    },
    all() {
      return [...records]
    },
    stats() {
      return { path: file, total: records.length, loaded, detail }
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (dirty) write()
    }
  }
}
