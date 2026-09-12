# Agent — loop, tools, prompts, output

> Owns: everything about the LLM side. Voice and validation live in `docs/tone.md`; the prompt itself in `prompts/persona.md`.

## Runtime

The agent runs as TypeScript in the privileged Node.js core of the Electron app (ADR 0004), initially in main with asynchronous provider calls. It does not run in the renderer. Node coordinates requests and local tools; inference runs at the configured provider unless a local provider is explicitly selected.

The library is selected: LangGraph JS on `@langchain/core`, pinned in `packages/agent` (ADR 0006). The package now implements the turn itself — context assembly, provider adapter, deterministic validation, one retry, and silence when neither attempt produced a usable line (ADR 0011) — and still has **no graph and no tools**, because §4 requires a settled tool-dispatch protocol first. A turn today is one bounded provider call; wiring a graph library around a straight line would add a dependency without adding a decision, and the pinned dependency stays declared so the choice is not relitigated. A graph/checkpoint library must not become a second policy store or bypass approval, grants, the four-call budget or application-owned action receipts. Any future utility-process isolation keeps side-effect authorization and policy writes in the kernel.

## 1. Loop

`observe → evaluate local policy → gather minimal context → propose / tool call → validate → execute → show result`

The rule engine decides *when* the agent runs, its scope and its time budget. The agent is never called per event: a scroll, a tick or a threshold crossing is recorded, never forwarded to a model. What a signal can do is change the **escalation level**, and the level is what makes a later turn more forceful.

Triggers are explicit and few:

| Trigger | Purpose |
| --- | --- |
| Scheduled look at the event log (30–60 s) | Read the recent window, produce the line, optionally propose an action |
| Rule transition into `warning` or `gated` | Produce the line, and optionally propose an action |
| User message to the pet | Conversation, negotiation, questions |
| Exception negotiation | `request_temporary_allowance` |
| Draft request | Turn a sentence into a `RulePackDraft` (`docs/packs.md` §6) |
| User asks for a summary | Activity log explanation |

### 1.1 Cadence, level, and silence (implemented slice)

Until a rule engine exists, the desktop's turn runner owns the cadence and the ladder:

- **Cadence.** One turn every 30–60 s (default 45 s), never overlapping: a turn in flight blocks the next, and a manual "ask now" may not run within 30 s of the previous turn. A turn is **skipped** when nothing new was observed since the last one — calling a model about silence is how a companion becomes noise — and skipped turns are counted, not logged as speech.
- **Level.** `watchSeconds · concernedSeconds · hostileSeconds` and `decayAfterSeconds` live in `packs/site-catalog.json`, not in kernel code (non-negotiable 1). That catalog is also the whole of what counts: a tick from an unlisted host is dropped before it earns any time, so an unrecognised site is invisible to the level rather than a distraction inside it. The level rises with qualifying time on one site and with the number of pages open, and drops one rung after `decayAfterSeconds` without qualifying activity, so a return to work is visible instead of the pet staying angry at a finished session. Time is credited per page and reported as the **maximum** over a site's pages, never the sum: two tabs of one site are not two afternoons.
- **Silence at level 0.** Nothing worth a line means `mood_only` or `none`, and the pet stays quiet. A level-0 turn must not become a remark.
- **The level is a ceiling, not a suggestion.** The mood and the action the model may choose are clamped to the band that level allows, and the intensity it is asked for follows from the same band (`docs/tone.md` §3). A model cannot raise its own level, and the clamp is recorded with the turn when it bites.

## 2. Context package

Minimum data that still lets the model be specific and honest:

- Applicable commitments (from enabled rule packs), with the values the user set
- Sanitized signal summary: typed signal identifiers and numeric facts with units, source and freshness; never page text or extracted item names
- Counters, streaks, cooldowns relevant to this intervention
- `packId`, `ruleId`, `policy_state`, and the lease TTL if one is being proposed
- Tone profile, intensity, locale
- Local clock time and timezone
- The last N lines the pet said (for anti-repetition and continuity)
- Budget snapshot **only** if the user entered budget data
- Tool results already obtained in this turn

MUST NOT include: page HTML, page text, URLs with query strings, cookies, tokens, secrets, other packs' private data.

## 3. Prompt assembly

**Implemented today.** One system message and one user message per turn: the system message is
`prompts/persona.md` with `{{character_name}}`, `{{character_look}}`, `{{tone_profile}}`,
`{{intensity}}`, `{{policy_state}}` filled from the context package and `{{context_json}}` filled
with the redacted context; the user message is one instruction line, plus the validator's rejection
reason on the retry. `promptVersion` is stamped on every turn. The three-part split below is the
target once tools exist — today the schema and the hard constraints live inside the artifact.

Three parts, concatenated in this order:

1. **Kernel contract** — output schema, tool list actually granted this turn, hard constraints that must not depend on the persona file.
2. **Persona** — `prompts/persona.md`, versioned. This is where the voice lives; the kernel never hardcodes it.
3. **Context** — the package above, serialized as JSON.

Rules:

- The persona file is a runtime artifact. Editing it is a content change, not a code change, and it requires a passing tone eval (`docs/tone.md` §8).
- The persona file names no species. `{{character_name}}` and `{{character_look}}` are filled from the **active character pack** (`docs/pet-visual-brief.md`), so swapping the character never means editing the voice.
- Never interpolate untrusted text into the system portion. Character metadata and pack-supplied strings are untrusted data too; supply them as bounded context fields rather than system instructions. The implementation contract must define message roles and allowed fields. JSON serialization alone is not an instruction boundary.
- The prompt version is logged with every turn so a behaviour regression is traceable to a prompt revision.

## 4. Output contract

**Implemented today — one message and one action.** The desktop pet is the only surface in this
slice, and the contract is the smallest thing that can drive it:

```jsonc
{
  "say": "one Vietnamese line, at most 160 characters, or empty",
  "mood": "idle | thinking | suspicious | intervene | pleased",
  "action": "say_bubble | mood_only | notify | none"
}
```

- `source` (`model` | `fallback`), `provider` and `promptVersion` are stamped by the runtime after
  generation. A model never declares its own provenance, and a turn with no line — nothing was
  generated at all — is stamped `fallback` (`docs/tone.md` §7).
- `action` describes the surface, not a side effect: `say_bubble` shows the line, `mood_only`
  changes the face, `notify` adds one desktop notification, `none` does nothing at all. There is
  no tool dispatch behind any of them yet, which is why nothing in this slice may claim that
  something was blocked, cancelled, bought or deleted — the validator rejects those claims.
- A clamped or rejected proposal is not what is on screen; the shell renders the validated
  decision, and Settings shows the level and the last line's source.

**Target contract — with tools.** Once tools exist, the shape grows to carry proposals, and this
is the contract that must be settled before the first tool ships:

```jsonc
{
  "say": "one Vietnamese line, or empty",
  "mood": "idle | suspicious | intervene | thinking | pleased | sleeping",
  "intensity_used": "low | normal | high",
  "actions": [{ "tool": "...", "args": { } }],
  "needs_user_input": false
}
```

Validation order — each gate can reject independently:

1. **Schema** — unknown fields, unknown tool names and unknown mood values are rejected.
2. **Tone validator** — the deterministic floor (`docs/tone.md` §5). Rejection reasons feed a single retry.
3. **Policy clamp** — the kernel clamps TTLs, thresholds, and rejects any action outside the current grant. The model can propose; policy decides.

Free-form text is always displayed only. It is never parsed into an action.

An output containing actions is a proposal, not proof of completion. Validate grants and obtain any required user confirmation before executing. Collect typed tool results, then generate and validate the final line against those results. Do not display a success claim from the proposal. Partial failure must be reported as partial failure; retries must not duplicate completed effects.

Before implementing the agent boundary, specify one tool-dispatch format, result receipts, confirmation states and how the final response is requested. The example above does not settle that protocol.

## 5. Tools

| Tool | Purpose |
| --- | --- |
| `get_user_commitments` | Read applicable commitments from enabled rule packs. |
| `get_budget_snapshot` | User-entered data only; reports source and freshness. |
| `get_current_context` | Sanitized context from active sensor packs. |
| `list_packs` | What is installed, enabled, and which capabilities it holds. |
| `draft_rule_pack` | Produce a `RulePackDraft` for review — never activates anything. |
| `save_to_wishlist` | Save item + sanitized URL; idempotency key required. |
| `schedule_recheck` | Create a local reminder with explicit timezone and timestamp. |
| `request_temporary_allowance` | Propose an exception; executes only after user confirmation or inside a pre-configured grant. |
| `set_pet_mood` | Valid mood enum only, with duration and fallback. |

The model MUST NOT modify commitments, budgets, API keys, capabilities or extension permissions, and MUST NOT enable a pack.

## 6. Budgets and failure

- ≤ 4 tool calls per interaction; hard wall-clock timeout per turn.
- One retry on validator rejection, with the rejection reason appended. Then the turn ends with no line (`docs/tone.md` §6).
- Model failure is a normal path, not an incident: the rule engine stays authoritative, the intervention still renders, no line is shown, and the activity log records that the model was unavailable.
- No retry storms: a failed provider is marked offline until the next successful health check.

## 7. Model selection

**Pinned for this build: `gpt-5.6-luna`** (`DEFAULT_MODEL` in `packages/agent/src/provider.ts`, ADR 0006 decision 5), overridable with `HOSTILEPET_MODEL`. It was picked without the smoke test below — no key was available when the provider was wired — so the first real turn is also the test: one turn, one JSON object, one line. The loop does not depend on the answer: a model that cannot hold the contract fails validation, gets one retry, and then the turn has no line at all — nothing is substituted for it (ADR 0011). Latency target for a desktop nudge stays a line on screen in under ~2 seconds.

Model and endpoint live in configuration. Never hardcode a model name that will go stale. Log provider errors with codes, never with credentials.

## 8. Three independent state machines

| Kind | Values |
| --- | --- |
| Visual (pet) | `idle`, `suspicious`, `intervene`, `thinking`, `pleased`, `sleeping` |
| Policy | `observing`, `warning`, `gated`, `allowed_temporarily`, `paused` |
| Connectivity | desktop, browser, model — tracked separately |

An animation finishing, a model timeout, or a mood change MUST NOT alter policy state. Policy changes only via the rule engine, a user action, a pack lifecycle event, or a lease transition.
