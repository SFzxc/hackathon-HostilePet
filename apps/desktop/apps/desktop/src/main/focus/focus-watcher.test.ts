import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FOCUS_SIGNAL,
  isTransition,
  readFocusState,
  startFocusWatcher,
  toFocusEvent,
  type FocusEvent,
  type FocusState,
  type FocusWatcher
} from './focus-watcher'

/**
 * The mode exists so its name can be resolved, but it carries no enabled trigger: a
 * schedule here would make "is Focus active" depend on the wall clock the suite runs at.
 * Time-dependent derivation is covered with fixed instants in `focus-state.test.ts`.
 */
const WORK_SCHEDULE = {
  modeConfigurations: { 'mode.work': { mode: { name: 'Work' }, triggers: { triggers: [] } } }
}

const dirs: string[] = []
function makeDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hp-focus-'))
  dirs.push(dir)
  return dir
}
function writeAssertions(dir: string, records: unknown[]): void {
  writeFileSync(join(dir, 'Assertions.json'), JSON.stringify({ data: [{ storeAssertionRecords: records }] }))
}
function writeConfigurations(dir: string, store: unknown): void {
  writeFileSync(join(dir, 'ModeConfigurations.json'), JSON.stringify({ data: [store] }))
}
/** A manual assertion with no duration means "on until I turn it off". */
function manualOn(dir: string, modeId: string): void {
  writeAssertions(dir, [{ assertionUUID: 'u1', assertionDetails: { assertionDetailsModeIdentifier: modeId, assertionStartDate: Date.now() } }])
}
function off(dir: string): void {
  writeAssertions(dir, [])
}

let watcher: FocusWatcher | undefined
afterEach(() => {
  watcher?.stop()
  watcher = undefined
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('reading focus state', () => {
  it('reports an unreadable database as unknown, never as "off"', () => {
    const state = readFocusState({ dbDir: join(tmpdir(), 'hp-focus-does-not-exist') })
    expect(state.known).toBe(false)
    expect(state.active).toBeNull()
    expect(state.errors.join(' ')).toContain('not found')
  })

  it('reports invalid JSON as unknown', () => {
    const dir = makeDb()
    writeFileSync(join(dir, 'Assertions.json'), 'not json')
    writeConfigurations(dir, WORK_SCHEDULE)
    const state = readFocusState({ dbDir: dir })
    expect(state.known).toBe(false)
    expect(state.errors.join(' ')).toContain('not valid JSON')
  })

  it('reports unknown when only the schedule file is unreadable', () => {
    const dir = makeDb()
    writeAssertions(dir, [])
    const state = readFocusState({ dbDir: dir })
    expect(state.known).toBe(false)
    expect(state.active).toBeNull()
  })

  it('reads a real directory: manual Focus on, then off', () => {
    vi.useFakeTimers()
    const dir = makeDb()
    writeConfigurations(dir, WORK_SCHEDULE)
    off(dir)
    expect(readFocusState({ dbDir: dir })).toMatchObject({ known: true, active: false })

    manualOn(dir, 'mode.work')
    expect(readFocusState({ dbDir: dir })).toMatchObject({ known: true, active: true, modeId: 'mode.work', modeName: 'Work', source: 'assertion' })

    off(dir)
    expect(readFocusState({ dbDir: dir })).toMatchObject({ known: true, active: false, modeId: null })
  })
})

describe('focus transitions', () => {
  const known = (active: boolean, modeId: string | null): FocusState =>
    ({ known: true, active, modeId, modeName: null, source: modeId ? 'assertion' : null, candidates: [], errors: [], reason: null })

  it('treats the first reading as a transition and a repeat as nothing', () => {
    expect(isTransition(null, known(false, null))).toBe(true)
    expect(isTransition(known(false, null), known(false, null))).toBe(false)
    expect(isTransition(known(false, null), known(true, 'mode.work'))).toBe(true)
    // Losing the ability to read is itself a transition worth publishing.
    expect(isTransition(known(false, null), { ...known(false, null), known: false, active: null })).toBe(true)
  })

  it('names the signal the way the kernel expects', () => {
    const event = toFocusEvent(known(true, 'mode.work'), null, new Date('2026-09-14T10:00:00Z'))
    expect(event).toEqual({ type: FOCUS_SIGNAL, at: '2026-09-14T10:00:00.000Z', initial: true,
      known: true, active: true, modeId: 'mode.work', modeName: null, source: 'assertion' })
    expect(FOCUS_SIGNAL).toBe('signal.hp.focus-mode.changed')
  })
})

describe('focus watcher', () => {
  it('emits the initial state, then one event per change, and nothing on a repeat', async () => {
    vi.useFakeTimers()
    const dir = makeDb()
    writeConfigurations(dir, WORK_SCHEDULE)
    off(dir)

    const events: FocusEvent[] = []
    watcher = startFocusWatcher({
      dbDir: dir,
      intervalMs: 1000,
      useFsWatch: false,
      onChange: (next, previous) => events.push(toFocusEvent(next, previous, new Date(0)))
    })
    expect(watcher.mode).toBe('poll')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ initial: true, known: true, active: false })

    // Nothing changed: a poll must not publish a duplicate.
    await vi.advanceTimersByTimeAsync(3000)
    expect(events).toHaveLength(1)

    manualOn(dir, 'mode.sleep')
    await vi.advanceTimersByTimeAsync(1000)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ initial: false, known: true, active: true, modeId: 'mode.sleep', source: 'assertion' })

    off(dir)
    await vi.advanceTimersByTimeAsync(1000)
    expect(events).toHaveLength(3)
    expect(events[2]).toMatchObject({ initial: false, active: false, modeId: null })
  })

  it('does not publish a torn read as "Focus turned off"', async () => {
    vi.useFakeTimers()
    const dir = makeDb()
    writeConfigurations(dir, WORK_SCHEDULE)
    manualOn(dir, 'mode.work')

    const events: FocusEvent[] = []
    watcher = startFocusWatcher({
      dbDir: dir,
      intervalMs: 1000,
      useFsWatch: false,
      retryDelayMs: 50,
      retries: 20,
      onChange: (next, previous) => events.push(toFocusEvent(next, previous, new Date(0)))
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ active: true })

    // A half-written file: unreadable, so the watcher retries instead of reporting "off".
    writeFileSync(join(dir, 'Assertions.json'), '{"data":[{"storeAsser')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toHaveLength(1)

    // The write lands and the mode is still on: the retries resolve back to the same
    // state, so there is still nothing to publish.
    manualOn(dir, 'mode.work')
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toHaveLength(1)

    // Turning it off for real is published.
    off(dir)
    await vi.advanceTimersByTimeAsync(1000)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ active: false })
  })

  it('survives a database directory that does not exist yet', () => {
    vi.useFakeTimers()
    const missing = join(tmpdir(), 'hp-focus-missing-dir')
    mkdirSync(missing, { recursive: true })
    rmSync(missing, { recursive: true, force: true })
    const errors: unknown[] = []
    watcher = startFocusWatcher({ dbDir: missing, useFsWatch: false, onError: error => errors.push(error) })
    expect(watcher.state.known).toBe(false)
    watcher.check()
    expect(watcher.state.known).toBe(false)
  })
})
