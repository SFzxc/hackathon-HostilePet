import { z } from 'zod'

/**
 * Pure reading of the macOS Focus / Do Not Disturb state — no filesystem, no clock.
 * `focus-watcher.ts` owns the I/O; this module owns the meaning.
 *
 * Both system files are undocumented and Apple has changed their shape across
 * releases, so every schema here is deliberately lenient: unknown keys are dropped
 * and a missing collection means "none", while a payload that does not match its
 * envelope at all is reported as a failure. That distinction matters — reporting an
 * unreadable database as "Focus is off" would invent a state (non-negotiable 6).
 *
 * Rationale, alternatives and the permission model: `docs/adr/0007-macos-focus-sensor.md`.
 */

/** CFAbsoluteTime epoch (2001-01-01T00:00:00Z) in Unix milliseconds. */
const MAC_EPOCH_MS = 978_307_200_000
/** Above this a stored number is Unix milliseconds; CFAbsoluteTime is ~8e8 today. */
const UNIX_MS_FLOOR = 1e11
/** A duration at or above this many seconds is how "until I turn it off" is spelled. */
const INDEFINITE_SECONDS = 315_360_000

const assertionDetailsSchema = z.object({
  assertionDetailsModeIdentifier: z.string().nullish(),
  assertionStartDate: z.number().nullish(),
  assertionDuration: z.number().nullish(),
  lifetimeDuration: z.number().nullish(),
  assertionLifetime: z.object({ lifetimeDuration: z.number().nullish() }).nullish()
})

/**
 * Some macOS builds nest the mode fields under `assertionDetails`, others put them on the
 * record itself, so the record schema carries both the flat and the nested form.
 */
const assertionRecordSchema = assertionDetailsSchema.extend({
  assertionUUID: z.string().nullish(),
  assertionDetails: assertionDetailsSchema.nullish()
})

const assertionsStoreSchema = z.object({
  storeAssertionRecords: z.array(assertionRecordSchema).optional()
})

const triggerSchema = z.object({
  enabledSetting: z.number().nullish(),
  timePeriodStartTimeHour: z.number().nullish(),
  timePeriodStartTimeMinute: z.number().nullish(),
  timePeriodEndTimeHour: z.number().nullish(),
  timePeriodEndTimeMinute: z.number().nullish(),
  timePeriodRepeatOn: z.union([z.number(), z.array(z.number())]).nullish()
})

const modeConfigSchema = z.object({
  mode: z.object({ name: z.string().nullish() }).nullish(),
  triggers: z.object({ triggers: z.array(triggerSchema).nullish() }).nullish()
})

const modeConfigsStoreSchema = z.object({
  modeConfigurations: z.record(z.string(), modeConfigSchema).optional()
})

export type AssertionRecord = {
  modeId: string
  uuid: string | null
  startMs: number | null
  expiresMs: number | null
  active: boolean
}
export type ModeConfig = z.infer<typeof modeConfigSchema>
export type ModeConfigurations = Record<string, ModeConfig>
export type FocusSource = 'assertion' | 'schedule'
export type FocusCandidate = { modeId: string; source: FocusSource }

/** The derived state, with no claim about whether the database could be read. */
export type FocusReading = {
  active: boolean
  modeId: string | null
  modeName: string | null
  source: FocusSource | null
  candidates: FocusCandidate[]
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/** Both files wrap their payload in `data: [store]`; macOS uses the first entry. */
export function parseEnvelope<S extends z.ZodType>(json: unknown, schema: S): ParseResult<z.infer<S>> {
  if (typeof json !== 'object' || json === null) return { ok: false, reason: 'the file is not a JSON object' }
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: 'the file has no data[0] store' }
  const parsed = schema.safeParse(data[0])
  if (!parsed.success) {
    const first = parsed.error.issues.length > 0 ? parsed.error.issues[0].message : 'shape mismatch'
    return { ok: false, reason: `unexpected store shape: ${first}` }
  }
  return { ok: true, value: parsed.data }
}

/** Accepts a CFAbsoluteTime (seconds since 2001), Unix milliseconds, or an ISO string. */
export function toUnixMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > UNIX_MS_FLOOR ? value : value * 1000 + MAC_EPOCH_MS
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** A lifetime of 0, missing or absurdly large means "until turned off". */
function lifetimeDurationSeconds(details: z.infer<typeof assertionDetailsSchema> | null): number | null {
  const candidates = [details?.assertionDuration, details?.assertionLifetime?.lifetimeDuration, details?.lifetimeDuration]
  for (const candidate of candidates) {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) continue
    return candidate >= INDEFINITE_SECONDS ? null : candidate
  }
  return null
}

/**
 * Manual assertions, newest first. A schedule-driven Focus never appears here, so an
 * empty list means "nobody turned Focus on by hand" — not "Focus is off".
 */
export function parseAssertions(json: unknown, now: number): ParseResult<AssertionRecord[]> {
  const store = parseEnvelope(json, assertionsStoreSchema)
  if (!store.ok) return store

  const records = store.value.storeAssertionRecords ?? []
  const parsed: AssertionRecord[] = []
  for (const record of records) {
    const details: z.infer<typeof assertionDetailsSchema> = record.assertionDetails ?? record
    const modeId = details.assertionDetailsModeIdentifier
    if (typeof modeId !== 'string' || modeId.length === 0) continue

    const startMs = toUnixMs(details.assertionStartDate)
    const durationSec = lifetimeDurationSeconds(details)
    const expiresMs = startMs !== null && durationSec !== null ? startMs + durationSec * 1000 : null
    parsed.push({
      modeId,
      uuid: record.assertionUUID ?? null,
      startMs,
      expiresMs,
      active: expiresMs === null || now < expiresMs
    })
  }

  parsed.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
  return { ok: true, value: parsed }
}

export function parseModeConfigurations(json: unknown): ParseResult<ModeConfigurations> {
  const store = parseEnvelope(json, modeConfigsStoreSchema)
  if (!store.ok) return store
  return { ok: true, value: store.value.modeConfigurations ?? {} }
}

/** `enabledSetting`: 0 = off, 1 = on, 2 = on with a custom schedule. */
function triggerEnabled(enabledSetting: unknown): boolean {
  return enabledSetting === 1 || enabledSetting === 2
}

/**
 * `timePeriodRepeatOn` is a weekday bitmask with Sunday as bit 0 — 62 is Mon–Fri,
 * 127 is every day. Missing means every day.
 */
export function repeatMatchesDay(repeatOn: unknown, day: number): boolean {
  if (Array.isArray(repeatOn)) return repeatOn.map(Number).includes(day)
  if (typeof repeatOn === 'number' && Number.isFinite(repeatOn)) return (repeatOn & (1 << day)) !== 0
  return true
}

function minutesOfDay(hour: unknown, minute: unknown): number | null {
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/** Half-open window; it wraps past midnight when start > end. */
function withinWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/**
 * A 23:00–07:00 window still running at 01:00 on Tuesday was started on Monday, so
 * Monday's repeat bit is the one that decides.
 */
function windowStartDay(day: number, minutes: number, start: number, end: number): number {
  return start > end && minutes < end ? (day + 6) % 7 : day
}

/** Modes whose schedule says they should be on right now. A heuristic, not a reading. */
export function scheduleCandidates(modeConfigurations: ModeConfigurations, now: number): FocusCandidate[] {
  const date = new Date(now)
  const day = date.getDay()
  const minutes = date.getHours() * 60 + date.getMinutes()
  const hits: FocusCandidate[] = []

  for (const [modeId, config] of Object.entries(modeConfigurations)) {
    for (const trigger of config.triggers?.triggers ?? []) {
      if (!triggerEnabled(trigger.enabledSetting)) continue
      const start = minutesOfDay(trigger.timePeriodStartTimeHour, trigger.timePeriodStartTimeMinute)
      const end = minutesOfDay(trigger.timePeriodEndTimeHour, trigger.timePeriodEndTimeMinute)
      if (start === null || end === null) continue
      if (!repeatMatchesDay(trigger.timePeriodRepeatOn, windowStartDay(day, minutes, start, end))) continue
      if (!withinWindow(minutes, start, end)) continue
      if (!hits.some(hit => hit.modeId === modeId)) hits.push({ modeId, source: 'schedule' })
    }
  }
  return hits
}

export type FocusInputs = { assertions: AssertionRecord[]; modeConfigurations: ModeConfigurations }

/**
 * A manual assertion outranks a schedule: the person acted, so that is the mode named.
 * A coinciding scheduled window stays in `candidates` rather than being hidden.
 */
export function deriveFocusState({ assertions, modeConfigurations }: FocusInputs, now: number): FocusReading {
  const nameOf = (modeId: string): string | null => modeConfigurations[modeId]?.mode?.name ?? null
  const scheduled = scheduleCandidates(modeConfigurations, now)
  const assertion = assertions.find(record => record.active)

  if (assertion) {
    return {
      active: true,
      modeId: assertion.modeId,
      modeName: nameOf(assertion.modeId),
      source: 'assertion',
      candidates: [{ modeId: assertion.modeId, source: 'assertion' }, ...scheduled]
    }
  }
  if (scheduled.length > 0) {
    const first = scheduled[0]
    return { active: true, modeId: first.modeId, modeName: nameOf(first.modeId), source: 'schedule', candidates: scheduled }
  }
  return { active: false, modeId: null, modeName: null, source: null, candidates: [] }
}
