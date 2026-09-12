# HostilePet

An Electron desktop companion for macOS. This repository currently implements the **desktop shell, the extension bridge and the event → agent → pet loop**: a tray, draggable transparent placeholder pet, settings window, validated preload IPC, a loopback WebSocket transport for a browser extension, a kernel handler that accrues observed site time, a capped event log, and an agent that reads that log every 30–60 s and answers with one line and one action.

## Run

```sh
pnpm install
pnpm dev
```

Use the menu-bar icon or the pet's **PLACEHOLDER ↗** button to open settings. Closing settings keeps the tray app running. Quit from settings or the tray menu.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package
pnpm smoke
```

`pnpm typecheck` and `pnpm test` run in every workspace package. The agent package adds a runtime check that proves its pinned library loads on Electron's Node rather than the build-time Node:

```sh
cd apps/desktop
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../../packages/agent/scripts/electron-runtime-check.cjs
```

`pnpm package` creates an unsigned local macOS application under `apps/desktop/release/`. It is not a signed or notarized public release.

The UI and tray state what is actually happening: the handler behind the socket (`kernel` or `mock`), the agent's provider and whether it is a model, the event-log path and its last records, and the escalation level. By default the agent runs the **curated** provider: it says so in the UI and stamps every line `source: fallback`. The OpenAI provider exists behind a flag (below), but it is off unless you select it and store a key. There is still no rule enforcement, pack runtime or Live2D model, and no rule pack has been written. The geometric placeholder is original CSS artwork, not production character art. No credentials are needed for the default path.

`packages/agent` holds the pinned agent library (ADR 0006) plus the implemented turn: context assembly, provider adapter, deterministic validator, one retry, fallback. It has no graph and no tools, because the tool-dispatch protocol in `docs/agent.md` §4 is still open.

## The real model, behind a flag

The curated provider is the default because the demo must not depend on a network. To let the model write the line instead:

```sh
security add-generic-password -s hostilepet.openai -a "$USER" -w   # stores the key in the login Keychain
HOSTILEPET_PROVIDER=openai pnpm dev
```

The key is read from Keychain at startup and handed to one call per turn; it is never written to `state.json`, never logged, and never sent to the renderer. `HOSTILEPET_MODEL` overrides the pinned `gpt-5.6-luna`, and `HOSTILEPET_OPENAI_BASE_URL` overrides the endpoint. If the key is missing, the persona artifact cannot be read, or the call fails — no network, a 401, a timeout, prose instead of JSON — the turn falls back to a curated line for the same level and the UI says which one ran. What is sent is the persona artifact plus the redacted context package: host, category, seconds, counts, clock. Never page content.

## The demo loop, without a browser extension

`scripts/simulate-site.cjs` is a fake sensor that speaks the real protocol. It says `hello`, declares `signal.hp.site.session.tick`, and streams ticks for one or more host names, so the whole chain can be demonstrated with no extension installed:

```sh
cd apps/desktop/apps/desktop
pnpm dev                                            # in one terminal
pnpm simulate --site youtube.com
pnpm simulate --site tiktok.com --tab-seconds 30   # 30s of time per second, faster than real time
```

Ticks are accumulated and written to `userData/events.json`; the agent reads the window roughly every 45 s and the pet reacts, growing more forceful as the level rises (30 s watching, 90 s concerned, 180 s hostile — the numbers live in `packs/site-catalog.json`). `HOSTILEPET_AGENT_INTERVAL_MS` tunes the cadence between 30 and 60 s, `HOSTILEPET_PROVIDER=openai` swaps the curated lines for the model, and `HOSTILEPET_HANDLER=mock` restores the protocol-only stub.

The simulator is a stand-in, not a browser sensor: it proves the chain end to end and nothing about Chrome. The event log records what it sent, and Settings prints those records verbatim.

See `AGENTS.md` for document routing and `docs/engineering.md` for remaining implementation gates.

## Building the extension against the bridge

`docs/protocol.md` §1.7 is the wire contract, `packages/contracts/src/fixtures.ts` is its machine-readable copy, and this is the loop to develop against:

```sh
cd apps/desktop
pnpm bridge:mock --fixtures   # every message and refusal reason the kernel accepts
pnpm bridge:mock              # the bridge with the mock handler, on 127.0.0.1:54321
node scripts/bridge-handshake.cjs            # a real client: handshake, gate, TTL release, re-arm
node scripts/bridge-handshake.cjs --url ws://127.0.0.1:54321   # attach to a running bridge
```

`bridge:mock` is a **fake kernel for development only**: the real bridge, a mock handler, no policy, no packs, no model. Its gate text is a placeholder pending tone generation (`docs/tone.md`), and a gate it raises is evidence about the protocol and nothing about behaviour. The desktop app starts the same bridge on launch in development; it does not start in a packaged build until pairing is wired (`docs/protocol.md` §1.2).

Options: `--port`, `--token`, `--trigger-ms`, `--ttl-ms`, `--stats-ms`, `--quiet`; `HP_BRIDGE_PORT`, `HP_BRIDGE_TOKEN`, `HP_MOCK_TRIGGER_MS`, `HP_MOCK_TTL_MS`, `HP_STATS_MS` as environment fallbacks.

## Verification

TypeScript, 32 desktop Vitest cases (26 of them over a real loopback socket: handshake accept and refuse, version mismatch, undeclared sensor, unknown schema, malformed frames, duplicate `messageId`, replayed `seq`, violation budget, rate limit, size limit, heartbeat timeout, lease TTL release and re-arm, resync after a worker restart, port collision, one-peer rule), 30 contract schema cases, two agent cases, the production build, and an unsigned Apple Silicon macOS `.app` package pass. The native Electron smoke check passes with both the production renderer and the development server. It verifies sandbox isolation, real preload IPC, pet show/hide, settings rendering, the bridge reaching `listening`, and closing settings without quitting. It uses a temporary user-data directory and captures a settings screenshot there.

The handshake driver passes end to end against the built fake kernel: `hello` → `welcome`, a mock gate with a finite TTL and a visible escape, a duplicate `messageId` that does not double-count, TTL release with `ttl_elapsed`, and re-arm with a fresh `leaseId`. Its own output says what it proves: the protocol, not the policy.

The agent package passes its own typecheck and two Vitest cases, and its runtime check reports `graph` and `core` loading successfully on Electron 44.3.0's bundled Node 24.20.0. That check proves the library boundary only; no agent turn has run against a provider.

Computer Use permissions were unavailable during initialization. Still pending manual checks: dragging and click-through edges, Spaces/fullscreen, focus behavior with other apps, multi-display unplug, and position persistence across restart. The production icon is not supplied; the package uses Electron’s default icon. Build output currently includes two upstream Zod annotation warnings; Windows installer scripts are deliberately not enabled for this macOS scaffold.

In a restricted environment where Chromium's OS sandbox cannot initialize, the smoke check needs `--no-sandbox`; the IPC-boundary assertions it makes are unaffected by that switch.
