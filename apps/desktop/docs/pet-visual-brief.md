# Pet Visual Brief — art and model requirements

> Non-normative for engine work. Art production lives here so it does not clutter `docs/engineering.md`.
> The renderer is species-agnostic: nothing here may leak into policy logic, and swapping the character must not require a code change.
> Renderer is decided: **Live2D via pixi.js** (`docs/adr/0002-character-renderer.md`). Concepts: `docs/character-concepts.md`. Image-generation prompts: `docs/character-prompts.md`.

## Concept

**Not chosen yet.** Three screen-face proposals are in `docs/character-concepts.md`, each with a self-contained Gemini prompt in `docs/character-prompts.md`; approval is `AGENTS.md` open decision #3.

Regardless of which wins, the same rule applies:

- It must read as a **pet** — soft, small, round, adoptable.
- The hostility lives in the face, the timing and the voice, never in the silhouette.
- Style: 2D cartoon, clean outline, flat cel shading, at most two tones per colour.
- Angle: front view, consistent with the concept prompts and across every state.
- No background, no text, no speech bubble, no complex props baked into the model.
- Do not clone an existing character or IP. Record provenance and licence per asset.
- Default palette direction: charcoal `#25252B`, warm ivory `#F5F1E8`, muted amber `#E9B44C` — with enough contour contrast to read on both light and dark desktops.

## Model requirements

| Item | Requirement |
| --- | --- |
| Format | Live2D Cubism model: `.model3.json` + `.moc3` + texture atlas + motions + expressions + physics |
| Source art | Part-separated body, blank panel, limbs and device accessories. Screen faces are drawn at runtime; organic face layers apply only to a rigged-face model |
| Texture atlas | 2048 × 2048 max, RGBA, sRGB, PNG. Prefer one atlas per character |
| Model canvas | Design at 2× the largest display size; the model is scaled down, never up |
| Display size | 96–140 CSS px on the desktop; larger in the pack manager preview |
| Runtime | Cubism Core **bundled locally**, never loaded from a CDN — the pet must animate with no network |
| Padding | ~10–15% safe area inside the canvas so limbs and motion are not clipped |
| Physics | Drives secondary parts (tentacles, tufts, tail). Optional, but it is the cheapest "alive" there is |

### Parameter contract

Use the standard Cubism parameters where one exists, so any future model behaves consistently:

`ParamAngleX/Y/Z` · `ParamBodyAngleX/Y/Z` · `ParamEyeLOpen` · `ParamEyeROpen` · `ParamEyeBallX/Y` · `ParamBrowLY` · `ParamBrowRY` · `ParamMouthOpenY` · `ParamMouthForm` · `ParamBreath`

Character-specific parameters (from the concept sheet in `docs/character-concepts.md`) are how escalation becomes visible without new art — for example `ParamReelL/R` (cassette reels), `ParamAntenna` (the CRT's ear), or a squash on the battery cell. For a screen-face character most expression work lives in the panel texture, not in parameters.

Custom parameters are declared in the character manifest so the app can drive them by name rather than by index. Indices are not a contract; names are.

### Motions and expressions

| App state | Motion | Expression |
| --- | --- | --- |
| `idle` | slow loop | neutral |
| `suspicious` | play once, hold | narrowed, one brow |
| `intervene` | play once, hold | flat deadpan |
| `thinking` | short loop | eyes up |
| `pleased` | play once | half-lidded, smug |
| `sleeping` | slow loop | eyes closed |
| `dozing` | slow loop, eyes open now and then | eyes closed, briefly open |
| `focused` | still | eyes crossed inward, narrow |
| — | blink on a sparse timer | blink |

`dozing` and `focused` are driven by the macOS Focus sensor (ADR 0007): `sleeping` is the Sleep
mode, `dozing` is Do Not Disturb and every mode with no look of its own, `focused` is a work
mode. They are the shell's states until a character pack provides them, and they are not part of
the required set above — a pack that omits them declares them in its `fallbackMap` like any
other.

A missing motion or expression falls back along `fallbackMap`. It must never fail to render.

## Character packs (portable characters)

A character is a **pack** the user can swap, not a hardcoded asset in the app — `docs/packs.md`, applied to presentation.

```jsonc
{
  "manifestVersion": 1,
  "id": "hp.<character>",
  "kinds": ["character"],
  "renderer": "live2d@1",
  "faceMode": "rigged",
  "name": "…",
  "version": "0.1.0",
  "license": "…",
  "model": "model/<name>.model3.json",
  "motions": { "idle": "idle", "suspicious": "suspicious", "intervene": "intervene",
               "thinking": "thinking", "pleased": "pleased", "sleeping": "sleeping" },
  "expressions": { "neutral": "neutral", "flat": "flat", "smug": "smug" },
  "parameters": { "escalation": "ParamAntenna" },
  "fallbackMap": { "blink": "idle", "pleased": "idle" },
  "palette": { "primary": "#25252B", "accent": "#E9B44C", "surface": "#F5F1E8" },
  "menuBarIcon": "icons/menubar.png",
  "preview": "preview.png"
}
```

Rules:

- The required state set is the contract: a pack MUST provide at least `idle`, `suspicious`, `intervene`, `thinking`, `pleased`, `sleeping`, or declare a `fallbackMap` for any it omits. Missing states degrade, never crash.
- `focused` and `dozing` are **optional on top of that set**, and the app supplies placeholder versions of both. A pack that omits them falls back rather than failing lint.
- A Focus-driven expression MUST NOT be shown unless the sensor actually read an active mode. `statusSchema` rejects the combination, so a pet that could not read the database cannot look like it did.
- `renderer` is mandatory. A pack whose renderer the app does not support is reported as **unavailable** in the pack manager, never rendered blank.
- `faceMode` declares how the face is produced: `rigged` (parameters drive eyes, brows and mouth) or `screen` (the face is a texture the app draws at runtime into the model's screen area). A `screen` pack declares its screen rect, mask and glyph palette; its expressions are data, not art.
- A `live2d@1` pack that fails to load (missing `.moc3`, bad atlas, runtime error) degrades to the placeholder renderer and says so in the activity log.
- Swapping or removing a character MUST NOT change policy behaviour, tone, or any stored data.
- Pack lint checks that every referenced motion, expression, parameter and file actually exists; wrong sizes or a missing monochrome menu bar icon fail the pack, not the app.
- Art must be licensed and attributed in the manifest. Community packs follow the same path as [Awesome-BongoCat](https://github.com/ayangweb/Awesome-BongoCat): a shared repository, imported by users, no core changes.

The example above describes a rigged-face model, not the production screen-face contract. Before art handoff, define a complete screen-face manifest and verify compositing in the Electron renderer on macOS: screen coordinates, mask, mesh/deformation mapping, clipping, glyphs and timing. Do not freeze a rig around an unverified compositor.

### Screen-face characters

For `faceMode: "screen"` characters (`docs/character-concepts.md`), the body is rigged in Live2D and the face is a canvas texture the app composites into the model's screen area each frame.

- Concept art for these characters MUST be generated with the panel **blank or dark** as well as with a sample face, so the runtime texture is not fighting a baked one. Matte glass only — no glare, no reflection, no highlight streak.
- The screen shows live state, not just mood: remaining allowance, the elapsed counter, model offline, browser disconnected, paused. Offline, disconnected and paused MUST look different (`docs/protocol.md` §5).
- Readability rule: at most two or three elements on the panel. Fine glyphs are invisible at 96 px.
- The bezel LED means "observing". When the pet is paused or a sensor is off, the LED is dark and the panel dims. This is a privacy statement, not decoration.
- Screen content per state is declared as data: glyph, colour, timing. Adding an expression must not require new art.

## Rigging is the risk

Gemini produces pictures, not models. Between an approved character sheet and an animating pet sit part separation, meshing, deformers, parameters and physics — all manual. Timebox it, and if the model is not animating when the box closes, use a free official Live2D sample model for the demo, labelled as not ours, and keep the generated character as the app icon, onboarding art and pack preview. Full paths and the timebox: `docs/character-concepts.md`.

Review the Live2D Cubism SDK / Cubism Core licence terms before distributing, not after.

## Placeholder art

Placeholder shapes are acceptable while the model is being rigged, but they MUST be labelled as placeholders in the UI, and no screenshot of a placeholder may be presented as the finished character (`AGENTS.md` non-negotiable #10).

The desktop scaffold records placeholder artwork in Settings; the floating pet has no permanent label underneath. The tray and Settings offer explicit idle, thinking and text-above previews. Thinking uses an eyes-up pose and animated dots (static with Reduce Motion); the speech bubble is labelled “VISUAL DEMO” and can be dismissed. These previews make no model request and are not agent activity. The pet window expands only during a preview, preserving its bottom-center anchor where screen bounds permit.

## Prior art worth borrowing

[BongoCat](https://github.com/ayangweb/BongoCat) validated this model: a Tauri app with importable custom models, an online converter for third-party formats, a community model repository, and a fully offline, no-telemetry posture. Its custom characters are Live2D models rendered through `pixi.js` + `easy-live2d` — the same family we chose in `docs/adr/0002-character-renderer.md`. Two things transfer: a **converter path** so existing community art is not stranded, and the assumption that **the community, not the core team, supplies most characters**. Both are horizon items, not this build.

Optional stretch, only if the pack runtime already works: the pet reacting to device input (a paw thump per keystroke) is a *sensor* pack plus a character motion, not a renderer feature. Keep it out of the engine. BongoCat does this today with `rdev`; for us it needs its own capability and the activity-events-only rule in `docs/vision.md`.
