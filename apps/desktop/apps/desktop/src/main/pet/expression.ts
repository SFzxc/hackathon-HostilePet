import type { PetExpression } from '../../shared/desktop'
import type { FocusState } from '../focus/focus-watcher'

/**
 * Which Focus mode makes the pet do what.
 *
 * This is pack-shaped data that currently lives in the shell, because the pack runtime does
 * not exist yet. When it does, this table becomes a rule in a Focus pack: which mode means
 * which expression is product behaviour, not shell mechanics, and non-negotiable 1 keeps that
 * out of the kernel.
 *
 * IMPORTANT: the identifiers are inferred, not observed. Every read of the real database has
 * been refused on the development machine, so nothing here has been matched against a true
 * `modeId` yet — `scripts/focus-state.cjs --dump` on a machine holding Full Disk Access is
 * what confirms them. The fallback is deliberately the least specific true answer, so an
 * identifier that matches nothing produces a quiet pet rather than a wrong one.
 */
const MODE_EXPRESSIONS: ReadonlyArray<{ match: RegExp; expression: PetExpression }> = [
  // Sleep first: a mode whose identifier mentions sleep is never also about work.
  { match: /sleep|dormancy|ngu\b/, expression: 'sleeping' },
  { match: /do.?not.?disturb|\bdnd\b|khong lam phien/, expression: 'dozing' },
  { match: /work|lam viec/, expression: 'focused' }
]

/**
 * Lowercase and strip diacritics: mode display names are localised, so "Ngủ", "Không làm
 * phiền" and "Làm việc" match the same table as their English originals. `đ` is not a
 * combining mark and survives, which is why the patterns above spell it out.
 */
function normalise(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * `com.apple.focus.` is shared by every Apple Focus mode, so matching it would give Work,
 * Personal and the rest one expression. Strip that prefix and keep the rest:
 * `com.apple.donotdisturb…` and `com.apple.dormancy.sleep` stay meaningful even when the
 * person has renamed the mode to something this table has never seen.
 */
function modeKey(focus: FocusState): string {
  const id = (focus.modeId ?? '').replace(/^com\.apple\.focus\./i, '')
  return normalise(`${id} ${focus.modeName ?? ''}`.trim())
}

/**
 * The expression a Focus reading earns, or null when there is nothing to wear: no mode is on,
 * or the database could not be read. Null is the honest answer to both — an unread database is
 * not "no Focus mode", and it is certainly not a dozing pet.
 */
export function focusExpression(focus: FocusState): PetExpression | null {
  if (!focus.known || focus.active !== true) return null
  const key = modeKey(focus)
  for (const rule of MODE_EXPRESSIONS) if (rule.match.test(key)) return rule.expression
  // A mode with no look of its own still means "do not disturb me". Quiet and awake is true;
  // guessing that an unknown mode is about work would not be.
  return 'dozing'
}

/**
 * The expression the pet wears right now.
 *
 * Precedence, and why: the tray's preview is an explicit visual demo control, so it wins while
 * it is set to something. Otherwise a live line from the agent owns the face — a reaction the
 * user just caused is the point of the product — and when that line expires or is dismissed
 * the Focus sensor decides. A sensor that cannot read leaves the pet idle rather than miming a
 * state it never saw, and an agent that said nothing changes nothing.
 */
export function petExpression(
  preview: 'idle' | 'thinking' | 'speaking',
  focus: FocusState,
  agent: PetExpression | null = null
): PetExpression {
  if (preview !== 'idle') return preview
  if (agent) return agent
  return focusExpression(focus) ?? 'idle'
}
