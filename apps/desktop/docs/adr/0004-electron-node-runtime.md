# ADR 0004 — Electron and a TypeScript core

**Status:** accepted for this build
**Supersedes:** Tauri/Rust runtime choice and the prohibition on a Node runtime in `docs/stack.md`; runtime-specific assumptions in ADRs 0001–0003
**Related:** `docs/architecture.md`, `docs/engineering.md`, `docs/agent.md`

> Library update: ADR 0006 selects LangGraph JS on LangChain core. The prohibition recorded below stands unchanged — no framework may bypass grants, human approval or deterministic rules.

## Context

The project is pre-implementation. The immediate goal is a working macOS pet demo with an agent and real tools. Using TypeScript across the desktop core, UI and extension reduces language and packaging boundaries and permits JavaScript agent libraries without a separate Node installation.

## Decision

- Use Electron for the desktop shell. React and Pixi/Live2D run in sandboxed renderer processes.
- Implement the domain-agnostic kernel, pack runtime, bridge, persistence and agent orchestration in TypeScript on Electron's bundled Node.js runtime.
- For the first slice, the core runs in the main process behind narrow preload IPC APIs. The kernel remains the single writer of policy state; asynchronous handlers must serialize policy mutations and snapshot writes.
- Keep model I/O asynchronous and bounded. Do not perform blocking or CPU-heavy work on the main event loop. An Electron-managed `utilityProcess` is an available isolation path if measurements or failures justify it; it is not required for the first slice and does not become a second policy owner.
- The agent framework remains open: a small direct SDK loop, LangChain JS or LangGraph JS. This decision enables those libraries but does not select one. No framework may bypass grants, human approval or deterministic rules.
- Keep the loopback WebSocket transport (ADR 0001), Live2D renderer (ADR 0002) and kernel-owned JSON snapshot (ADR 0003). No wire, manifest or state version changes are implied.

## Boundaries

Renderer windows use `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. Preload exposes named application operations, not raw IPC, filesystem, shell or arbitrary channel access. Main validates payloads and sender identity, controls navigation/window creation, and loads packaged UI assets. API keys remain in macOS Keychain, accessed by the privileged core; the specific Keychain integration must be verified before adoption.

Electron is a multiprocess application. The deployment unit is one desktop app plus one Chrome extension, not literally one OS process. No separately installed Node runtime, Python runtime or standalone daemon is required.

## Consequences

- One application language and direct access to the JS agent ecosystem simplify the demo implementation.
- Bundled Chromium and Node increase baseline memory and distribution size. Measure idle behavior on the demo machine.
- Shared TypeScript types do not validate runtime input; Zod checks and cross-boundary fixtures remain required.
- The macOS window and Live2D spikes must be run in Electron. Prior results from a different shell are not evidence of compatibility.
- Rust can be reconsidered for a measured bottleneck or native integration later; it is not part of this build's toolchain.
