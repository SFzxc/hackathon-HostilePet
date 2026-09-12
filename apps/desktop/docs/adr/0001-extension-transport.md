# ADR 0001 — Extension ↔ desktop transport

**Status:** accepted for this build
**Supersedes:** —
**Related:** `docs/protocol.md` §1, `docs/architecture.md` §1

> Runtime update: ADR 0004 replaces the original Tauri/Rust host with Electron/Node.js. The loopback transport and pairing decision below remain accepted; “one process” refers to one desktop application, not Electron’s OS process count.

## Context

The browser sensor pack needs a duplex channel between a Chrome MV3 extension (which we build ourselves, loaded unpacked during development) and the long-running Tauri/Rust desktop app. Requirements that actually matter here:

- The extension must push signals continuously and receive intervention commands with low latency.
- It must survive MV3 service-worker suspension and resync.
- A local malicious webpage must not be able to reach the privileged channel.
- The setup must be debuggable by one person during a hackathon, on one machine.

## Decision

Use a **loopback WebSocket** (`ws://127.0.0.1:<port>`) with a versioned JSON envelope, a random pairing token stored in Keychain, origin recording on first successful pair, and an explicit `hello → welcome | reject` handshake. Pin the extension's manifest `key` so its ID — and therefore its origin — is deterministic.

## Consequences

**Positive**

- One process, one port, inspectable with any WebSocket client; failures are easy to see.
- No installer step beyond loading the extension and pasting a token.
- The envelope, handshake and event taxonomy are carrier-independent, so a later transport swap is contained.

**Negative**

- A local port is a local attack surface: any local process can attempt a connection. Mitigated by the token, constant-time comparison, attempt rate limiting, and origin recording — not eliminated.
- The token exists in two places: Keychain (kernel) and `chrome.storage.local` (extension, plaintext inside the Chrome profile). This is acceptable for a loopback-only secret; a local attacker with profile write access already has worse options. It is not acceptable to reuse this token for anything else.
- Port configuration is a user-visible setting, which means a support burden ("extension says disconnected" → check the port).

## Alternatives considered

| Option | Why not now |
| --- | --- |
| **Chrome native messaging** | Strictly better origin binding (Chrome enforces `allowed_origins`), no port, no shared token. Rejected for this build because Chrome *spawns* the host process: our app is long-running, so we would need a separate stdio shim binary proxying to it over a unix socket, plus a host-manifest installer writing into `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. Two processes and an install step to remove a token we can rate-limit. Revisit as the H2 transport (`docs/vision.md`). |
| **Unix domain socket** | No port and filesystem permissions instead of a token — but extensions cannot open unix sockets, so it needs the same shim as native messaging. |
| **HTTP long-polling** | Worse latency, worse reconnect semantics, no clear win. |
| **Extension writes to a file the app watches** | No request/response, no lease lifecycle, fragile on MV3 suspension. |

## Revisit triggers

- A second sensor transport is needed, or a non-Chrome browser is supported.
- Distribution moves beyond unpacked/dev builds and the host-manifest install becomes packaging work anyway.
- A security review flags the loopback listener as unacceptable.

## Implementation notes (added after the first build)

The transport is implemented in `apps/desktop/src/main/bridge/` on `ws`, with the wire contract in `packages/contracts` (`docs/protocol.md` §1.7–§1.9). Two decisions that were not visible in the original text:

- **Default port `54321`**, loopback only, overridable. It was previously left open in `docs/protocol.md`; the choice is now pinned there (§1.4) and in `packages/contracts`.
- **`dev-open` mode, and the packaged-build gate.** Keychain storage, the tray "Copy pairing token" item, the unpair flow and the failure cooldown are not built yet, so the development bridge admits any loopback client and records its `Origin` rather than checking it. That is the negative consequence above, arriving early and stated plainly: a web page opening `ws://127.0.0.1:54321` is not blocked by CORS, so in `dev-open` the token is what stands between a page and the channel, and there is no token yet. The shell therefore does not start the bridge when `app.isPackaged`. `paired` mode (token, then recorded origin) is implemented and tested but not wired to the UI. Removing the packaged gate requires wiring pairing first — it is not a one-line change.
