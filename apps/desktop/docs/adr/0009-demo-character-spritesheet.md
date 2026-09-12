# ADR 0009 — Character for the demo slice: a codex-pet spritesheet

**Status:** accepted for the demo slice — instructed by the human on 2026-09-12
**Related:** ADR 0002 (character renderer), `docs/pet-visual-brief.md`,
`apps/desktop/src/renderer/pet/atlas.ts`, `apps/desktop/src/renderer/pet/Pet.tsx`,
`apps/desktop/src/renderer/assets/characters/monthly-salary-cat/PROVENANCE.md`

## Context

ADR 0002 accepted **Live2D via pixi.js** as the character format, and in the same breath kept
sprite sheets as the fallback renderer for placeholder art. Live2D's schedule risk is rigging: a
flat generated image cannot be rigged, so every layer has to be produced part-separated before
Cubism Editor opens. The demo slice has no character at all — the shell draws a geometric face out
of two rectangles — and the first three seconds of the demo are the pet's face.

`monthly-salary-cat` is a pet published on `codex-pets.net`. Codex pets share **one atlas
contract**: an 8×9 grid of 192×208 cells whose rows mean the same thing in every pack, plus
per-frame durations. That contract is transcribed into `src/renderer/pet/atlas.ts` from
`codex-pets-react@0.2.0` (MIT).

The contract was verified against this specific sheet rather than taken on faith: the file is
exactly 1536×1872, and each of the nine rows holds exactly as many populated cells as its frame
count declares (6/8/8/4/5/8/6/6/6).

## Decision

**This build renders its character from a codex-pet spritesheet.** Concretely:

- `PetExpression` stays the boundary. Upstream code still deals in nine expressions and knows
  nothing about rows; `src/renderer/pet/Pet.tsx` is the only component that turns an expression
  into a row, exactly as the placeholder's own comment promised the swap would be.
- The **character's** `expressions` map lives in its asset directory as `character.json`, not in
  code. A different codex pet is a different directory, and no code changes.
- The sheet is scaled with `background-size: 800% 900%` and a percentage `background-position`, so
  a cell is selected without knowing the element's size. No canvas, no new dependency.
- Frame timing comes from the atlas contract's declared durations, rescheduled per frame; under
  `prefers-reduced-motion` the sheet holds on frame 0.
- An unmapped expression falls back to `idle`. A pet that vanished on an unmapped state would read
  as a crash.

ADR 0002 is **not** withdrawn: Live2D remains the accepted long-term renderer, and this is the
fallback path it already named. What changes is that the fallback is now what ships.

## Consequences

**Positive**

- A real animated character for zero art cost, and the harness for any other codex pet for free.
- The renderer is a plain `<div>` and a timer: no WASM runtime, no model-load failure mode, no
  version drift, nothing to verify in Electron that BongoCat prior art did not already cover.
- The expression → row indirection is the same shape a character pack will need, so the eventual
  pack loader has a worked example to replace.

**Negative**

- **The character is third-party art with no licence anywhere** — not in the API metadata, not in
  the pet's own manifest. Recorded in `PROVENANCE.md` per working rule 6. Fine on the user's own
  machine; **not cleared for public distribution**, and it must be replaced by art we made
  (`docs/character-prompts.md` exists for that) or licensed in writing before any release.
- Only nine rows exist, so our nine expressions are mapped, not drawn: `sleeping` and `dozing`
  both use `waiting`, and `thinking` and `suspicious` both use `review`. The pairs are
  distinguishable in the menu and the tooltip, not on the face.
- The placeholder's `dozing` detail — shut eyes that come open now and then — is gone. It was a
  CSS trick on two rectangles and does not survive contact with a fixed spritesheet.
- `resolveJsonModule` is enabled in the desktop `tsconfig.json` so a character's map can be data.
- Two renderers now exist in the codebase, which is the cost ADR 0002 already predicted, and the
  Live2D half is still unbuilt.
