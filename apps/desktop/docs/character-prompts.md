# Character prompts — copy-paste sheet

> Owns: the image-generation prompts. **Every prompt below is complete and self-contained** — style, framing and palette are inlined, so one copy is enough. Nothing here refers to another block.
> All three are **screen-face** characters: the body is rigged, the face is drawn by the app at runtime. Design rationale, rig plans, state mappings and the comparison live in `docs/character-concepts.md`.

## How to use

1. Paste a **prompt A**, generate square (1:1) at the highest resolution available. Re-roll until the sheet has: exactly one creature, centered, plain white background, no text, no props, clean outline.
2. Approve one sheet. Then **attach that image** and paste the matching **prompt B**, so the views keep the same body.
3. **The blank-panel view is mandatory.** We composite the real face at runtime. Controlled cleanup is allowed; verify clean edges and reconstruct hidden parts before rigging.
4. Colours are given as **name first, hex in brackets**. Image models read names far more reliably than hex codes — the name carries the meaning, the hex keeps the palette unambiguous when you generate variants or hand the image to an editor.
5. Prompt A produces one concept. Prompt B produces seven static reference views in a clearly separated grid; motion descriptions indicate a representative pose, not an animation. Screen glyphs are allowed despite “no text”; captions and branding are not. These images are references, not layered production assets.

## Palette reference

| Concept | Shell | Secondary | Screen glow | Alert |
| --- | --- | --- | --- | --- |
| Pin | charcoal `#25252B` | warm ivory `#F5F1E8` | amber `#E9B44C` | red `#E5534B` |
| Tivi | charcoal `#25252B` | warm ivory `#F5F1E8` | phosphor green `#7CE38B` | red `#E5534B` |
| Băng | charcoal `#25252B` | cream `#F5F1E8` | amber `#E9B44C` | red `#E5534B` |

All three share one panel colour: near-black glass `#0E1014`.

---

## 1. Pin

### Prompt A — character sheet
```text
a tiny chubby battery creature, rounded battery cell body in charcoal (#25252B) with a
warm ivory (#F5F1E8) cap, a small metal terminal nub on top, two very short stubby legs,
the upper two thirds of the front is a flat matte dark glass display panel in near-black
(#0E1014) with a thin bezel, the panel shows a simple glowing amber (#E9B44C) battery
gauge bar and two small glowing amber pixel square eyes, no glare and no reflection on
the glass, cute chibi desktop pet mascot, front view, full body, standing, perfectly
centered, plain flat pure white background, thick clean dark outline, flat cel shading
with at most two tones per colour, no gradients, no texture noise, no dramatic lighting,
no cast shadow, no ground shadow, no text, no watermark, no logo, simple round silhouette
that stays readable at 96 pixels, big head and tiny limbs, grumpy unimpressed expression,
soft rounded shapes, single creature, high resolution concept sheet
```

### Prompt B — screen sheet (attach prompt A)
```text
same battery creature as the attached reference image, identical body, cap, legs and
proportions in all seven views, front views showing only different screen contents,
screen one: full amber glowing gauge bar with two pixel eyes, screen two: dim gauge with
one squinting eye and a small question mark, screen three: gauge in alert red (#E5534B)
with a blinking low battery symbol and a flat mouth line, screen four: three animated
dots in sequence, screen five: full amber gauge with a plus sign, screen six: completely
dark blank near-black panel, screen seven: the whole creature with the panel completely
blank and dark, flat matte glass with no glare and no reflection, thick clean dark
outline, plain flat pure white background, no gradients, no cast shadow, no text,
no watermark, no logo, high resolution
```

## 2. Tivi

### Prompt A — character sheet
```text
a tiny retro CRT television creature, rounded box body in matte charcoal (#25252B), the
whole front is a flat matte dark glass screen in near-black (#0E1014) with a thin bezel,
two small glowing phosphor green (#7CE38B) dot-matrix pixel eyes on the screen, a thin
rabbit ear antenna with a tiny red (#E5534B) LED on the casing, two very short stubby
legs, soft phosphor glow, no glare and no reflection on the glass, cute chibi desktop pet
mascot, front view, full body, perfectly centered, plain flat pure white background,
thick clean dark outline, flat cel shading with at most two tones per colour,
no gradients, no texture noise, no dramatic lighting, no cast shadow, no ground shadow,
no text, no watermark, no logo, simple round silhouette that stays readable at 96 pixels,
big head and tiny limbs, grumpy unimpressed expression, soft rounded shapes,
single creature, high resolution concept sheet
```

### Prompt B — screen sheet (attach prompt A)
```text
same retro television creature as the attached reference image, identical body, bezel,
antenna, legs and proportions in all seven views, front views showing only different
screen contents, screen one: two phosphor green dot-matrix eyes blinking with a faint
scanline, screen two: one eye narrowed to a line with a small question mark, screen
three: a large white cross with a red (#E5534B) warning stripe across the top, screen
four: a spinning four frame loader, screen five: a happy caret face with a small check
mark, screen six: drifting z letters on a nearly dark panel, screen seven: the whole
creature with a completely blank dark screen and the red LED switched off, flat matte
glass with no glare and no reflection, thick clean dark outline, plain flat pure white
background, no gradients, no cast shadow, no text, no watermark, no logo,
high resolution
```

## 3. Băng

### Prompt A — character sheet
```text
a tiny cassette tape creature, rounded rectangular body like a compact cassette, shell in
charcoal (#25252B) and cream (#F5F1E8) plastic with a muted amber (#E9B44C) accent, a flat
matte dark glass window in near-black (#0E1014) on the front containing two small reels
and a tiny mechanical counter, two very short stubby legs, no glare and no reflection on
the glass, cute chibi desktop pet mascot, front view, full body, perfectly centered,
plain flat pure white background, thick clean dark outline, flat cel shading with at most
two tones per colour, no gradients, no texture noise, no dramatic lighting, no cast
shadow, no ground shadow, no text, no watermark, no logo, simple round silhouette that
stays readable at 96 pixels, big head and tiny limbs, grumpy unimpressed expression,
soft rounded shapes, single creature, high resolution concept sheet
```

### Prompt B — screen sheet (attach prompt A)
```text
same cassette creature as the attached reference image, identical body, shell, legs and
proportions in all seven views, front views showing only different window contents,
window one: two reels turning slowly with a ticking counter, window two: reels stopped
abruptly with a dimmed counter, window three: counter digits flashing in alert red
(#E5534B) with a stop square, window four: both reels spinning fast, window five: reels
reversed a quarter turn, window six: still reels on a dark window, window seven: the
whole creature with a completely blank dark window, flat matte glass with no glare and
no reflection, thick clean dark outline, plain flat pure white background, no gradients,
no cast shadow, no text, no watermark, no logo, high resolution
```
