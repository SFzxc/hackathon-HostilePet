# ADR 0002 — Character rendering format

**Status:** accepted — Live2D via pixi.js
**Related:** `docs/pet-visual-brief.md`, `docs/character-concepts.md`, `docs/packs.md` §2 (character pack), `docs/stack.md` §1

> Runtime update: ADR 0004 replaces the original Tauri host with Electron. Live2D remains accepted; model load, performance and screen compositing must be verified in Electron rather than inferred from Tauri prior art.

> Demo update: the fallback renderer named below is what the demo slice actually ships, with a third-party codex-pet character. Live2D is still the accepted long-term format. See ADR 0009.

## Context

A character pack needs a data format for "a portable character a user can swap". Two options are proven on this exact platform (Tauri 2 + webview):

- **Sprite sheets on Canvas 2D** — what `docs/pet-visual-brief.md` originally sketched: 512×512 frames, an animation manifest, a state → animation map.
- **Live2D Cubism, rendered through `pixi.js`** — what BongoCat v1.1.0 ships (`pixi.js` 8 + `easy-live2d`), together with a community model ecosystem and an import path for user-supplied models.

Performance was never the deciding factor: BongoCat proves a Live2D rig renders fine in a small always-on-top window on this stack. The trade-off was authoring cost and licensing — sprite sheets are cheap to make and expensive to make *alive*; Live2D is the reverse.

## Decision

Render characters as **Live2D Cubism models through `pixi.js`**. The character pack declares `renderer: "live2d@1"` and points at a `.model3.json` plus its textures, motions and expressions.

Consequences for how we work:

- **Art must be produced part-separated from the start.** A flat generated image cannot be rigged. Eyes (whites + pupils), brows, mouth, head, body, limbs and accessories are separate layers before Cubism Editor opens.
- **Screen-face characters are body-rigged and face-generated.** The pack declares `faceMode: "screen"`; pixi composites a runtime canvas texture into the model's screen area, so the face can show live state — the counter, remaining allowance, offline, paused — instead of baked art. This is the cheapest expressiveness we have: no brow or mouth meshes, and a new expression costs code rather than art.
- **Rigging is the schedule risk**, so it is timeboxed with a documented fallback: if the model is not animating inside the box, the demo uses a free official Live2D sample model, clearly labelled as not ours, while the generated character stays as icon and onboarding art (`docs/character-concepts.md`).
- **Licence review is a real task, not a footnote.** The Cubism SDK / Cubism Core runtime carries its own terms separate from the art we generate. Review before public distribution.
- The README-level promise of a BongoCat-style community model ecosystem stays a horizon item: a `.moc3` in our manifest keeps that door open, importing arbitrary third-party models does not ship in this build.

## Consequences

**Positive**

- Continuous motion, breathing, physics and blinks for a fraction of the art that sprite frames would need.
- The "alive" feel is the product's first impression; this is where it is cheapest to buy.
- Character packs can later accept models users already own, which is how BongoCat's content ecosystem sustains itself.
- Parameter-driven states (a squash, an antenna, a spinning reel) let one rig express escalation without new art per part; a screen face goes further and lets the pet *display* state honestly, from the counter to "AI offline".
- The pet's honesty requirements — offline, disconnected, paused, not observing — become visible without extra art, which is otherwise easy to skip under time pressure.

**Negative**

- Heavier renderer dependency than our own Canvas loop: `pixi.js` plus a Live2D wrapper, and a WASM/JS Cubism Core runtime.
- Two new failure modes to handle: model fails to load, and renderer version drift. A character whose `renderer` the app cannot load is reported as unavailable in the pack manager, never rendered blank.
- The sprite-sheet path stays in the codebase as the fallback renderer for placeholder art, so two renderers exist during the build.

## Alternatives

| Option | Why not |
| --- | --- |
| **Sprite sheets on Canvas 2D** | Cheapest to author, no extra dependency, but the idle motion has to be earned frame by frame — poor value for the demo's first three seconds. Retained as the placeholder/fallback renderer. |
| **Rive / Lottie** | Similar rigged-vector benefit, no Cubism model ecosystem, still an editor dependency. |
| **CSS/DOM animation** | Cheap for one character, poor as a portable data format for third-party art. |

## Revisit triggers

- `pixi.js` 8 + Live2D wrapper compatibility turns out to be unworkable (verify item in `docs/stack.md` §2).
- The licence review rules Cubism out for distribution.
- Rigging overruns its timebox on the first character — then the fallback is used for the demo and this decision is re-examined after.
