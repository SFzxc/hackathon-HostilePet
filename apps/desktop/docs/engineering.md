# Engineering — layout, conventions, tests, delivery

> Owns: repository structure, coding standards, quality gates, delivery sequence, definition of done.

## Current implementation

The desktop-only scaffold contains Electron main/preload/React renderer, a tray, draggable transparent placeholder pet, show/hide controls, a settings window and explicit Quit. Shell IPC is validated; windows deny permissions and unrequested navigation. Original CSS geometry is labelled as placeholder art in Settings. Tray and Settings provide idle, thinking and text-above visual previews; the floating pet has no label card underneath it.

The **bridge transport** exists and is the first real protocol code: `packages/contracts` holds the envelope, signal, handshake, lease and outbound schemas plus cross-boundary fixtures, and `apps/desktop/src/main/bridge/` holds the loopback WebSocket server, the lease registry, a **kernel handler** and a **mock handler**. `apps/desktop/src/main/bridge-standalone.ts` runs the same code as a fake kernel for extension-only iteration. The shell starts the bridge in development, reports its phase and peer in Settings and the tray, and releases every lease with `quit` on exit; the bridge does not start in a packaged build (`docs/protocol.md` §1.2).

The **event → agent → pet chain** exists as the first vertical slice of behaviour. `src/main/events/` classifies a host against `packs/site-catalog.json`, accrues qualifying time per page (`site-tracker`), and writes redacted observations to a capped ring buffer (`event-log`, ADR 0008). `packages/agent` turns a context package into one line and one action — provider adapter, deterministic validator, one retry, fallback (ADR 0006). `src/main/agent/turn-runner.ts` owns the 30–60 s cadence and the escalation level; `src/main/pet/presenter.ts` is the only place a line becomes visible, and it always carries its provenance. `apps/desktop/scripts/simulate-site.cjs` drives the whole chain without a browser extension.

What does not exist: a rule engine, a pack runtime, capability grants, a persisted `state.json`, Keychain integration, any model provider call, and the Live2D character. The mock handler and the fake provider are stubs: they prove the protocol and the loop, never the policy or the language. Position survives window hide/show but is not yet persisted across app restarts. The remaining layout below is a target; `apps/desktop/src/main/{bridge,events,agent,pet,focus}`, `apps/desktop/packs` and `packages/{contracts,agent}` are what exists.

Run commands and verification status are in `README.md`. macOS Spaces/fullscreen, click behavior, focus and display unplug require real-window checks before the window spike is considered complete.

## 1. Repository layout

```text
apps/
  desktop/
    src/main/               # Electron lifecycle, tray/windows, core wiring, IPC handlers
    src/main/bridge/        # Loopback WebSocket server, lease registry, kernel + mock handlers
    src/main/events/        # Site catalog, per-page accrual, capped event log
    src/main/agent/         # Turn cadence, escalation level, context assembly
    src/main/pet/           # Presenter (line, face, badge) and expression precedence
    src/main/focus/         # macOS Focus sensor (ADR 0007)
    src/main/bridge-standalone.ts  # Fake-kernel CLI (dev only — docs/browser-pack.md §5)
    src/preload/            # Narrow contextBridge API; no raw IPC exposure
    src/renderer/           # React: pet UI, onboarding, chat, pack manager, activity log
    src/shared/             # Schemas shared across the IPC boundary
    scripts/                # focus-state.cjs (workspace) · apps/desktop/scripts/: smoke, bridge-handshake, simulate-site
  extension/                # Browser sensor transport (MV3)
    entrypoints/
    src/adapters/           # YouTube Shorts, demo shop, verified real shop
  demo-shop/                # Sandbox cart/checkout, no real payments
packages/
  kernel/                   # Event bus, rule engine, policy, leases, scheduler
  pack-runtime/             # Manifest load, capability grants, lifecycle, pack_kv
  agent/                    # Provider adapter, context builder, tool runtime, validator
  store/                    # One JSON snapshot, atomic write (SQLite deferred — ADR 0003)
  bridge/                   # Loopback WebSocket server + protocol
  contracts/                # Protocol + event schemas + cross-boundary fixtures (exists)
  pack-sdk/                 # Manifest schema, capability catalog, pack lint & test harness
  tone/                     # Tone schema, validator, fallback lines, eval scenarios
  pet-renderer/             # Live2D renderer + labelled Canvas placeholder
  pet-assets/               # Runtime art + animation manifest
  test-fixtures/            # Sanitized DOM and event fixtures
packs/
  focus-shorts/             # Reference pack (declarative)
  impulse-shopping/         # Reference pack (declarative)
  starter-commitments/      # Onboarding templates
prompts/
  persona.md                # Runtime prompt artifact (versioned)
assets/
  pet-source/ branding/ licenses/
docs/
  product.md architecture.md packs.md agent.md tone.md browser-pack.md
  protocol.md engineering.md hackathon.md vision.md pet-visual-brief.md adr/
AGENTS.md
HostilePet.md
```

- The package split keeps the kernel honest about packs. If it slows the first vertical slice, collapse `kernel` + `pack-runtime` temporarily — but never let a reference pack's specifics leak into kernel code.
- Shared contracts MUST have cross-boundary fixtures so main, renderer and extension validate the same payloads.
- **Bridge placement.** The bridge lives in `apps/desktop/src/main/bridge/` for now: it is the desktop app's transport, its only handler is a development stub, and `packages/bridge` would imply a kernel-grade boundary that does not exist yet. Promote it to `packages/bridge` when a second transport or a real pack runtime lands — the code already takes no Electron import, so the move is mechanical.

## 2. Conventions

- **TypeScript:** `strict` on, no `any` in committed code, Zod at every boundary, no floating promises.
- **Runtime boundaries:** privileged packages are Node-only and never imported into renderer or extension bundles. Main validates IPC sender and payload; preload exposes named operations. Serialize policy mutations and snapshot writes; no blocking I/O on the main event loop.
- **Naming:** events `signal.<packId>.<name>` or `domain.subject.verb`; pack ids reverse-DNS-ish (`hp.focus-shorts`); persisted collections snake_case plural; TS types PascalCase; files kebab-case.
- **Errors:** typed error codes; the user-facing message is separate from developer detail. Never swallow an error silently.
- **Logging:** structured, minimal, redacted by default. No secrets, no raw page content, no URLs with query strings. Every intervention logs `packId`, `ruleId`, and `promptVersion`.
- **Secrets:** Keychain, with only the extension-side bridge-token exception documented in ADR 0001. No real credentials in env files; examples contain placeholders only.
- **Dependencies:** choices, rationale and version posture live in `docs/stack.md`. Pin exact versions, commit the lockfile, and verify compatibility against Electron’s bundled Node/Chromium / WXT / MV3 before adding anything.
- **Commits:** small and scoped. A protocol, manifest or schema change states the version bump and includes fixture updates.
- **ADRs:** any expensive-to-reverse decision (bridge transport, storage engine, provider shape, intervention model, pack format, tone architecture) gets one under `docs/adr/` before implementation.
- **Docs ownership:** each document starts with an `Owns:` line. Change behaviour → change the owning document in the same commit.

## 3. Testing — hackathon scope

Keep a small test suite for policy correctness and component boundaries. A demo rehearsal verifies the real integration; automated fixtures verify repeatable failure cases.

**Required headless checks.** Case counts below are estimates, not completion criteria.

| Suite | Scope | Tooling |
| --- | --- | --- |
| Rule engine | Counter accrual, threshold crossing, hysteresis, cooldown, day rollover, pause | Vitest, ~15 cases |
| Price parsing | VND formatting, thousand separators, currency mismatch, missing price, item vs cart total | Vitest, ~10 fixture cases |
| Tone validator | Each check rejects its known-bad input: length, banned pattern, ungrounded number, capability claim, repetition | Vitest, ~10 cases |
| Bridge protocol | Handshake accept/refuse, version mismatch, signal before `hello`, undeclared sensor, unknown schema, malformed frames, duplicate `messageId`, replayed `seq`, failure budget, rate limit, size limit, heartbeat timeout, TTL release, resync, port collision, one-peer rule | Vitest over a real loopback socket, 26 cases (`apps/desktop/src/main/bridge/bridge.test.ts`) |
| Protocol contracts | Envelope/payload schema accept and reject per message, both directions, plus the shared fixtures the extension codes against | Vitest, 30 cases (`packages/contracts/src/messages.test.ts`) |

Also keep minimal main/renderer/extension contract fixtures, handshake rejection, lease expiry/release/replay, draft approval, and tool idempotency checks. Each verifies an invariant that a successful demo alone cannot establish. The bridge protocol and contract suites above are the first of these; `pnpm --filter @hostile-pet/desktop bridge:mock` plus `node scripts/bridge-handshake.cjs` is the end-to-end equivalent for an implementer who has no desktop app running.

**Deferred:** broad Playwright E2E coverage, exhaustive pack/adapter matrices, the full tone evaluation harness, and automated performance benchmarks. Manual observation still checks the performance budget below.

**Rehearse the demo script twice on the demo machine** (`docs/hackathon.md`), including disconnect and offline paths. Rehearsal complements the required checks.

Quality gates for any change:

- Required headless checks pass; no new lint warnings; no secret in the diff.
- The offline path still works.
- Every new browser action has a TTL and an escape.
- Every new side effect logs its pack and rule.
- No reference-pack specifics in kernel code.
- A prompt or validator change passes the smoke eval (`docs/tone.md` §8).

Performance budget: idle CPU near zero, bounded animation FPS, reduced activity when the display sleeps, no busy loops, browser bridge idle traffic limited to the heartbeat.

## 4. Delivery plan

1. **Kernel + pack runtime skeleton.** Manifest loading, capability grants, event bus, rule engine on fixtures — no UI. Plus the macOS window spike: tray-only, no Dock icon, transparent pet, drag, focus, Spaces, fullscreen, Retina. Do not continue until window behaviour is confirmed on real macOS. Use Electron window APIs first; any additional native integration needs a compatibility and distribution review. Verify sandboxed preload, Keychain access and Live2D in the packaged Electron app.
2. **Vertical slice.** Pairing and handshake first (`docs/protocol.md` §1.2–1.3), then sensor event → authenticated bridge → rule → pet mood change; disconnect, reconnect and service-worker restart resync all work. The handshake, lease lifecycle, resync and failure handling are implemented and tested; the token/Keychain half of pairing is not, and the handler behind the bridge is still a mock.
3. **Reference pack A (`hp.focus-shorts`).** Real timing, commitment, warning, gate, +5 minutes, persistence — built as a declarative pack.
4. **Reference pack B (`hp.impulse-shopping`).** Demo shop extraction, threshold, pause overlay, wishlist, morning reminder. Real-site adapter only if time remains.
5. **Agent.** Tool loop, structured output, validator, offline fallback, then the agent-drafted pack flow.
6. **Pack manager + consent UI.** Capability review, enable/disable, delete data, activity log by pack.
7. **Polish.** Character: concept pick, Live2D rig inside its timebox (`docs/character-concepts.md`), fallback path if the rig slips. Then desktop↔browser handoff, persona lock, onboarding copy.
8. **Hardening + demo.** Privacy review, failure drills, packaging, rehearsal of the script in `docs/hackathon.md`.

## 5. Desktop behaviour requirements

- Menu bar menu: status (Watching / Paused / Browser disconnected / Offline AI), show-hide pet, pause tracking, commitments & packs, wishlist & reminders, activity log, Quit. Until packs exist, the status line names the bridge state instead and says the handler is a mock (`docs/protocol.md` §5): "not listening", "listening, no extension" and "extension attached" are three different strings, and none of them claims observation.
- Closing Settings does not quit the app. Quit stops tracking and releases every lease.
- Startup at login is opt-in.
- The pet window is small, sized to the pet, never a full-screen click-blocking overlay.
- Drag to move, remember position, snap back into view when a display is unplugged.
- Animation or a dialogue line MUST NOT steal keyboard focus. Chat input takes focus only after an explicit user action.
- Quiet when idle: no constant hopping, no sound by default. Bounded FPS; reduced activity when the display sleeps. Reduce Motion is honored with a static pose or a light fade.

## 6. Definition of done

- [ ] Launching the app shows a tray icon and the pet, with no dashboard or Dock icon unless intended.
- [ ] The pet captures no clicks outside its own window and never steals keyboard focus when warning.
- [ ] The chosen character loads as a Live2D model with idle, blinking and at least one reaction motion; if the rig was not finished, the sample model is used and labelled in the UI.
- [ ] Chrome pairs successfully; the UI distinguishes browser-disconnected from model-offline.
- [ ] Both reference packs load through the pack runtime as declarative data; disabling the browser sensor marks dependent rules `unavailable` instead of silently passing.
- [ ] Shorts counts only qualifying observed time, never double-counts, and a reload does not reset the budget.
- [ ] Shopping extraction handles uncertain currency/price; the demo shop produces no real payment.
- [ ] The agent calls at least one tool with a real effect: wishlist or reminder.
- [ ] A commitment described in natural language is drafted by the agent, reviewed with a capability diff, approved by the user, and enforced live in the same session.
- [ ] Capability consent shows every permission with a plain-language reason; disabling a pack drops its grants and releases its leases.
- [ ] Override, Pause and Quit work; every gate has a TTL and is released when control is lost.
- [ ] Reconnect, model timeout, sleep/wake, navigation, pack disable and restart leave no indefinite gate behind.
- [ ] Raw browser content and secrets are never sent or logged outside the described scope.
- [ ] Required headless checks pass; no new lint warnings; no secret in the diff.
- [ ] Every generated line passed the validator or was replaced by a fallback logged as such.
- [ ] The demo distinguishes real data, demo timers and sandboxed checkout, and claims no mobile or whole-web support.
- [ ] Offline mode still warns, still gates softly, and still lets the user through.
- [ ] No site name, selector or use-case string exists in kernel code — verifiable by grep.
