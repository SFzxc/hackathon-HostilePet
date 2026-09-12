import type { AgentContext } from './context'
import { SPEAKING_ACTIONS, type PetDecision } from './outcome'

/**
 * The deterministic floor (`docs/tone.md` §5). It runs on every line before anything is shown,
 * costs nothing, and never calls a model.
 *
 * Known gap, stated rather than hidden: the numeric check covers **digits only**. A
 * written-out quantity ("nửa tiếng") is not checked, and no check here can verify meaning,
 * units or attribution. `docs/tone.md` §5 requires typed facts and action receipts before that
 * claim can be made, and that protocol is still open (`docs/agent.md` §4).
 */
export type ValidationIssue = { check: string; detail: string }

/**
 * Word boundaries that understand Vietnamese. JavaScript's `\b` is defined against `\w`, which is
 * ASCII-only: in `đã chặn` the `đ` is not a word character, so `\bđã` never matches and every
 * pattern beginning with one was dead. Letter/number lookarounds are what actually hold here, and
 * they still refuse to match inside a longer word.
 */
function phrase(check: string, alternatives: readonly string[]): { check: string; pattern: RegExp } {
  return { check, pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'iu') }
}

const BANNED: ReadonlyArray<{ check: string; pattern: RegExp }> = [
  phrase('person_targeted', ['ngu', 'dốt', 'hèn', 'vô dụng', 'thất bại', 'rác rưỡi', 'đồ bỏ đi']),
  phrase('medical_claim', ['dopamine', 'nghiện', 'trầm cảm', 'trị liệu', 'detox', 'tâm lý']),
  phrase('moralizing', ['đáng xấu hổ', 'hổ thẹn', 'tệ hại', 'vô đạo đức', 'xấu hổ thay']),
  phrase('profanity', ['đm', 'đéo', 'vcl', 'vl', 'cặc', 'lồn', 'chết tiệt']),
  // Nothing in this build can block, cancel, buy or delete anything, so any such claim is
  // fabricated by definition (`docs/tone.md` §5, capability claims).
  phrase('capability_claim', ['đã\\s+(?:chặn|khóa|khoá|hủy|huỷ|xóa|xoá|mua|tắt|đóng|chuyển)'])
]

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}]/u
const ENGLISH_HINT = phrase('language', ['the', 'and', 'you', 'your', 'this', 'that', 'because', 'please', 'hey', 'stop', 'scrolling']).pattern

function normalise(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

/** Numbers the context actually contains: the only ones a line may state. */
function groundedNumbers(context: AgentContext): Set<string> {
  const allowed = new Set<string>()
  const add = (value: number): void => {
    if (!Number.isFinite(value)) return
    allowed.add(String(Math.round(value)))
    allowed.add(String(Math.floor(value)))
    allowed.add(String(Math.ceil(value)))
  }
  for (const fact of context.facts) {
    add(fact.qualifyingSeconds)
    add(fact.qualifyingSeconds / 60)
    add(fact.documents)
  }
  add(context.totals.observedSeconds)
  add(context.totals.observedSeconds / 60)
  add(context.totals.sites)
  add(context.totals.sessions)
  add(context.totals.turns)
  add(context.level)
  return allowed
}

function hasAllCapsWord(line: string): boolean {
  for (const word of line.match(/[^\W\d_]{3,}/gu) ?? []) {
    if (word === word.toLocaleUpperCase('vi') && word !== word.toLocaleLowerCase('vi')) return true
  }
  return false
}

export function validateDecision(decision: PetDecision, context: AgentContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const say = decision.say
  const speaks = SPEAKING_ACTIONS.includes(decision.action)

  if (speaks && say.trim().length === 0) issues.push({ check: 'empty_line', detail: `${decision.action} needs a line` })
  if (!speaks && say.trim().length > 0) issues.push({ check: 'unsaid_line', detail: `${decision.action} must not carry a line` })
  if (say.length > 160) issues.push({ check: 'length', detail: `${say.length} characters, limit 160` })
  if (/[\r\n]/.test(say)) issues.push({ check: 'single_line', detail: 'the line must be one line' })
  if (EMOJI.test(say)) issues.push({ check: 'formatting', detail: 'emoji are not part of the voice' })
  if ((say.match(/!/g) ?? []).length > 1) issues.push({ check: 'formatting', detail: 'at most one exclamation mark' })
  if (hasAllCapsWord(say)) issues.push({ check: 'formatting', detail: 'no shouted words' })
  if (ENGLISH_HINT.test(say)) issues.push({ check: 'language', detail: `locale is ${context.locale}` })

  for (const rule of BANNED) if (rule.pattern.test(say)) issues.push({ check: rule.check, detail: `banned pattern in "${say}"` })

  const allowed = groundedNumbers(context)
  for (const numeral of say.match(/\d+/g) ?? []) {
    if (!allowed.has(numeral)) issues.push({ check: 'numeric_grounding', detail: `${numeral} is not in the context` })
  }

  const candidate = normalise(say)
  if (candidate.length > 0) {
    for (const previous of context.lastLines) {
      const earlier = normalise(previous)
      if (earlier.length > 0 && (earlier === candidate || earlier.includes(candidate) || candidate.includes(earlier))) {
        issues.push({ check: 'repetition', detail: 'near-identical to a recent line' })
        break
      }
    }
  }

  return issues
}
