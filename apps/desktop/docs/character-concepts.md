# Character concepts — 3 proposals to generate from

> Purpose: pick **one** character, then generate art for it. Status: awaiting pick (`AGENTS.md` open decision #3).
> Renderer is decided: **Live2D via pixi.js** (`docs/adr/0002-character-renderer.md`). The face is a runtime texture, so rig cost is low across the board.
> **Copy-paste image prompts live in `docs/character-prompts.md`** — complete and self-contained, palette inlined, one copy each. This file keeps the reasoning: thesis, rig cost, state mapping, comparison.
> After a pick, three files change: `docs/pet-visual-brief.md`, `prompts/persona.md`, `AGENTS.md`.

## Design rule (read this before judging any concept)

**It has to read as a pet you would keep.** Soft, small, round, adoptable. The hostility lives in the *face*, the *timing* and the *voice* — never in the silhouette. A scary monster that mocks you is a different, worse product: it is easy to dismiss and impossible to love. A cute little thing that is disappointed in you is the joke.

If you had a specific reference in mind for "pet-like", drop the image in and the prompts can be re-aimed at it — the three below are aimed at *small single-creature companion mascot*, not at any named character.

## Why the face is a screen

Every concept here is a small device whose **face is a display panel**. This is not a look, it is the architecture — and it is what makes these characters buildable in the time we have.

In a rigged face every expression is a mesh: brows, mouth, eyelids, each one art and each one work. In a screen face, **every expression is a texture the app draws at runtime**. Consequences:

- No brow, mouth or eye meshes to rig — only the body. Roughly halves the rig.
- The face can display **live state**, not just moods: the counter, remaining budget, low battery, "AI offline", "not observing". The pet becomes a tiny honest display for the agent instead of a decoration.
- New expressions cost code, not art. Escalation can be a red glyph, an emptying bar, digits ticking.
- The "observing" indicator becomes literal: one LED on the bezel that **goes dark when the pet is paused**. Privacy you can see on stage.
- It matches the product's own honesty rule (`docs/protocol.md` §5): offline, disconnected and paused are three visibly different states.

**Prompt language that makes or breaks the generation** (the prompts in `docs/character-prompts.md` already encode all four):

1. Name the material: *flat matte dark glass display panel*, *no glare, no reflection, no highlight streak*.
2. Name the content: *glowing pixel-square eyes*, or *a simple amber gauge*. Two or three elements at most — anything more is unreadable at 96 px.
3. Always ask for the panel **blank** in an extra view, because we composite the face ourselves and a baked face fights the runtime one.
4. Name the bezel and the LED separately, so the LED can be switched off.

## The three

### 1. Pin — the battery that is you

**Thesis.** A small battery creature whose face is a charge gauge wired to your remaining daily allowance. It does not *symbolise* the counter — it **is** the counter, rendered.

**Why it fits.** We already compute remaining allowance every tick. Put it on the pet's face and the invisible becomes the most legible thing on screen. "Pin yếu" is also the best nagging device in the set: it drains while you watch.

**Look.** Chubby rounded battery cell body, a small metal terminal nub on top like an antenna, two stubby legs, dark glass panel across the upper two-thirds of the body with a thin bezel. Charcoal shell `#25252B`, cream cap `#F5F1E8`, amber charge `#E9B44C`, alert red `#E5534B`.

**Rig cost: very low.** Body squash, two legs, terminal nub, one LED. The gauge is a texture.

| State | On the screen |
| --- | --- |
| `idle` | charge bar + two pixel-square eyes, slow blink |
| `suspicious` | bar dims, one eye squints, small `?` |
| `intervene` | bar red, blinking low-battery glyph, flat mouth line |
| `thinking` | three dots animating in sequence |
| `pleased` | brief decorative `+` glyph; gauge retains its actual value |
| `sleeping` | panel dark, one slow dim pulse |

**Prompt:** complete copy-paste prompt with the palette inlined — `docs/character-prompts.md` §1.

### 2. Tivi — the small CRT that has watched too much

**Thesis.** An old television that has been observing you for years and is tired of it. Scanlines, phosphor glow, dot-matrix eyes, and a rabbit-ear antenna with a red LED that lights only while it is actually watching.

**Why it fits.** Retro-terminal reads as "computer" without being a literal robot, and the LED makes the privacy stance visible: pause the pet and the light goes out, the screen dims. That is a demo beat, not a decoration.

**Look.** Rounded box body, dark glass screen face across the front, thin rabbit-ear antenna with a small red LED, two stubby legs, charcoal casing `#25252B`, phosphor green `#7CE38B`, amber accent `#E9B44C`.

**Rig cost: very low.** Body, antenna, two legs, LED. Plus a subtle screen-glow param.

| State | On the screen |
| --- | --- |
| `idle` | two dot-matrix eyes, slow blink, faint scanline drift |
| `suspicious` | one eye narrows to a line, a `?` appears |
| `intervene` | a hard white `✕` or a flat bar, warning stripe across the top |
| `thinking` | four-frame loader spinning |
| `pleased` | `^ ^` and a small check |
| `sleeping` | `z z` drifting up, panel nearly dark |
| paused | panel dark, **LED off** |

**Prompt:** complete copy-paste prompt with the palette inlined — `docs/character-prompts.md` §2.

### 3. Băng — the cassette that counts

**Thesis.** A compact cassette whose face window is a mechanical counter. The digits are your elapsed minutes. Nothing is symbolised; the number is right there.

**Why it fits.** Our whole first reference pack is "how long have you been on this today". A pet that displays `00:14` on its face is the clearest possible demo visual, and the reels give free motion: they spin while it thinks, stop dead when it disapproves.

**Look.** Rounded rectangular cassette body, dark glass window on the front holding two reels and a small counter, two tiny legs, charcoal and cream plastic shell, muted amber `#E9B44C`, alert red `#E5534B`.

**Rig cost: very low.** Body, two reel rotations, two legs. Counter and reels' content are textures.

| State | On the screen |
| --- | --- |
| `idle` | decorative reel motion; counter changes only with observed usage |
| `suspicious` | reels stop abruptly, counter dims |
| `intervene` | counter digits flash red, a `STOP` square appears |
| `thinking` | reels spin fast, counter blurs |
| `pleased` | reels reverse a quarter turn |
| `sleeping` | reels still, panel dark |

**Prompt:** complete copy-paste prompt with the palette inlined — `docs/character-prompts.md` §3.

## Rig plan (shared)

The body is the only thing that gets rigged: body squash/stretch, two legs, plus one or two character parts (antenna, reels, terminal). Parameters: `ParamAngleY`, `ParamBodyAngleZ`, `ParamBreath`, and per-character `ParamReelL/R` or `ParamAntenna`.

The face is a **pixi canvas texture** drawn by the app and composited into the model's screen area. The character pack declares `faceMode: "screen"`, the screen rect and mask, a glyph theme, and the palette (`docs/pet-visual-brief.md`). Face content per state is data — the same tables above, expressed as glyph + colour + timing.

## Comparison

| | Rig cost | Idle life | Voice hook | Distinction |
| --- | --- | --- | --- | --- |
| **Pin** | very low | gauge draining | "pin ông còn 15 phút" | the counter, made visible |
| **Tivi** | very low | scanline drift, LED | "tôi ngồi đây cả ngày rồi" | privacy you can see; most AI-native |
| **Băng** | very low | reels turning | "tôi đang đếm" | clearest demo visual |

All three rig in about the same time, so the tiebreaker is not cost:

- **Pin** if the judging weight lands on theme alignment and the counter. Its face *is* the product's core number, and a draining gauge is the best nagging device of the three.
- **Tivi** if the weight lands on "does this look like an AI product" and on the agentic story. The antenna LED going dark on pause is the single strongest privacy beat available, and the CRT face is the least ambiguous silhouette.
- **Băng** if the weight lands on demo legibility. `00:14` on the pet's face needs no explanation to a judge who has missed the first thirty seconds.
- Buyers' note: **Tivi** is the safest prompt of the three to generate — a box, a flat panel and two pixel eyes leave the model little room to draw something wrong.

## Rigging reality check (the biggest schedule risk in the whole plan)

Generating a picture with Gemini is not making a Live2D model. A flat image has no separated parts and no mesh; Live2D needs both, and that work is manual. **The screen face shrinks this problem**: no brows, no mouth, no eye meshes — the face is a texture the app draws, so only the body gets rigged. Three honest paths:

| Path | Cost | What you get |
| --- | --- | --- |
| **A — minimal rig (recommended)** | 3–5 h after the art is part-separated | Body sway, two legs, one or two device parts, physics. "Alive enough" for a demo. |
| **B — official sample model** | ~0 h | A polished model that is not ours, clearly labelled as such in the UI. Keeps the demo alive if rigging slips. |
| **C — full rig** | days | Mesh, deformers, physics, six motions. Not compatible with a hackathon unless someone already knows Cubism Editor. |

**Timebox the rig.** If the model is not animating after the box you set, fall back to Path B for the demo and keep the generated character as the app icon, onboarding art and pack-manager preview. That is a legitimate outcome, but it must be labelled — we do not claim art we did not rig.

Also to review before shipping publicly: the Live2D Cubism SDK / Cubism Core runtime carries its own licence terms, separate from the art. Check them before distributing, not after.

## Pipeline

1. Gemini: character sheet (prompt A) → iterate until the silhouette is right. One good image is a concept, not an asset set.
2. Gemini: screen sheet (prompt B) using the approved sheet as the reference image. The blank-panel view is required.
3. Separate parts in Photoshop / Krita / Figma: body, panel (kept empty), legs, device parts, LED. Export as layers.
4. Cubism Editor: mesh + deformers + parameters + physics → export `.moc3` / `.model3.json` / textures.
5. Pack it: `renderer: "live2d@1"`, `faceMode: "screen"`, motions and expressions declared in the character manifest (`docs/pet-visual-brief.md`).
6. Keep the layered source in `assets/pet-source/` and record provenance and licence per asset.

## Dropped directions

Recorded so the decision is not silent, and so nobody rebuilds them by accident. These are design context only, not additional implementation requirements.

| Dropped | Idea in one line | Why dropped |
| --- | --- | --- |
| Mọt (weevil) | a pest that literally lives on what you waste | organic body — every expression is a mesh |
| Xù (hedgehog) | quill clusters show policy state with no UI text | its one good trick is replicable by a panel |
| Cóc (toad) | the grumpiest face with the fewest parts, sitting still | cheapest organic rig, but still a face rig |
| Mực (octopus) | the activity log with a face; "tôi ghi sổ" | medium rig cost for the least product tie-in |
| Cú (owl) | silent judgment; ear tufts as a second channel | safest and least distinctive of the set |

The screen-face direction was selected for rig cost, expressiveness and theme fit. Dropping the organic family also removed an internal inconsistency: `faceMode` exists either way, and shipping two face architectures for one demo character is work with no payoff.

## After you pick

1. `docs/pet-visual-brief.md` — replace the concept section with the winner, its palette, part list and parameter list.
2. `prompts/persona.md` — the "Bạn là ai" section is already character-agnostic: `{{character_name}}` and `{{character_look}}` are filled from the active character pack. Nothing to rewrite; just confirm the pack's name and description read well in Vietnamese.
3. `AGENTS.md` — close open decision #3.
