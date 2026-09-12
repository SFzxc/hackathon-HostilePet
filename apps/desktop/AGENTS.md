# HostilePet — Agent Entry Point

> **Status:** desktop scaffold, the extension bridge, the macOS Focus sensor, and the event → agent → pet loop implemented. Tray, placeholder pet, settings, shell IPC, the loopback WebSocket transport (`packages/contracts` + `apps/desktop/src/main/bridge/`), the in-process Focus sensor (`src/main/focus/`), the kernel handler with site accrual and a capped event log (`src/main/events/`), the turn runner and presenter (`src/main/agent/`, `src/main/pet/`), a fake provider (`packages/agent`) and a fake-kernel CLI exist; the provider is **curated lines, not a model**, the default handler is real but the mock remains behind `HOSTILEPET_HANDLER=mock`, and rule packs, a pack runtime, a persisted `state.json`, the extension itself and Live2D are not implemented.
> **This file is a router, not the spec.** It says what the project is, what must never break, and which document to read for the task in front of you. Load only what you need.
> **Normative keywords:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.
> **Mode: hackathon, happy case only.** Optimise for the one path the demo walks, end to end. Do not write or expand tests, and do not write spec documents for work in progress; a red test that describes a state the demo never reaches is left red. Fix only what blocks the happy path. This narrows *scope*, never *evidence*: the happy path must still be produced by the real sensor, and a state that could not be read still says so.

## What this is

HostilePet is a local-first agentic desktop companion for macOS. A pet lives on the desktop; behind it a TypeScript kernel running on Electron’s Node.js runtime turns opt-in signals into deterministic policy and calls an LLM only where judgment or language is needed. Behaviour is defined by **packs** — declarative bundles of sensors, rules, actions, personas and characters. The browser is one reference pack, not the product boundary.

**Pitch:** Most agents help you do what you ask. HostilePet helps you not do what you'll regret.

## Document map

| Read | When you are… |
| --- | --- |
| `docs/product.md` | needing scope: what ships, what is forbidden, product principles |
| `docs/architecture.md` | writing kernel code: event bus, rule engine, policy, leases, state ownership |
| `docs/stack.md` | picking, questioning or versioning a technology or dependency |
| `docs/packs.md` | touching pack format, capabilities, lifecycle, or agent-drafted packs |
| `docs/agent.md` | touching the LLM loop, tools, context assembly, or output schema |
| `docs/tone.md` | touching how the pet speaks, or validating generated lines |
| `prompts/persona.md` | editing the pet's actual voice — a runtime artifact, versioned |
| `docs/browser-pack.md` | working on the browser sensor pack or a site adapter |
| `docs/protocol.md` | touching the bridge, persistence, or failure handling |
| `docs/engineering.md` | needing repo layout, conventions, tests, delivery plan, definition of done |
| `docs/character-concepts.md` | picking the character — 3 screen-face concepts, rig cost, state mapping |
| `docs/character-prompts.md` | generating the art — self-contained copy-paste image prompts with palette inlined |
| `docs/hackathon.md` | needing judging criteria, the demo script, or what to cut when time is short |
| `docs/vision.md` | about to close a door that the long-term platform needs open |
| `docs/pet-visual-brief.md` | dealing with character art, animation, or character packs |
| `docs/adr/` | making an expensive-to-reverse decision — write one first |
| `HostilePet.md` | **never**, unless the user asks. Vision archive: non-normative, contains out-of-scope mechanics |

## Document authority

- This file defines the project-wide floor; owning documents define current product and implementation requirements.
- Accepted ADRs record technical decisions. When an ADR changes a decision, update the owning documents in the same change. An unresolved conflict must be surfaced, not silently resolved by choosing a document.
- `docs/hackathon.md` owns demo presentation and cut proposals, not permission to remove required product flows.
- `docs/vision.md` is future direction only. It does not add requirements to this build.
- Open decisions and implementation blockers are not defaults. Resolve them before implementing the affected boundary; independent work may continue.

## Non-negotiables

The floor that applies to every file, every commit, every prompt. If a task seems to require breaking one of these, stop and ask.

1. **The kernel stays domain-agnostic.** No site name, page selector, threshold, or line of dialogue in kernel code. Those belong to packs.
2. **Declarative packs are data.** In this build no pack may execute code, open a socket, or read a file.
3. **Deterministic rules own enforcement; the model owns language.** The model can never enable, widen, weaken or disable a rule.
4. **Every intervention is a lease** with a finite TTL and an always-visible, plain-language escape. A gate without an exit is a bug.
5. **Only the user's own commitments are enforced.** No commitment, no intervention.
6. **Never fabricate.** No invented balances, totals, counts, or completed actions — in code or in generated lines.
7. **No cruelty.** No person-targeted mockery, no moralizing, no medical or neurological claims.
8. **Secrets live in Keychain** — never in the state file, logs, the renderer, the extension bundle, or the repo. The bridge token has one accepted exception: its extension-side copy lives in trusted-context-only Chrome local storage (ADR 0001). This exception never applies to the model API key.
9. **Raw page content never leaves the machine.** Only sanitized, minimal signals reach the model.
10. **A mock, fixture or animation never counts as evidence** that a real sensor, tool or pack works.

## Open decisions

Blocking or shaping work. Do not silently choose a default.

| # | Decision | Status |
| --- | --- | --- |
| 1 | Model provider and model ID (after smoke test) | provider **decided** — OpenAI; model ID open → `docs/adr/0006-agent-library.md` |
| 2 | Real shopping site for the second adapter | open |
| 3 | Character pick — 3 screen-face proposals in `docs/character-concepts.md` | open |
| 4 | Whether grayscale ships in the build or behind a flag | open |
| 5 | First non-browser sensor | **decided** — macOS Focus, read from the DoNotDisturb database → `docs/adr/0007-macos-focus-sensor.md` |
| 6 | Pack distribution format for the next horizon | deferred → `docs/vision.md` |
| 7 | Hackathon theme wording — how "reverse screen agent" is scored | open |
| 8 | Character renderer format | **decided** — Live2D via pixi.js → `docs/adr/0002-character-renderer.md` |
| 9 | Desktop shell and core runtime | **decided** — Electron + TypeScript/Node.js → `docs/adr/0004-electron-node-runtime.md` |
| 10 | Agent library | **decided** — LangGraph JS on LangChain core in `packages/agent` → `docs/adr/0006-agent-library.md` |

## Working rules for coding agents

1. Read this file, then only the documents the task needs. Do not expand scope into mobile or OS-level surveillance.
2. **Never special-case a use case in the kernel.** If it needs a site name, a threshold or a line of dialogue, it is a pack.
3. Prefer a working vertical slice over a generic platform. One pack working end to end beats a plugin marketplace.
4. Ask before: growing scope, adding a cloud service, widening host permissions, adding a stronger intervention, or changing a schema, manifest or protocol version.
5. Every side effect logs minimally and structurally: no secrets or surplus page data. Pack effects carry real `packId` + `ruleId`; desktop shell actions carry null identifiers and `source: user-shell` (ADR 0005).
6. Never substitute production art with an unlicensed character; record missing assets explicitly.
7. The agent may draft; only the human may enable.
8. When behaviour changes, update the document that owns it in the same change. These docs are the spec, not a historical record.
9. Do not modify `HostilePet.md` unless the user asks.
10. When an ADR-worthy choice comes up, write the ADR instead of deciding quietly.

## Status

Desktop scaffold, the bridge transport, the first real sensor, and the first behaviour loop: events land, the log grows, and the pet reacts on its own slow clock with one line and one action. The Focus sensor needs Full Disk Access before it can read anything and reports `known: false` until then; the agent's provider is curated lines until a model is wired, and the UI says so; sequence and gates: `docs/engineering.md`. What must exist before the demo: `docs/hackathon.md`.
