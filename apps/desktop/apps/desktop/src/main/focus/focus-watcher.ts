import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  deriveFocusState,
  parseAssertions,
  parseModeConfigurations,
  type AssertionRecord,
  type FocusCandidate,
  type FocusReading,
  type FocusSource,
  type ModeConfigurations
} from './focus-state'

/**
 * Reading and watching the macOS Focus database — the I/O half of the sensor.
 * `focus-state.ts` owns the meaning; this module owns the file access and the event.
 *
 * The signal name follows `docs/architecture.md` §5: `signal.<packId>.<name>`.
 */
export const FOCUS_PACK_ID = 'hp.focus-mode'
export const FOCUS_SIGNAL = 'signal.hp.focus-mode.changed'
export const FOCUS_DB_DIR = join(homedir(), 'Library', 'DoNotDisturb', 'DB')

const ASSERTIONS_FILE = 'Assertions.json'
const CONFIGURATIONS_FILE = 'ModeConfigurations.json'

/**
 * `known: false` means the database could not be read. It is not the same as Focus
 * being off, and nothing downstream may render it as such (non-negotiable 6).
 */
export type FocusState = {
  known: boolean
  active: boolean | null
  modeId: string | null
  modeName: string | null
  source: FocusSource | null
  candidates: FocusCandidate[]
  errors: string[]
  /**
   * Why there is no reading, and `null` whenever there is one. `permission` is the only value
   * the shell may offer a fix for, so it has to be decided here, where the error code is still
   * visible — a window matching on the wording of `errors` would be reading tea leaves.
   */
  reason: FocusUnreadReason | null
}

export type FocusUnreadReason = 'permission' | 'unreadable'

export type FocusEvent = {
  type: typeof FOCUS_SIGNAL
  at: string
  initial: boolean
  known: boolean
  active: boolean | null
  modeId: string | null
  modeName: string | null
  source: FocusSource | null
}

export function unknownFocusState(detail: string, reason: FocusUnreadReason = 'unreadable'): FocusState {
  return { known: false, active: null, modeId: null, modeName: null, source: null, candidates: [], errors: [detail], reason }
}

/** The codes macOS returns when the gate, not the file, is the problem. */
function isPermissionDenied(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
  return code === 'EPERM' || code === 'EACCES'
}

/** Plain-language causes only; the raw error name is for the log, not the window. */
function describeReadError(error: unknown): string {
  if (isPermissionDenied(error)) return 'permission denied by macOS'
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
  if (code === 'ENOENT') return 'not found — macOS has not written its Focus database yet'
  if (error instanceof SyntaxError) return 'not valid JSON'
  return error instanceof Error ? error.name : 'unreadable'
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown
}

/**
 * Both files are required. Reading only the assertions file would let a schedule-driven
 * Focus be reported as "no Focus mode", which is a guess dressed as a reading.
 */
export function readFocusState({ dbDir = FOCUS_DB_DIR, now = Date.now() }: { dbDir?: string; now?: number } = {}): FocusState {
  const errors: string[] = []
  let denied = false
  let assertions: AssertionRecord[] = []
  let modeConfigurations: ModeConfigurations = {}

  try {
    const parsed = parseAssertions(readJson(join(dbDir, ASSERTIONS_FILE)), now)
    if (parsed.ok) assertions = parsed.value
    else errors.push(`${ASSERTIONS_FILE}: ${parsed.reason}`)
  } catch (error) {
    denied ||= isPermissionDenied(error)
    errors.push(`${ASSERTIONS_FILE}: ${describeReadError(error)}`)
  }

  try {
    const parsed = parseModeConfigurations(readJson(join(dbDir, CONFIGURATIONS_FILE)))
    if (parsed.ok) modeConfigurations = parsed.value
    else errors.push(`${CONFIGURATIONS_FILE}: ${parsed.reason}`)
  } catch (error) {
    denied ||= isPermissionDenied(error)
    errors.push(`${CONFIGURATIONS_FILE}: ${describeReadError(error)}`)
  }

  if (errors.length > 0) return unknownFocusState(errors.join('; '), denied ? 'permission' : 'unreadable')
  const reading: FocusReading = deriveFocusState({ assertions, modeConfigurations }, now)
  return { ...reading, known: true, errors: [], reason: null }
}

function transitionKey(state: FocusState): string {
  return JSON.stringify([state.known, state.active, state.modeId, state.source])
}

export function isTransition(previous: FocusState | null, next: FocusState): boolean {
  return previous === null || transitionKey(previous) !== transitionKey(next)
}

export function toFocusEvent(state: FocusState, previous: FocusState | null, at: Date = new Date()): FocusEvent {
  return {
    type: FOCUS_SIGNAL,
    at: at.toISOString(),
    initial: previous === null,
    known: state.known,
    active: state.active,
    modeId: state.modeId,
    modeName: state.modeName,
    source: state.source
  }
}

export type FocusWatcher = {
  readonly state: FocusState
  readonly mode: 'fs.watch+poll' | 'poll'
  /** Re-read now; exposed so a test or a settings button can force a check. */
  check: () => void
  stop: () => void
}

export type FocusWatcherOptions = {
  dbDir?: string
  intervalMs?: number
  useFsWatch?: boolean
  retryDelayMs?: number
  retries?: number
  initial?: boolean
  onChange?: (next: FocusState, previous: FocusState | null) => void
  onError?: (error: unknown) => void
}

/**
 * Calls `onChange` on transitions only. Two triggers feed one check:
 *   - `fs.watch` on the database directory — near-instant, but the files are rewritten
 *     in place, and macOS may refuse the watch outright when Full Disk Access is missing;
 *   - a poll interval as the safety net, because a watch that silently stops is a sensor
 *     that silently stops.
 * A read that fails when the previous read succeeded is retried before it may emit, so a
 * torn write cannot be published as "Focus turned off".
 */
export function startFocusWatcher({
  dbDir = FOCUS_DB_DIR,
  intervalMs = 2000,
  useFsWatch = true,
  retryDelayMs = 150,
  retries = 3,
  initial = true,
  onChange = () => {},
  onError = () => {}
}: FocusWatcherOptions = {}): FocusWatcher {
  let current = readFocusState({ dbDir })
  let stopped = false
  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const check = (attempt = 0): void => {
    if (stopped) return
    const next = readFocusState({ dbDir })
    if (!next.known && current.known && attempt < retries) {
      setTimeout(() => check(attempt + 1), retryDelayMs)
      return
    }
    if (!isTransition(current, next)) return
    const previous = current
    current = next
    onChange(next, previous)
  }

  if (useFsWatch) {
    try {
      watcher = watch(dbDir, { persistent: true }, () => check())
      watcher.on('error', error => onError(error))
    } catch (error) {
      // Missing Full Disk Access usually lands here; the poll below still reports the
      // permission failure through `onChange`, so the shell can say why it cannot read.
      onError(error)
      watcher = null
    }
  }
  timer = setInterval(() => check(), intervalMs)
  if (initial) onChange(current, null)

  return {
    get state() {
      return current
    },
    get mode() {
      return watcher ? 'fs.watch+poll' : 'poll'
    },
    check: () => check(),
    stop: () => {
      stopped = true
      watcher?.close()
      watcher = null
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
