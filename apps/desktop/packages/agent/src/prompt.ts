import type { AgentContext } from './context'

/**
 * The persona prompt, assembled per turn from the runtime artifact (`prompts/persona.md`).
 *
 * The artifact is the voice; this file is only plumbing: it fills the placeholders and hands the
 * model the redacted context. Nothing here decides what the pet may do — the clamp and the
 * validator run after the model answers (`docs/agent.md` §4, `docs/tone.md` §5–6).
 */
export type AssembledPrompt = { system: string; user: string }

function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Everything the model may see, in the shape the artifact's `{{context_json}}` expects. */
export function contextJson(context: AgentContext): string {
  return JSON.stringify(
    {
      local_time: context.localTime,
      day_part: context.dayPart,
      level: context.level,
      level_label: context.levelLabel,
      allowed_moods: context.allowed.moods,
      allowed_actions: context.allowed.actions,
      observed: context.facts.map(fact => ({
        site: fact.site,
        kind: fact.label,
        intensity: fact.intensity,
        seconds: fact.qualifyingSeconds,
        pages: fact.documents
      })),
      totals: {
        observed_seconds: context.totals.observedSeconds,
        sites: context.totals.sites,
        pages_seen: context.totals.sessions,
        turns_so_far: context.totals.turns,
        minutes_since_your_last_line: context.totals.minutesSinceLastLine
      },
      your_recent_lines: context.lastLines,
      recent_events: context.recentLog.slice(-12).map(line => ({
        at: clock(line.at),
        kind: line.kind,
        site: line.site,
        detail: line.detail
      }))
    },
    null,
    2
  )
}

/**
 * Fill the artifact's placeholders from the context. Returns the text plus any placeholder that
 * was left unresolved, so a broken artifact is reported instead of being sent to a model.
 */
export function fillPersona(template: string, context: AgentContext): { prompt: string; unresolved: string[] } {
  const values: Record<string, string> = {
    character_name: context.character.name,
    character_look: context.character.look,
    tone_profile: context.tone.profile,
    intensity: context.tone.intensity,
    policy_state: context.levelLabel,
    context_json: contextJson(context)
  }
  let prompt = template
  for (const [key, value] of Object.entries(values)) {
    prompt = prompt.split(`{{${key}}}`).join(value)
  }
  const unresolved = [...new Set((prompt.match(/\{\{[a-z_]+\}\}/g) ?? []).map(token => token.slice(2, -2)))]
  return { prompt, unresolved }
}

export function buildPersonaPrompt(template: string, context: AgentContext, retryReason?: string): AssembledPrompt {
  const { prompt } = fillPersona(template, context)
  const retry = retryReason
    ? `\n\nCâu trả lời trước bị hệ thống loại vì: ${retryReason}\nViết lại đúng một câu khác, sửa đúng lỗi đó.`
    : ''
  return {
    system: prompt,
    user:
      'Đọc NGỮ CẢNH ở trên và trả về đúng JSON theo mục "Đầu ra". Không thêm chữ nào ngoài JSON.' + retry
  }
}
