# Product — brief, principles, scope

> Owns: what HostilePet is, what ships in this build, what is forbidden. Judging criteria live in `docs/hackathon.md`.

## 1. Brief

HostilePet is a **local-first agentic desktop companion**. A small pet lives on the desktop; behind it a kernel turns opt-in signals into deterministic policy and calls an LLM only where judgment or language is needed. Everything the pet does is defined by **packs** — installable bundles of sensors, rules, actions, personas and characters.

The first release ships a browser sensor and two reference packs (short-form video, impulse shopping) because they demo well and exercise the whole pipeline. Architecturally they are examples of a pack, not the app.

**Pitch:** Most agents help you do what you ask. HostilePet helps you not do what you'll regret.

### What makes it different

1. **The agent has a body.** Intent, refusal and mood are a character you can argue with, not a settings dialog.
2. **The split is deliberate.** Deterministic rules own enforcement; the model owns language, context and drafting. It keeps working offline, and it cannot be talked into changing its own rules.
3. **Everything is a pack.** A commitment is a pack, a sensor is a pack, a personality is a pack. Users extend it by describing what they want — not by forking the repo.

### Product principles

1. The user writes the commitments. The pet enforces only what the user agreed to.
2. Deterministic enforcement, probabilistic conversation.
3. Every escalation is time-boxed and escapable.
4. Honest about what it knows and what it did.
5. Local-first, with consent per pack and per capability.
6. Extensible by default: if a capability cannot be expressed as a pack, question the design.
7. Presence, not surveillance. A character in the corner, not a system-wide monitor.

## 2. Must ship

1. Menu bar app; no permanent dashboard; no Dock icon in normal operation.
2. Pet is its own borderless, transparent, draggable, always-on-top window.
3. **Kernel + pack runtime**, with the reference packs loaded through it as declarative data.
4. Onboarding where the user writes or accepts commitments and reviews capability grants in plain language.
5. Chrome extension (MV3) as the browser **sensor transport**.
6. Local rule engine detects threshold crossings; the agent handles context, language and negotiation.
7. Soft in-browser intervention: bubble, optional grayscale, overlay with an always-available exit. “Gate” means an escapable nudge within the restrictions below; it does not authorize blocking checkout or page controls. Exact placement and interaction design must be settled before building the surface.
8. Local persistence of packs, grants, commitments, sessions, exceptions, wishlist and reminders.
9. Agent with real tools; the UI reflects tool results and never fakes a successful action.
10. **Agent-drafted rule pack**: describe a commitment in natural language → review → approve → enforced live.
11. Pack manager: list packs, inspect capabilities, enable/disable, delete data.
12. Activity log: which pack caused what, with the honest outcome.
13. Basic offline operation via the rule engine and fallback lines.

## 3. Explicitly out of scope for this build

- Executable third-party packs (WASM/subprocess), pack registry, marketplace, signing infrastructure. Designed for in `docs/vision.md`, not built now.
- OS-level sensors beyond what a declarative pack can express: window titles, screenshots, OCR, keystroke content.
- Forced or auto-enabled microphone; voice as a requirement; "explain yourself" interrogation.
- Blocking clicks, disabling buttons, auto-closing tabs, locking the machine, changing OS brightness or volume, full-screen input-grabbing overlays.
- Hard locks with no exit, or gates longer than their lease.
- Banking, real payments, or auto-confirming an order.
- Browsers other than Chrome; Windows/Linux; mobile.
- Resisting a user who disables a pack or quits the app. The extension is not a security boundary against its own owner.
- Multi-agent orchestration, cloud sync, vector databases.

## 4. Conflict with the vision document

`HostilePet.md` describes monster transformations, forced microphones, click-blocking, screen dimming, tab closing and 24-hour payment locks. These are **vision material only**. Building any of them requires a recorded decision in `docs/adr/` plus explicit user approval — never an agent's judgment call.
