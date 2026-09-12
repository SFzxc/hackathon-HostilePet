# Character: monthly-salary-cat — provenance and licence status

**Licence status: none stated. This is third-party, user-uploaded art. It is not cleared for
distribution.**

Working rule 6 of `AGENTS.md` says art with no licence must be recorded as missing rather than
quietly used. This file is that record.

## Where it came from

| | |
| --- | --- |
| Source | `https://codex-pets.net/api/pets/monthly-salary-cat` |
| Download | `https://codex-pets.net/api/pets/monthly-salary-cat/download?v=1780647673803` |
| Pet id | `monthly-salary-cat` |
| Display name | Monthly salary cat（月薪猫） |
| Uploader | `vjokaye` (owner handle and name as published by the API) |
| Uploaded | 2026-06-05T08:21:13.803Z |
| Sheet version | `spriteVersionNumber: 1` |
| Fetched | 2026-09-12 |

Vendored verbatim, unmodified:

| File | sha256 |
| --- | --- |
| `spritesheet.webp` | `69c4853413844bc8a91b986583dc47c8bdb99270dcad2e461afd81a881c7e4cc` |
| `upstream-pet.json` | `7f6eeb8c949c315db47e7043073af63ff6a584636ae57ae6bb9ad652a82ea064` |

`upstream-pet.json` is the pet's own manifest, kept exactly as downloaded so the vendor copy can
always be diffed against the source.

## Why the licence question is open

- The `codex-pets` **CLI** is MIT (`codex-pets@0.3.0`). That licence covers the installer, not the
  art it installs.
- The pet API publishes **no licence field at all** — not in the JSON metadata, not in
  `upstream-pet.json`. There is nothing to point at that grants redistribution.
- The pet's own description reads "a 1:1 restored animated pet version of the **uploaded**
  white-and-brown teary character", which suggests the sheet was reproduced from a character
  somebody else drew. That is a second, unresolved layer.

## What this means in practice

- **Local demo: the user's call, on the user's machine.** Fine to run, and it is what this build
  ships while there is no character of our own.
- **Public distribution: not cleared.** Before any public release this character has to be
  either replaced with art we made (`prompts/` + `docs/character-prompts.md` exist for exactly
  that) or licensed in writing from `vjokaye`.
- When it is replaced, delete this directory and the mapping with it; nothing outside it should
  have to change.

## The atlas contract is not ours either

`src/renderer/pet/atlas.ts` transcribes the shared Codex pet atlas contract (8×9 grid, per-row
frame counts and frame durations) from `codex-pets-react@0.2.0`, which is MIT. The attribution
lives in that file's header.
