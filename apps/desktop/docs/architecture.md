# Architecture — kernel, events, policy, leases

> Owns: the kernel's internals and its boundaries. Pack format lives in `docs/packs.md`; transport and storage in `docs/protocol.md`; technology choices in `docs/stack.md`.

## 1. Shape of the system

```text
Chrome extension (MV3)
  adapters → sanitized signals → service worker
  leased browser surfaces ← authenticated loopback WebSocket
                                      ↕
Electron main process — bundled Node.js, TypeScript
  bridge → validation → kernel event bus
  kernel: deterministic rules, counters, scheduler, policy, leases
  pack runtime: manifests, grants, lifecycle
  agent: context → provider → tool proposals → validation → results
  store: single writer, atomic JSON snapshot; secrets: login Keychain, plus the model key in the git-ignored .env (ADR 0010)
                                      ↕ narrow, validated preload IPC
Electron sandboxed renderers
  React: pet chat, onboarding, settings, packs, activity log
  Pixi/Live2D: character rendering
```

The first slice runs the privileged core in main. Model I/O is asynchronous and bounded; policy mutations and snapshot writes are serialized even across asynchronous handlers. UI state never becomes authoritative. An Electron-managed utility process may isolate agent work if needed, but cannot own policy or bypass the kernel's tool checks (ADR 0004).


Two sensor transports exist in this build. The browser extension is the remote one: it sanitizes and forwards, and the kernel decides. The macOS Focus sensor (ADR 0007) is the native one, and it is the exception that proves the rule — it runs inside main and reads a file, which a declarative pack may not do (non-negotiable 2). Keep both boundaries transport-shaped, and still do not build a transport registry before a third transport exists.

## 2. Kernel responsibilities

The kernel is domain-agnostic. It MUST NOT contain any site name, page selector, threshold value, or user-facing line of dialogue.

- Event bus: typed, versioned, schema-validated events
- Scheduler and clock: day rollover, timezone, monotonic durations, sleep/wake
- Rule engine: counters, windows, thresholds, debounce, hysteresis, cooldown
- Policy state and the intervention lease model
- Agent runtime: context assembly, tool dispatch, provider adapter (`docs/agent.md`)
- Pack runtime: manifest load, capability grants, lifecycle, pack data isolation (`docs/packs.md`)
- Persistence, redaction, structured logging, activity log

### 2.1 Extension points

| Point | What a pack contributes | Example |
| --- | --- | --- |
| **Sensor** | A stream of typed signals from some source | browser sensor, manual check-in, device-input activity, screen time |
| **Rule** | A declarative commitment: trigger + conditions + threshold + intervention | "max 15 min Shorts/day" |
| **Action / tool** | A real side effect the agent or a rule may invoke | save to wishlist, schedule recheck, desktop notification |
| **Presentation** | Persona (tone + line packs), character (art/model), in-page intervention UI | gruff Vietnamese voice, a small screen-faced device, a checkout overlay |

## 3. Trust boundaries

| Zone | Trust | Rules |
| --- | --- | --- |
| Page DOM, URLs, page text | Untrusted | Never treated as instructions. Sanitized inside the adapter before it becomes a Signal. |
| Content script | Semi-trusted | Talks to the page; sends only typed, sanitized payloads through extension messaging. |
| Extension service worker | Trusted-ish | Holds the pairing token; owns no durable policy state; validates both directions. |
| Kernel | Trusted | Single writer for policy state. The only component that talks to the model or reads secrets. |
| Pack (declarative) | Untrusted input | Validated on load. Data only — cannot execute code, open sockets, or read files. |
| Model output | Untrusted | Schema-validated, then validated again for grounding (`docs/tone.md`). Free-form text is displayed, never executed. |
| Renderer (React/Pixi) | Untrusted-ish | Sandboxed, context-isolated, Node integration off. Only named preload operations; main validates sender and payload. No secrets or direct model calls. |

## 4. State ownership

| State | Owner | Notes |
| --- | --- | --- |
| Packs, capability grants, enablement | Kernel store | User edits only, through explicit UI flows. |
| Commitments, thresholds, quiet hours | Kernel store | Derived from enabled rule packs; user-editable. |
| Counters, session windows, cooldowns | Kernel (memory + persisted) | Survives restart. Wall clock for day rollover, monotonic for durations. |
| Policy state and active leases | Kernel | Rendered by the UI and the extension; never decided by them. |
| Observed signals | Sensor pack / extension | Aggregated, sanitized, TTL-bounded, discarded after transmission. |
| Wishlist, reminders | Kernel store | Idempotent by key. |
| Pack-private settings | Kernel (`pack_kv`, namespaced by pack id) | A pack cannot read another pack's keys. |
| API key | `HOSTILEPET_OPENAI_API_KEY` in the git-ignored `.env`, else login Keychain (ADR 0010) | Read by the main process only; never logged, never in a store, never sent to the extension or a window. |

## 5. Event taxonomy

Namespaced and versioned. Core types are unprefixed; sensor types carry the pack id.

| Type | Direction | Payload summary |
| --- | --- | --- |
| `signal.<packId>.<name>` | sensor → kernel | e.g. `signal.hp.focus-shorts.session.tick` `{site, pageType, activeMs, windowFocused, visible, idle, documentId}` |
| `policy.decision` | kernel-internal | `{state, reason, packId, ruleId, leaseId?, ttlMs?}` |
| `intervention.request` | kernel → surface | `{kind: bubble\|overlay\|grayscale, leaseId, ttlMs, copy, escapeLabel}` |
| `intervention.release` | kernel → surface | `{leaseId, reason}` |
| `pack.installed` / `pack.enabled` / `pack.disabled` / `pack.error` | kernel-internal | `{packId, version, reason?}` |
| `agent.request` / `agent.result` | kernel-internal | Context package in, schema-validated output out |
| `health.ping` / `health.pong` | both | Heartbeat and version handshake |

Rules:

- Every command carries `documentId` identity so a navigation cannot receive a stale gate.
- Every action is idempotent; a retry MUST NOT duplicate a wishlist item or reminder.
- Every lease has a finite TTL.
- Unknown message types and undeclared signals are rejected and logged, never executed.

## 6. Rule engine

- Inputs: signals from enabled sensor packs, rules from enabled rule packs, quiet hours, demo-mode scaling.
- Tracks, per rule and per pack: qualifying observed time (active tab + focused window + visible document + not idle), daily counters, streaks, cooldowns, last-intervention timestamps.
- MUST NOT count sleeping, disconnected or unfocused time as observed time.
- MUST NOT double-count across tabs or windows: the same wall-clock interval is credited once.
- Day boundary and timezone are explicit settings. Reloads, new tabs and navigation MUST NOT reset a daily budget.
- Debounce: a crossing fires once per crossing, with hysteresis before it can fire again.
- Deterministic and fully functional offline. Unit-testable from fixtures with no model involved.

## 7. Intervention model (leases)

Every intervention is a **lease**, not a lock.

- Fields: `leaseId`, `kind`, `ttlMs`, `scope {tabId, documentId}`, `packId`, `ruleId`, `escapeLabel`, `reason`.
- MUST always render an exit affordance in plain language, legible without the model.
- Released on: user override, TTL expiry, extension or kernel disconnect, Pause, Quit, pack disable, navigation (`documentId` change), day rollover.
- TTL is capped (default ≤ 5 minutes per lease; extensions happen in configured increments).
- No lease may block purchase completion, simulate a disabled checkout button, or intercept input outside the pet's own hit region.

## 8. Design invariants

Checkable claims. If code contradicts one, the code is wrong.

1. `rg -ni "youtube|shopee|shorts" packages/*/src apps/desktop/src/main/bridge` returns nothing. The glob covers `packages/contracts` as well as the not-yet-created kernel and store, and the bridge is listed explicitly because it lives under `apps/desktop` for now (`docs/engineering.md` §1): a fixture or a doc-comment that names a site is how a site name gets copied into the kernel.
2. Killing the extension mid-lease releases the lease within the TTL.
3. Restarting the kernel restores counters, cooldowns and grants, and releases every lease that was active.
4. No rule fires without an enabled pack that declares the signal it consumes.
5. A model timeout changes wording only — never policy state.
6. Deleting a pack's data leaves no orphan rows in `pack_kv`.
7. Exactly two sensor transports exist in this build — the browser extension and the in-process Focus sensor — and nothing in the kernel enumerates transports.
8. An unreadable sensor source produces `known: false`, never a default value. No signal carries an inferred state.
