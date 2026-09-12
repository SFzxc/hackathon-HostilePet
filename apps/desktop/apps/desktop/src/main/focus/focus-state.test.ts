import { describe, expect, it } from 'vitest'
import {
  deriveFocusState,
  parseAssertions,
  parseModeConfigurations,
  repeatMatchesDay,
  scheduleCandidates,
  toUnixMs,
  type ModeConfigurations
} from './focus-state'

/**
 * Fixtures mirror the shape observed in `~/Library/DoNotDisturb/DB`. They verify the
 * parser and the derivation — they are not evidence that the real database is being read
 * (non-negotiable 10). `scripts/focus-state.cjs --dump` is what checks the real file.
 */

const MAC_EPOCH_MS = 978_307_200_000
/**
 * Instants are built in the machine's local time on purpose: a Focus schedule is local
 * ("09:00 on weekdays"), and the derivation reads local hours. Hard-coding UTC here would
 * make every schedule assertion depend on the timezone the suite happens to run in.
 * 2026-09-14 is a Monday; 2026-09-19 is a Saturday.
 */
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 8, day, hour, minute, 0, 0).getTime()
const MONDAY_10 = at(14, 10)
const MONDAY_23_30 = at(14, 23, 30)
const TUESDAY_02 = at(15, 2)
const SATURDAY_10 = at(19, 10)
/** 02:00 on Saturday still belongs to Friday's 23:00–07:00 window. */
const SATURDAY_02 = at(19, 2)
const SUNDAY_02 = at(20, 2)

function assertions(records: unknown[]): unknown {
  return { data: [{ storeAssertionRecords: records }] }
}
function manual(modeId: string, startMs: number, durationSec?: number): unknown {
  return {
    assertionUUID: `uuid-${modeId}`,
    assertionDetails: {
      assertionDetailsModeIdentifier: modeId,
      assertionStartDate: startMs,
      ...(durationSec === undefined ? {} : { assertionDuration: durationSec })
    }
  }
}
function configurations(entries: ModeConfigurations): unknown {
  return { data: [{ modeConfigurations: entries }] }
}
function scheduled(name: string, start: [number, number], end: [number, number], repeatOn?: number): ModeConfigurations {
  return {
    'mode.work': {
      mode: { name },
      triggers: {
        triggers: [{
          enabledSetting: 1,
          timePeriodStartTimeHour: start[0], timePeriodStartTimeMinute: start[1],
          timePeriodEndTimeHour: end[0], timePeriodEndTimeMinute: end[1],
          ...(repeatOn === undefined ? {} : { timePeriodRepeatOn: repeatOn })
        }]
      }
    }
  }
}
function parseConfigs(json: unknown): ModeConfigurations {
  const parsed = parseModeConfigurations(json)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}
function parseRecords(json: unknown, now: number) {
  const parsed = parseAssertions(json, now)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('focus database parsing', () => {
  it('reads a manual assertion and converts CFAbsoluteTime', () => {
    const cfaSeconds = (MONDAY_10 - MAC_EPOCH_MS) / 1000
    const [record] = parseRecords(assertions([manual('mode.work', cfaSeconds)]), MONDAY_10)
    expect(record.modeId).toBe('mode.work')
    expect(record.startMs).toBe(MONDAY_10)
    expect(record.active).toBe(true)
  })

  it('accepts Unix milliseconds and ISO strings as well', () => {
    expect(toUnixMs(MONDAY_10)).toBe(MONDAY_10)
    expect(toUnixMs(new Date(MONDAY_10).toISOString())).toBe(MONDAY_10)
    expect(toUnixMs(undefined)).toBeNull()
  })

  it('expires an assertion whose duration has passed and keeps a live one', () => {
    const expired = parseRecords(assertions([manual('mode.sleep', MONDAY_10, 600)]), MONDAY_10 + 900_000)
    expect(expired[0].active).toBe(false)
    const live = parseRecords(assertions([manual('mode.sleep', MONDAY_10, 3600)]), MONDAY_10 + 900_000)
    expect(live[0].active).toBe(true)
  })

  it('treats a missing or absurd duration as "until I turn it off"', () => {
    for (const duration of [undefined, 0, 315_360_000]) {
      const [record] = parseRecords(assertions([manual('mode.work', MONDAY_10, duration)]), MONDAY_10 + 86_400_000)
      expect(record.active).toBe(true)
    }
  })

  it('rejects a payload that does not match the envelope instead of reporting "off"', () => {
    expect(parseAssertions({ nope: true }, MONDAY_10).ok).toBe(false)
    expect(parseAssertions({ data: [] }, MONDAY_10).ok).toBe(false)
    expect(parseAssertions({ data: [{ storeAssertionRecords: 'nope' }] }, MONDAY_10).ok).toBe(false)
    // An empty store is a real reading: nobody turned Focus on by hand.
    expect(parseAssertions({ data: [{}] }, MONDAY_10)).toEqual({ ok: true, value: [] })
  })
})

describe('schedule derivation', () => {
  it('matches a window that contains the moment and misses one that does not', () => {
    const configs = parseConfigs(configurations(scheduled('Work', [9, 0], [17, 0], 62)))
    expect(scheduleCandidates(configs, MONDAY_10)).toEqual([{ modeId: 'mode.work', source: 'schedule' }])
    expect(scheduleCandidates(configs, MONDAY_23_30)).toEqual([])
  })

  it('honours the weekday bitmask, with Sunday as bit 0', () => {
    expect(repeatMatchesDay(62, 1)).toBe(true) // Monday
    expect(repeatMatchesDay(62, 6)).toBe(false) // Saturday
    expect(repeatMatchesDay(127, 6)).toBe(true) // every day
    expect(repeatMatchesDay(undefined, 6)).toBe(true) // absent means every day
    const weekdays = parseConfigs(configurations(scheduled('Work', [9, 0], [17, 0], 62)))
    expect(scheduleCandidates(weekdays, SATURDAY_10)).toEqual([])
  })

  it('wraps a window past midnight and credits the day it started', () => {
    const sleep = parseConfigs(configurations(scheduled('Sleep', [23, 0], [7, 0], 62)))
    expect(scheduleCandidates(sleep, MONDAY_23_30)).toHaveLength(1)
    expect(scheduleCandidates(sleep, TUESDAY_02)).toHaveLength(1)
    // Friday 23:00–07:00 is still running on Saturday 02:00, and Friday's bit decides.
    expect(scheduleCandidates(sleep, SATURDAY_02)).toHaveLength(1)
    // Sunday 02:00 belongs to Saturday's window, and Saturday is not in the mask.
    expect(scheduleCandidates(sleep, SUNDAY_02)).toHaveLength(0)
  })

  it('ignores a disabled trigger and a zero-length window', () => {
    const disabled = parseConfigs(configurations({ 'mode.work': { mode: { name: 'Work' }, triggers: { triggers: [{ enabledSetting: 0, timePeriodStartTimeHour: 9, timePeriodStartTimeMinute: 0, timePeriodEndTimeHour: 17, timePeriodEndTimeMinute: 0 }] } } }))
    expect(scheduleCandidates(disabled, MONDAY_10)).toEqual([])
    const zeroLength = parseConfigs(configurations(scheduled('Work', [10, 0], [10, 0])))
    expect(scheduleCandidates(zeroLength, MONDAY_10)).toEqual([])
  })
})

describe('derived focus state', () => {
  const workSchedule = parseConfigs(configurations(scheduled('Work', [9, 0], [17, 0], 62)))

  it('reports a manual assertion with the name from the configurations', () => {
    const reading = deriveFocusState({
      assertions: parseRecords(assertions([manual('mode.work', MONDAY_10)]), MONDAY_10),
      modeConfigurations: workSchedule
    }, MONDAY_10)
    expect(reading).toMatchObject({ active: true, modeId: 'mode.work', modeName: 'Work', source: 'assertion' })
  })

  it('reports a scheduled mode when nothing was set by hand', () => {
    const reading = deriveFocusState({ assertions: [], modeConfigurations: workSchedule }, MONDAY_10)
    expect(reading).toMatchObject({ active: true, modeName: 'Work', source: 'schedule' })
  })

  it('lets the manual assertion name the mode and keeps the schedule as a candidate', () => {
    const both = parseConfigs(configurations({ ...scheduled('Work', [9, 0], [17, 0], 62), 'mode.sleep': { mode: { name: 'Sleep' } } }))
    const reading = deriveFocusState({
      assertions: parseRecords(assertions([manual('mode.sleep', MONDAY_10)]), MONDAY_10),
      modeConfigurations: both
    }, MONDAY_10)
    expect(reading.modeId).toBe('mode.sleep')
    expect(reading.source).toBe('assertion')
    expect(reading.candidates).toEqual([
      { modeId: 'mode.sleep', source: 'assertion' },
      { modeId: 'mode.work', source: 'schedule' }
    ])
  })

  it('reports no mode when nothing matches', () => {
    const reading = deriveFocusState({ assertions: [], modeConfigurations: workSchedule }, SATURDAY_10)
    expect(reading).toEqual({ active: false, modeId: null, modeName: null, source: null, candidates: [] })
  })

  it('ignores an expired assertion and falls back to the schedule', () => {
    const reading = deriveFocusState({
      assertions: parseRecords(assertions([manual('mode.sleep', MONDAY_10, 60)]), MONDAY_10 + 3_600_000),
      modeConfigurations: workSchedule
    }, MONDAY_10 + 3_600_000)
    expect(reading).toMatchObject({ active: true, modeId: 'mode.work', source: 'schedule' })
  })
})
