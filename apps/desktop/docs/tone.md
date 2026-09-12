# Tone — generation, validation, eval

> Owns: how the pet's voice is produced and policed. The prompt itself is `prompts/persona.md`.

## 1. Decision: generation over lookup

The pet's line is **written by the model from a persona prompt plus context**, not selected from a table keyed by state.

Why:

- Canned lines read as canned within a week. The whole product bet is that the pet feels like a creature with an opinion, not a notification template.
- A state → sentence table cannot be specific. The funniest, most effective line always references the actual situation: the hour, the count, the tab, the item, the fourth time tonight.
- It makes the persona a *content* artifact (`prompts/persona.md`) that can be rewritten without changing core code.

What we give up, and how we compensate:

| Risk | Compensation |
| --- | --- |
| Model prints a wrong number | Numeric-grounding validator (§5) — a number not present in the context is a rejection |
| Model goes cruel or preachy | Banned-pattern checks plus a baked list of counter-examples in the prompt |
| Model claims an action it did not take | Capability-claim check against tool results in the same turn |
| Model is offline | Fallback line packs (§7) |
| Voice drifts after a prompt edit | Tone eval harness with pass thresholds (§8) |

## 2. Three layers, three owners

| Layer | Decides | Owner | Nature |
| --- | --- | --- | --- |
| **Policy** | whether to speak, when, how often | TypeScript kernel | deterministic |
| **Voice** | what the line actually says | model + `prompts/persona.md` | generative |
| **Floor** | what is unacceptable | validator | deterministic |

Everything that must be reliable lives in layer 1 or 3. The model owns only the part where variety and specificity are the point.

Anti-spam is layer 1, not a tone instruction: cooldown ≥ 10 minutes between pet-initiated lines, one line per intervention, no speaking during a focus session or quiet hours, no line when no enabled rule is relevant. These are enforced in code and are not negotiable by the prompt.

## 3. Profiles and intensity

| Profile | Pronouns (vi) | Register |
| --- | --- | --- |
| `roast` (default) | tôi / ông | gruff, cheeky, sarcastic, blunt, short |
| `blunt` | tôi / bạn | direct and dry, no jokes |
| `gentle` | mình / bạn | warm, steady, encouraging |
| `silent` | — | **no generation at all** |

- `silent` is a policy state, not a prompt: the kernel never calls the model for pet-initiated lines. Quiet hours and focus sessions use the same path.
- Intensity (`low | normal | high`) changes bite, never length.
- The profile and intensity are injected into the prompt; the persona file explains what each means in voice terms.

## 4. Voice invariants

The floor, stated in product terms. Each maps to at least one automated check in §5.

1. Grounded or silent. Every claim traces to something observed or explicitly hypothetical.
2. Never invent numbers, balances, totals, or outcomes.
3. Never imply the pet blocked, cancelled or bought something when it did not.
4. Punch at the action, the timing, the pattern — never at the person.
5. Insolent, not contemptuous: no disgust, no moralizing, no shaming.
6. No medical or neurological claims (dopamine, addiction, detox, therapy).
7. One line, ≤ 160 characters, target ≤ 120.
8. The escape/override control stays plain language. Sass never obscures the exit.
9. No profanity, slurs, or sexual content by default.
10. After an override: at most one final quip, then silence for the cooldown.

## 5. Validator

Runs on every generated line before display. Cheap, deterministic, no model.

| Check | Rule | On failure |
| --- | --- | --- |
| Schema | Matches the output contract (`docs/agent.md` §4) | reject |
| Length | ≤ 160 chars, single line, no newline | reject |
| Formatting | No emoji, no ALL-CAPS line, at most one `!` | reject |
| Banned phrases | Person-targeted insults, medical claims, moralizing patterns | reject |
| **Numeric grounding** | Reject numerals absent from normalized context facts. This check alone cannot verify meaning, units or attribution. | reject |
| **Capability claims** | "đã chặn / đã khóa / đã hủy / đã xóa / đã mua" require a matching tool result in the same turn | reject |
| Repetition | Not near-identical (normalized) to any line emitted in the last 30 minutes | reject |
| Language | Locale matches the configured locale | reject |

The deterministic checks are a floor, not proof of complete semantic honesty. Before implementing grounded copy, define typed facts and action receipts, including units, freshness and partial outcomes. Test wrong-unit claims, written-out numbers and paraphrased success claims. Use system-rendered factual confirmations where a text validator cannot establish correctness.

Speech suppression applies before generation, retry and fallback. It does not prevent an explicit user request from receiving a response. Fallback profile/intensity mapping remains to be specified; it must include the silent profile.

Rejections are never silent: log `tone.rejected` with the check id, `packId`, `ruleId`, and the prompt version. The check id is what makes the failure ladder and the eval meaningful.

## 6. Failure ladder

`generate → validate → (fail) retry once with the reason appended → (fail) fallback line`

- The retry gets one more attempt with the specific violation named. Never loop further.
- The intervention still renders even when the line fails: the gate, the escape button, and the plain-language reason are produced by the kernel, not by the model.
- The activity log marks fallback-sourced lines as fallback. We never claim the model said something it did not.
- Three consecutive rejections of the same check in one session mark the provider suspect and widen logging.

## 7. Fallback line packs

`packages/tone/fallback/vi.json` — a small curated set, roughly five lines per policy state × two intensities, deliberately plainer than the persona. In this build the curated set lives in `packages/agent/src/lines/vi.ts`, is the **default** provider, and is also what every failed model turn falls back to.

- Same floor applies: no fabrication, no cruelty, exit legible.
- No placeholders that require data which may be missing; fallbacks must work with nothing but the state.
- Used only when the model is unreachable or validation fails twice. They are a safety net, not the voice.
- Tone lint runs on them like any other pack (`docs/engineering.md` §3).

## 8. Prompt versioning and the tone check

`prompts/persona.md` carries a header: `version`, `locale`, `updated`, `owner`. The kernel refuses to start if the header is missing a version, and logs the version with every turn.

**Hackathon scope:** `pnpm tone:eval` is a smoke check, not a harness.

- 6 scenarios — first warning, gate, override just happened, no data available, model offline, very late night — one sample each.
- Automated checks only: validator pass rate, and zero fabricated-number or capability-claim violations.
- Threshold: 6/6 lines pass the validator. One fabricated number fails the run.
- Run it before committing a prompt change and before the demo rehearsal.

The full harness — 24 scenarios × 3 samples with a rubric judge scoring in-character voice, groundedness and "would this annoy you by the third time" — is post-hackathon work (`docs/vision.md`). The validator itself is runtime code, covered by the required headless checks (`docs/engineering.md` §3), and it is what lets the model own the wording.

## 9. Editing the persona — checklist

1. Keep the counter-examples. They do more work than the positive rules.
2. Add examples only for situations the model actually gets wrong; examples are style guides, not a phrase bank.
3. Never add a rule the validator cannot check, unless it is genuinely advisory.
4. Bump `version` and run the tone smoke check (§8).
5. If a rule keeps failing, fix the validator or the context — not the prompt's tone of voice.
