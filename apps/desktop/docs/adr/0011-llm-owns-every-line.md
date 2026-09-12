# ADR 0011 — The model owns every line: no fallback copy, no demo bubble

**Status:** accepted for this build
**Related:** `AGENTS.md` non-negotiables 3 and 6 and working rule 8, ADR 0006 decision 6, `docs/tone.md` §5–7, `docs/agent.md` §6–7, `docs/pet-visual-brief.md`, `docs/hackathon.md` §4, `docs/product.md` §2

## Context

Two things in the build could put words on screen that no model wrote.

The first was shipped deliberately: `packages/agent/src/lines/vi.ts` held 36 curated Vietnamese
lines keyed by escalation level and site bucket. It was the **default** provider — the demo ran on
it by design, because it needed no network — and it was also the fallback for every model turn that
failed, timed out, or came back as prose instead of JSON.

The second was scaffolding: a `VISUAL DEMO` speech bubble in the renderer with two canned sentences
("Thinking…" and "I'm here. Get on with your work."), issued by the `preview-thinking`,
`preview-speaking` and `preview-idle` commands.

Both were defensible while there was no key. Once the model path worked, both did the same damage:

- **A person cannot tell the two voices apart.** A curated line arrives in the same bubble, in the
  same voice, with the same timing as a generated one. The badge was the only difference, and a
  badge is not what someone watching a pet reads.
- **A curated line is ungrounded by construction.** It is selected from an escalation level, not
  from what actually happened, so it can describe a state the person is not in — which is
  fabrication by non-negotiable 6, in the one place the product cannot afford it. The validator
  never saw these lines at all.
- **It hid the real failure.** ADR 0010 recorded the honest version of this: `HOSTILEPET_PROVIDER=openai`
  with no key ran the curated provider, so the app "ran and looked correct while the model never ran
  at all". A stand-in is exactly the kind of thing that makes a broken model path look finished.

Non-negotiable 3 is the tie-breaker: *deterministic rules own enforcement; the model owns language*.
A curated line is neither — it is a constant wearing the model's clothes.

## Decision

1. **Every line the pet says is written by the model.** `packages/agent/src/lines/vi.ts` and the
   `FALLBACK_LINES` table are deleted (36 lines, `bucketFor`, `SiteBucket`), and
   `packages/agent/src/index.ts` no longer exports them.
2. **The last rung of the turn is silence, not copy.** `run-turn.ts` is now
   `generate → clamp → validate → retry once with the reason → silence`: two model attempts, then
   `{ say: '', mood: escalationLadder[level].defaultMood, action: 'mood_only' }`. The face still
   changes, so the intervention still reads as one; there is simply nothing to read.
3. **Provenance survives the silence.** That decision is stamped `source: 'fallback'` with
   `attempts: 3`, so the event log and Settings can still say "no model produced this turn" rather
   than leaving an unexplained gap. The vocabulary in `packages/agent/src/outcome.ts` is unchanged;
   only what fills it is.
4. **The no-model provider says nothing too.** `createFakeProvider` no longer rotates curated lines;
   it returns the same silent decision. It stays selected when `HOSTILEPET_PROVIDER` is not
   `openai`, or when the key or the persona artifact is missing — and `providerInfo.detail` still
   names which of those happened, because a silent pet with no explanation is indistinguishable
   from a broken one.
5. **The preview chain is deleted end to end.** The three `preview-*` commands leave
   `commandSchema`; `status.preview` leaves `statusSchema`; the renderer keeps only the agent bubble;
   `petExpression()` loses its `preview` parameter and its "preview wins" precedence rule; the
   `VISUAL DEMO` bubble and its `.thinking-dots` animation leave `style.css`; and the pet window now
   expands for exactly one reason — a real line (`refreshPet()`: `expanded = line !== null`).
6. **`speaking` stays in `petExpressionSchema`.** It is part of the character vocabulary a pack must
   satisfy (`docs/pet-visual-brief.md`), not a shell state. Nothing in the shell selects it today,
   and that is the point: a face is worn because something happened.

## Consequences

**Positive**

- One writer. A line on screen is now proof that a model ran, and `source` no longer has to carry an
  argument the design should have prevented.
- Non-negotiable 6 stops depending on how well a canned line happens to fit the moment.
- A missing key, a 401, an offline venue and a malformed answer all produce the same honest result —
  a pet that reacts silently — instead of four different sentences pretending to be judgment.
- The codebase is smaller: a line table, a bucket function, three commands, a status field, a bubble
  and an animation are gone.

**Negative**

- **A demo with no network now shows a wordless pet.** The old build degraded into something that
  looked alive; this one degrades into something that looks switched off. The mitigation is not in
  the code: it is the spoken script (`docs/hackathon.md` §2 now says to name the silence instead of
  filling it) and Settings, which names the provider and the reason.
- A first run with no key is quiet and needs a moment of reading to understand. This is the cost of
  not having two voices, and it is paid once per machine.
- `docs/tone.md` §8's tone eval loses one of its six scenarios as a gradeable line: `model offline`
  now asserts an absence, not a sentence.
- `speaking` becomes a pack-side face with no shell state behind it, which will read as dead
  vocabulary to anyone who does not know why.

## Alternatives

| Option | Why not |
| --- | --- |
| **Keep the curated set as the fallback only** (what shipped) | The words still reach the screen without a model, and the person watching cannot tell them from generated copy. The one thing the fallback was for — not leaving the pet mute — is the one thing that made the model path unverifiable. |
| **Keep it behind `HOSTILEPET_PROVIDER=curated`** | One variable away from the confusion above, and every screenshot becomes ambiguous: the UI badge would have to carry the honesty that the design should. A second voice is a second product. |
| **Keep the `VISUAL DEMO` bubble for rehearsals** | It was already unreachable from the UI (only `scripts/smoke.cjs` issued `preview-*`), so it demonstrated nothing a user could do — and it put two sentences on screen that the pet never thought. |
| **Show a neutral "…" or a thinking animation instead of a line** | A glyph that reads as *the pet is about to speak* is a claim, and a worse one: it survives screenshots, where an explanation does not. Same mistake as the demo bubble, with less honesty. |
| **Let the rule engine pick a canned line** | Non-negotiable 3: rules decide *whether* something happens, not what is said. It would also put dialogue in the kernel, which non-negotiable 1 forbids. |
| **A pack-shipped line table** (future) | Not closed off. A pack owns its persona, so a pack may ship its own copy someday — but it must be labelled as the pack's, not the model's, and `source` will need a third value for it. This ADR deletes *the shell's* stand-in voice, not the pack's right to have one. |

## Verification

- `pnpm -r typecheck`: `packages/agent`, `packages/contracts` and `apps/desktop` all clean.
- `pnpm -r test`: 54 of 56 desktop cases pass. The 2 red ones in
  `apps/desktop/src/shared/desktop.test.ts` are the pre-existing stale fixture (it builds a status
  object with no `petLine`/`events`/`catalog` and `agent: 'not-configured'`, a shape this schema
  stopped accepting several changes ago); this decision neither caused nor widened them, and fixing
  them is test work outside hackathon scope.
- Grep over `apps/desktop/src` and `packages/agent/src`: no `preview` field, command or bubble
  remains — only the two docblocks that record this removal.
- `static`: the packaged bundle and the dev-mode app both report the same provider behaviour:
  with the key, `provider: "openai"`, `isModel: true`, `detail: "gpt-5.6-luna · persona-vi@3 · key
  from env"`; with the key emptied in the launching shell (which wins over `.env`, ADR 0010), the
  provider that has no words, and Settings naming the missing key.

## Revisit triggers

- A demo genuinely needs a voice with no network — for example a stage with no wifi and no hotspot.
  The answer then is a pack-owned persona, labelled as the pack's, not a return of the shell's table.
- A pack ships copy that must reach the screen without a model (a reminder, a capability refusal).
  That is pack data, and `copy.source` needs the third value named above before it appears.
- The pet ever looks broken rather than quiet in user testing: the fix is in onboarding and Settings,
  not in a stand-in line.
