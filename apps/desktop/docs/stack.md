# Stack — technologies, versions, constraints

> Owns: technology choices and version posture. Runtime decision: `docs/adr/0004-electron-node-runtime.md`. Layout: `docs/engineering.md`; process boundaries: `docs/architecture.md`.

## 1. Choices

| Layer | Choice | Purpose |
| --- | --- | --- |
| Desktop shell | **Electron** | Tray, pet and settings windows, application lifecycle and macOS integration |
| Desktop UI | **React + TypeScript strict + Vite** | Onboarding, chat, packs and activity log in sandboxed renderers |
| UI state | **Zustand** | Transient renderer state only; never authoritative policy |
| Pet rendering | **Live2D Cubism via Pixi.js**, with a labelled Canvas placeholder | Character model and animation; ADR 0002 |
| Core | **TypeScript on Electron's bundled Node.js** | Kernel, rules, leases, pack runtime, scheduler and local tools |
| Agent runtime | **LangGraph JS on LangChain core, behind a provider adapter** | Bounded tool loop, context, model requests, tool proposals and validated results; version pins and boundaries in ADR 0006 |
| Desktop IPC | **Electron preload + contextBridge + validated IPC handlers** | Narrow application operations between renderer and main |
| Browser bridge | **Loopback WebSocket (`ws` 8.21.3) on Node.js** | The extension protocol in `docs/protocol.md` §1.7; membership is checked at the server, not granted by it |
| Browser sensor | **Chrome MV3 + WXT + TypeScript** | Supported site adapters and leased browser surfaces |
| Storage | **Kernel-owned atomic JSON snapshot** | Existing persistence decision; SQLite deferred, ADR 0003 |
| Contracts | **Shared Zod schemas + TypeScript types** | Runtime validation and cross-boundary fixtures in `packages/contracts` |
| Secrets | **macOS Keychain** | Main/core-only access; trusted extension storage exception for pairing token only |
| Tests | **Vitest** | Policy, price parsing, tone and boundary checks |
| Workspace | **pnpm workspaces** | Shared packages, pinned build-time Node and dependencies |

Node orchestrates model requests and tools; it does not imply local model inference. LangGraph JS on LangChain core runs in the privileged Node core without a separately packaged Node sidecar; ADR 0006 selects them and records the boundaries.

## 2. Version and packaging posture

- Pin exact dependency versions and commit the lockfile. Record verified versions during scaffolding, not guesses in advance.
- Pin build-time Node in `.nvmrc` and pnpm in `packageManager`. Production uses the Node/Chromium versions bundled with the pinned Electron release; verify library compatibility against those versions.
- Choose and verify the Electron build/packaging tool during scaffolding. Deliver a launchable macOS app plus the unpacked extension; users must not need a system Node installation.
- Verify on the demo Mac before continuing beyond the first slice:
  - Transparent, draggable, always-on-top pet; tray-only operation; no unsolicited focus; Spaces/fullscreen; Retina and display unplug behavior.
  - Sandboxed preload, IPC sender/payload validation and renderer isolation.
  - Offline Live2D model load and screen compositing with the selected Pixi/wrapper versions.
  - Keychain integration in the packaged app. Do not substitute a plaintext or app-state secret store.
  - Snapshot behavior on APFS and failed writes; extension reconnect and worker restart.
  - Idle CPU/memory, animation cost and main-process responsiveness during model calls.
- Review Cubism Core and sample-art redistribution terms before public distribution.

## 3. Runtime constraints

- Local policy works without the model or network. Only the core owns commitments, counters and leases.
- Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. No raw IPC, Node, filesystem, shell, secrets or direct provider access.
- Main: validate IPC payloads and senders; expose only named operations. Load packaged UI, restrict navigation and new windows, and validate any external URL before opening it.
- Use asynchronous I/O and serialize authoritative mutations. Keep blocking work off the main event loop; use an Electron-managed utility process only when needed, with the kernel retaining policy ownership.
- Electron's normal subprocesses are expected. No separately installed runtime or standalone daemon is part of this build.
- No telemetry, analytics or crash-reporting SDK. Logs stay local and redacted. This excludes the LangChain tracing client and the remote graph client; ADR 0006 keeps the umbrella `langchain` package out for that reason.

## 4. Not chosen yet

- Model provider/model ID, after a structured-output and tool-call smoke test. The provider is OpenAI and the build pins `gpt-5.6-luna` behind `HOSTILEPET_PROVIDER=openai` (ADR 0006); the smoke test has not been run, so the pin is provisional and overridable with `HOSTILEPET_MODEL`.
- Keychain binding and Live2D wrapper, after compatibility checks.
- Character pick and whether grayscale ships; tracked in `AGENTS.md`.

Expensive-to-reverse changes require an ADR. Deferred product directions remain in `docs/vision.md`.

## Bridge transport

`ws` 8.21.3 is pinned in `apps/desktop` (the only runtime dependency the bridge adds) and is verified against Electron 44.3.0 bundled Node 24.20.0: it is pure JavaScript with no native optional dependency, and it is externalized into the packaged app rather than bundled. It was chosen over `socket.io` (a protocol of its own on top of the wire format this project already specifies) and over Node’s built-in HTTP upgrade handling (no frame parsing, ping/pong or per-message size cap). The protocol contract itself lives in `packages/contracts` and does not know which server library carries it.

`@hostile-pet/contracts` 0.1.0 is a TypeScript-source-only internal package. It sits in the desktop app’s `devDependencies` because electron-vite bundles it: a TypeScript `main` copied into `app.asar` as a production dependency would fail to load under Electron 44.

## Desktop scaffold toolchain

electron-vite 5.0.0 + electron-builder 26.15.3 (ADR 0005), Electron 44.3.0, React 19.3.0, Vite 7.3.6, TypeScript 7.0.2, Zod 4.6.2, Vitest 4.1.11 and `ws` 8.21.3 are pinned in the desktop manifest. Build-time Node is 26.7.0 and pnpm is 10.28.2. Runtime compatibility verification is recorded in the README; pinning alone does not complete the macOS window, Keychain or Live2D gates.

## Agent package

`@langchain/langgraph` 1.4.15 and `@langchain/core` 1.2.11 are pinned in `packages/agent` with zod 4.6.2 (ADR 0006). Verified on Electron 44.3.0's bundled Node 24.20.0: engine ranges are satisfied and both packages load through their CommonJS `require` condition. The package currently holds the dependency boundary only — no graph, tool or prompt — because `docs/agent.md` §4 requires a settled tool-dispatch protocol first.
