# Protocol, persistence, failure behaviour

> Owns: the bridge wire format, the local schema, and what happens when things break. Kernel internals live in `docs/architecture.md`.

## 1. Bridge

**Status:** the transport is implemented (`apps/desktop/src/main/bridge/`, contracts in `packages/contracts`). The handler behind it is a **mock** — no pack, no policy, no model. The catalogue in §1.7 is frozen for protocol 1 and is what an extension implementer codes against; `packages/contracts/src/fixtures.ts` is the machine-readable copy, and `apps/desktop/scripts/bridge-handshake.cjs` is a working client.

- Bind `127.0.0.1` only. Never `0.0.0.0`.
- Default port **54321**, overridable on both sides (§1.4).
- Random pairing token, plus origin verification for the paired extension. Origin checks do not replace the token.
- Web pages MUST NOT reach the privileged bridge. Content scripts send through extension messaging with validation.
- This build has exactly one transport (our own extension). Keep the boundary transport-shaped so a second could be added, but do not build a transport registry: `docs/adr/0001-extension-transport.md`.

### 1.1 Envelope

Every message, both directions, is one JSON text frame:

```jsonc
{
  "protocolVersion": 1,
  "messageId": "b7c1f0a2-5f5e-4a3d-9f0e-6a5b4c3d2e1f", // uuid, unique per message
  "type": "signal.hp.example.session.tick",               // 1..160 chars
  "timestamp": 1730000000000,                             // sender's UTC ms; ordering and logs only
  "context": { "tabId": 12, "documentId": "page-1", "windowFocused": true },
  "payload": { }
}
```

| Field | Rule |
| --- | --- |
| `protocolVersion` | MUST be `1`. Anything else is refused with `version_mismatch` before any other field is read. |
| `messageId` | UUID. Unique per message. A repeated id within the last 256 messages on a connection is **ignored**, never double-processed, and never counted as a violation — retries are safe. |
| `timestamp` | Integer UTC epoch milliseconds from the sender's clock. The kernel MUST NOT derive durations from it (`packages/contracts/src/fields.ts`); `activeMs` is the only duration that counts. |
| `context` | `{tabId, documentId, windowFocused}`, exact and no extras. Required on `signal.*` and `intervention.request`; optional on `hello` and `intervention.release`; absent on `welcome`, `reject` and the heartbeat. |
| `payload` | Validated per message type, `strict`: an unrecognised field is a rejection, not something to ignore. |

- The envelope and every payload object are strict. Extra keys are refused — a sender cannot smuggle a field past the kernel, and the kernel cannot leak one past the extension's validator.
- Message size limit, rate limit and violation budget: §1.9.
- Commands carry tab + document identity so navigation cannot inherit a stale gate.
- Heartbeat with reconnect backoff and state resync. Service worker memory is never the long-term source of truth.
- Tools and actions are idempotent; a retry MUST NOT create duplicate wishlist items or reminders.

### 1.2 Pairing (this build)

One extension, built by us, talking to one desktop app. No accounts, no cloud, no auto-discovery.

Intended flow, unchanged:

1. On first run the kernel generates a 32-byte random token, stores it in **Keychain**, and exposes **Copy pairing token** in the tray menu.
2. The user pastes it into the extension popup. Before storing it, the extension restricts `chrome.storage.local` to `TRUSTED_CONTEXTS` with `setAccessLevel`. It stores the token there — never `sync`, never the page, never a content-script message. This is the narrow Keychain exception accepted in ADR 0001.
3. The extension connects to `ws://127.0.0.1:<port>` and sends `hello` carrying the token.
4. The kernel accepts the **first** origin presenting a valid token and records it. A different origin is rejected afterwards even with a valid token.
5. **Unpair** in the tray clears the token, forgets the recorded origin, closes the socket, and releases every active lease. The extension drops to its disconnected state.
6. Token comparison is constant-time. Repeated failures park the bridge for a cooldown and surface a warning in the menu bar — loopback-only, but a 32-byte token is only useful if brute force is rate-limited.

Re-pairing is the same flow. A friendlier code-entry UX is polish, not a requirement.

**What is built, and what is not.** The bridge implements both admission modes:

| Mode | Admission | Where it runs |
| --- | --- | --- |
| `dev-open` | No token, no origin check. Records whatever `Origin` arrived. | `pnpm dev`, `bridge:mock`, every test. |
| `paired` | Requires a configured token, then the recorded origin. Refuses to start without one. | Implemented, exercised by tests, not yet wired to Keychain or the tray. |

`dev-open` is a development mode and MUST NOT ship: it is loopback-only, but any local process — including a web page opening `ws://127.0.0.1:54321` from a script — can present itself as the extension, because Chrome does not apply CORS to WebSockets and this mode checks no `Origin`. Two gates hold until the token is wired: the desktop shell does not start the bridge when `app.isPackaged`, and `hello` keeps its optional `token` field so the handshake shape does not change when pairing is switched on (§1.7.1). Keychain storage, the tray "Copy pairing token" item, the unpair flow and the cooldown counter are **not implemented**; they are this section's remaining work, and `bad_token` / `origin_not_paired` are the codes they will use.

### 1.3 Handshake

First exchange on every connection:

| Message | Direction | Payload |
| --- | --- | --- |
| `hello` | extension → kernel | `{protocolVersion, extensionVersion, token?, sensors[], capabilities[]}` |
| `welcome` | kernel → extension | `{protocolVersion, leaseDefaults, toneLocale, activeLeases[]}` |
| `reject` | kernel → extension | `{reason, detail, expectedProtocolVersion?, receivedProtocolVersion?, retryAfterMs?}` |

- `hello` MUST be the first message on a connection. Anything else, including the heartbeat, is refused with `protocol_violation` and closes the socket.
- Exactly one `hello` per connection. A second is `protocol_violation`.
- A connection that never sends `hello` within 5 s is closed with `handshake_timeout` and the code `4401`.
- `hello.protocolVersion` MUST equal the envelope's. They are refused with `version_mismatch` when they disagree, rather than leaving two sources of truth.
- A major version mismatch is explicit and readable ("extension speaks protocol 2, app expects 1 — update one of them"), never a silent degrade.
- `sensors[]` is what lets the UI mark dependent rules available/unavailable. Signals not declared here stay rejected at the bus. A declared `schema` the kernel cannot read is refused at `hello` with `unknown_schema`, so a developer learns immediately instead of watching every tick disappear.
- `welcome.activeLeases` is how the extension resyncs after an MV3 service-worker restart: the kernel is the source of truth, the worker is not.
- `reject` is always followed by a close. The close code names the class of refusal; the sentence travels in `detail`, because a WebSocket close reason is capped at 123 bytes.
- One extension at a time. A second `hello` replaces the first connection, which is closed with `4410` and releases its leases with `replaced_by_new_peer`.

### 1.4 Port and discovery

- One fixed default port, **54321**, documented in `packages/contracts`; overridable on both sides.
- The extension remembers the port in `chrome.storage.local`, the kernel in settings. No scanning, no mDNS, no broadcast — a port that moves by itself is a debugging trap.
- Port taken ⇒ tray error naming the exact port and pointing at the setting. The bridge reports the port it actually bound, never the one it asked for.

### 1.5 Stable extension identity

- An unpacked extension gets a new ID per machine unless the manifest pins `key`. **Pin it**, and derive the expected `chrome-extension://<id>` origin from that key for dev and release alike.
- Everything downstream depends on a deterministic ID: the recorded origin, the pairing record, and the bridge tests.

### 1.6 Transport choice

Loopback WebSocket + pairing token for this build. Chrome native messaging was evaluated and deferred — it removes the port and the shared secret in favour of Chrome-enforced origin binding, but requires a host manifest install and a spawned stdio shim in front of a long-running app. Rationale and consequences: `docs/adr/0001-extension-transport.md`.

If the carrier changes later, the envelope, handshake and event taxonomy stay as they are.

### 1.7 Message catalogue (protocol 1)

Everything the kernel accepts and everything it sends. Directions are named after the extension's perspective: **inbound** is extension → kernel, **outbound** is kernel → extension. Heartbeat messages exist in both directions and belong to both lists.

Existing JSON fixtures for every message and every refusal reason below live in `packages/contracts/src/fixtures.ts`; `pnpm --filter @hostile-pet/desktop bridge:mock --fixtures` prints them from the kernel's own copy, so an implementer never codes against a stale document.

#### 1.7.1 Inbound — extension → kernel

**`hello`** — exactly once, first.

```jsonc
{
  "protocolVersion": 1,
  "messageId": "…",
  "timestamp": 1730000000000,
  "type": "hello",
  "payload": {
    "protocolVersion": 1,
    "extensionVersion": "0.1.0",
    "sensors": [
      { "packId": "hp.example", "name": "session.tick", "schema": "signal.session.tick@1", "sites": ["example.com"] }
    ],
    "capabilities": ["surface.bubble"]
  }
}
```

| Field | Rule |
| --- | --- |
| `extensionVersion` | 1..32 chars. Display only; the activity log records it. |
| `token` | Optional in this build, 1..512 chars. A `paired` kernel refuses `hello` without it (`bad_token`). Present in the format now so an extension is built once. |
| `sensors[]` | ≤ 32. Each `{packId, name, schema, sites?}` is strict; `sites` ≤ 16 lowercase hosts **without scheme, path or query** (`docs/browser-pack.md` §1). |
| `capabilities[]` | ≤ 32 strings. Informational in protocol 1 — the catalogue lives in `packages/pack-sdk`, which does not exist yet, so an unknown id is logged, not refused. Unknown ids become a rejection when the catalogue lands. |

`context` is optional on `hello`: a service-worker handshake has no page. The kernel ignores it when present.

**`signal.<packId>.<name>`** — after `welcome`.

`type` MUST be exactly `signal.` + a `packId` declared in `hello` + `.` + that sensor's declared `name`. The kernel never splits the string — `hp.focus-shorts` is a legal pack id, so position is not a reliable divider. A signal whose `type` matches no declared sensor is refused with `protocol_violation` and the connection stays open.

`payload` is validated against the **schema id that sensor declared**, not against the `type`. v1 implements exactly one schema:

```jsonc
// schema: "signal.session.tick@1"
{
  "activeMs": 1000,   // integer 0..60000, an INCREMENT (see §1.8)
  "seq": 42,          // integer ≥ 0, strictly increasing per (connection, documentId, signal)
  "active": true,     // the page is the active tab and the user is engaging with it
  "visible": true,    // document.visibilityState === "visible"
  "idle": false,      // chrome.idle reported "active"
  "site": "example.com", // optional, lowercase host only
  "pageType": "feed"     // optional, adapter-defined token
}
```

**`health.ping` / `health.pong`** — allowed before `hello` and at any time after. `payload` is `{}`. The kernel answers a ping with a pong immediately and takes no action on a pong.

#### 1.7.2 Outbound — kernel → extension

**`welcome`** — the first message after a successful `hello`. No `context`.

```jsonc
{
  "protocolVersion": 1, "messageId": "…", "timestamp": 1730000000000, "type": "welcome",
  "payload": {
    "protocolVersion": 1,
    "leaseDefaults": { "minTtlMs": 1000, "defaultTtlMs": 60000, "maxTtlMs": 300000 },
    "toneLocale": "vi",
    "activeLeases": []
  }
}
```

`activeLeases` (≤ 64) carries whole leases, not ids, so a restarted service worker can rebuild its surfaces without asking again. A lease present here was minted on an **earlier** connection: the extension MUST render it, and MUST drop any lease it holds that is absent from this list.

**`reject`** — always last. The socket closes immediately after.

```jsonc
{ "protocolVersion": 1, "messageId": "…", "timestamp": 1730000000000, "type": "reject",
  "payload": { "reason": "version_mismatch", "detail": "…", "expectedProtocolVersion": 1 } }
```

| Field | Rule |
| --- | --- |
| `reason` | One of the nine codes in §1.9.2. A client MUST treat an unrecognised reason as a refusal and display `detail` unchanged. |
| `detail` | 1..400 chars, plain language, safe to log and to display. Long quotations from the client are clipped. |
| `expectedProtocolVersion` / `receivedProtocolVersion` | Present on `version_mismatch`. |
| `retryAfterMs` | Present on `rate_limited`. |

**`intervention.request`** — the only thing the kernel ever asks the extension to do. `context` is **required**: the request is scoped to the page the signal came from.

```jsonc
{
  "protocolVersion": 1, "messageId": "…", "timestamp": 1730000000000,
  "type": "intervention.request",
  "context": { "tabId": 12, "documentId": "page-1", "windowFocused": true },
  "payload": {
    "lease": {
      "leaseId": "…",                 // uuid, kernel-owned
      "kind": "bubble",               // bubble | overlay | grayscale
      "ttlMs": 60000,
      "expiresAt": 1730000060000,     // absolute, kernel-computed
      "scope": { "tabId": 12, "documentId": "page-1" },
      "packId": "hp.example",
      "ruleId": "mock.daily_budget",
      "escapeLabel": "Cho tôi qua",   // render verbatim, always visible
      "reason": "…"                   // 1..200 chars, plain language, shown in the activity log
    },
    "copy": { "text": "…", "locale": "vi", "source": "model" },
    "demoMode": false
  }
}
```

- `escapeLabel` is rendered **verbatim**, visibly, for the whole life of the lease. A surface without it is a bug (non-negotiable 4).
- `copy.source` is `model | fallback | mock`. `mock` MUST be shown as a stub wherever it appears — a stand-in line is never presented as generated copy (`docs/hackathon.md` §4).
- `demoMode: true` means a threshold was lowered to make the demo happen, and the surface MUST show the artificial badge (`docs/browser-pack.md` §2).
- `expiresAt` is the authority. The extension MUST NOT extend it, recompute it, or treat a retry as a renewal. Renewal semantics are open (§4), so there is deliberately no renewal message.
- `kind: "grayscale"` is not implemented by the shell and ships behind a flag at most (open decision 4). A surface that cannot render a kind MUST still show the escape and the lease's reason rather than rendering nothing.

**`intervention.release`** — sent for every lease that leaves the kernel registry, whatever the cause. `context` is **optional**: `leaseId` is the identity, and a release can follow a navigation that already invalidated the scope. Echoing a page identity back would be stale at best.

```jsonc
{ "protocolVersion": 1, "messageId": "…", "timestamp": 1730000000000,
  "type": "intervention.release", "payload": { "leaseId": "…", "reason": "ttl_elapsed" } }
```

**`health.ping`** — every 15 s on an idle connection. A peer that has sent nothing for 31 s (2 × interval + 1 s slack) is treated as gone: the socket is closed with `4409` and its leases are released with `disconnect`.

Releasing the leases on a **silent** peer is deliberately not done: a worker that fell asleep and came back must be able to resync through `welcome.activeLeases` instead of discovering that its gates vanished. Per-lease TTLs still expire on their own schedule.

#### 1.7.3 Nothing else

- There is no acknowledgement message, no renewal, no pause message and no request from the extension other than the heartbeat. Anything unrecognised in `type` is refused with `unsupported_type`.
- The kernel never sends a raw page value, a URL with a query string, a model prompt, a token or a state dump. A surface renders what the lease and `copy` already contain.

### 1.8 Authority and ordering rules

Decisions that an implementer cannot infer from the schemas:

1. **A signal payload owns the measurement; the envelope's `context` owns the location.** `activeMs`, `active`, `visible` and `idle` describe the page and travel in the payload. `tabId`, `documentId` and `windowFocused` travel in `context` and are never repeated inside a payload — a payload that repeats one is `malformed` (§1.1: one location per fact, so two copies can never disagree).
2. **`windowFocused` is per document, not per connection.** It is the focus state as the extension observed it for the page the signal is about. The kernel does not look it up; it uses what arrived.
3. **`activeMs` is an increment, and the kernel is the only accumulator.** The extension reports time observed since its last tick and never a session total, so a semi-trusted transport cannot dictate a counter value. A tick whose `seq` is not greater than the last accepted one for `(connection, documentId, signal)` is a replay: the kernel drops it and logs the drop. That is what makes a retry safe.
4. **Qualifying time is the intersection the kernel computes**, never a single flag: `activeMs` counts only when `active && visible && !idle && context.windowFocused`. Hidden, idle, unfocused and disconnected time is not usage (`docs/architecture.md` §6).
5. **A lease is scoped to `documentId`.** When the page identity changes, the extension tears the surface down and stops reporting the old document; the kernel releases the lease with `navigation`. A lease never survives navigation, and a surface never renders across one.
6. **Duplicate delivery is tolerated in both directions.** A repeated `messageId` inside the 256-message window is processed once and answered once. Only a changed body under a repeated id is a violation.
7. **Retries are safe; renewals do not exist.** Re-sending a tick with a new `messageId` and a greater `seq` adds the new increment. Re-sending an identical body adds nothing.
8. **The kernel is the source of truth for leases.** The extension's only durable lease knowledge is the last `welcome` plus the requests and releases it received; it rebuilds from the next `welcome`.

### 1.9 Limits, close codes and error vocabulary

#### 1.9.1 Limits

| Limit | Value | On breach |
| --- | --- | --- |
| Message size | 65536 bytes | Dropped. No violation is counted; the socket closes (`4400`, or the WebSocket-level `1009` when the transport rejects the frame first). |
| Inbound rate | 60 messages burst, 20 per second sustained, per connection | `rate_limited`: `reject` with `retryAfterMs`, then close `4408`. |
| Violations | 10 per connection | Close `4411`. A counted violation is answered with `reject` and the connection stays open, so one bad message during development does not cost the session; the tenth closes it. |
| Handshake | 5000 ms | Close `4401` with `reject {reason: "handshake_timeout"}`. |
| Heartbeat | 15000 ms | Close `4409` after 31000 ms of silence. |
| Lease TTL | 1000..300000 ms | A handler asking outside the range is refused kernel-side and logged; the wire never carries it. |
| One tick | 60000 ms | `activeMs` above one tick is `malformed`. |
| Binary frames | not part of the protocol | Dropped; `malformed`. Before `hello` the connection is refused outright, after it counts as a violation. |

A refusal **before** `hello` is the exception to the violation budget: there is no session to preserve yet, so the socket closes on the spot instead of accumulating violations — a signal before `hello` closes with `4411`, malformed or binary input with `4400`.

#### 1.9.2 Refusal reasons (`reject.payload.reason`)

| Reason | Meaning | Close |
| --- | --- | --- |
| `bad_token` | Token missing or wrong. | `4403` |
| `origin_not_paired` | A different origin than the paired one. | `4403` |
| `version_mismatch` | Envelope or `hello` carries a protocol version this kernel does not speak. | `4411` |
| `rate_limited` | Over the inbound budget. | `4408` |
| `malformed` | Not JSON, an envelope or payload that failed validation, a binary frame, or an oversize frame. | `4400` |
| `unsupported_type` | Envelope is valid; the kernel has no such message. | `4411` |
| `unknown_schema` | A declared sensor's `schema` is not one the kernel implements. | `4411` |
| `protocol_violation` | `hello` twice, a signal before `hello`, an undeclared signal, or a bad payload for a declared sensor. | `4411` |
| `handshake_timeout` | No `hello` within 5 s. | `4401` |

Codes are additive inside protocol 1: a new reason may appear without a version bump, so a client MUST fall back to displaying `detail`.

#### 1.9.3 Close codes

| Code | Name |
| --- | --- |
| `4400` | malformed |
| `4401` | handshake timeout |
| `4403` | forbidden (token or origin) |
| `4408` | rate limited |
| `4409` | heartbeat timeout |
| `4410` | replaced by a newer peer |
| `4411` | protocol violation |
| `1009` | frame too large, raised by the WebSocket layer itself |

#### 1.9.4 Release reasons (`intervention.release.payload.reason`)

`ttl_elapsed` · `user_override` · `navigation` · `disconnect` · `pause` · `quit` · `pack_disabled` · `day_rollover` · `replaced_by_new_peer`

`user_override` is reachable only once §4's local escape acknowledgement exists; until then the escape tears the surface down locally without telling the kernel, and the lease ends by TTL. An unknown reason MUST be displayed verbatim.

## 2. Persistence

The collections below define the required storage scope; field-level schemas remain to be specified before implementation. The accepted storage mechanism is **one JSON snapshot** — `state.json.tmp` → fsync → rename over `state.json`, keeping one `.bak` — with a top-level `version` for in-place shape upgrades. SQLite is deferred, not rejected (`docs/adr/0003-state-persistence.md`). A snapshot that fails to load MUST start clean and say so; it must never crash the pet window, and never pretend state exists that does not.

**Implemented now: the event log.** `userData/events.json` is a **capped ring buffer** of observations and agent turns — 500 records, debounced by one second, written with the same tmp → rename discipline (`docs/adr/0008-event-log-ring-buffer.md`). Four record kinds: `site.observed`, `site.session`, `agent.turn`, `agent.error`. A record carries a host, a category, elapsed seconds, a page count, the escalation level, the action and its result, the line and its source — never page content, a title or a URL with a query string. A record whose shape no longer parses is dropped with a `detail`, never repaired by guessing. This file is the window the agent reads every 30–60 s; it is **not** policy state, so counters that affect enforcement stay in `state.json`. Retention is by count, not by age: the ~14-day plan above is not implemented.


Collections (the shape a future SQLite schema must match):

`packs` · `pack_capability_grants` · `pack_kv` · `commitments` · `sessions` · `usage_counters` · `cart_observations` · `wishlist_items` · `reminders` · `interventions` · `settings` · `agent_turns`

Rules:

- `packs.origin` distinguishes `bundled | user | agent-drafted`; `source_hash` makes drafted packs auditable; `prompt_version` is recorded on agent turns.
- Money as integer minor units + ISO currency code. Timestamps as UTC epoch millis; timezone stored separately.
- No raw page text, no page HTML, no secrets in any stored field.
- `agent_turns` and event logs are capped ring buffers (default ~14 days) and redacted on write. The snapshot is not a growing archive.
- State that affects policy (counters, cooldowns, lease release reasons) MUST survive restart.
- Uninstalling a pack deletes its `pack_kv` entries and unused observations, after confirming with the user.
- Inspectability is a feature: the state file stays readable by a human during a demo rehearsal.

## 3. Failure behaviour

| Failure | Required behaviour |
| --- | --- |
| Model offline / error | Rule engine continues; fallback line pack; override still works. UI shows "AI offline" distinctly from "browser disconnected". |
| Desktop app not running | Extension shows disconnected and opens no new gates; existing leases expire by TTL. |
| Quit / Pause | Quit releases every lease with `quit` before the process exits (§1.9.4). Pause is not implemented; until it is, the TTL is the fallback. |
| Port in use | Clear error surfaced in the tray menu and in the bridge status line; no silent port change. The bridge reports `port-in-use`, stays stopped, and can be started again once the port is free. |
| Sleep / wake | Observed-time accounting pauses; no burst of phantom usage after wake; timers recomputed, not replayed. A worker that wakes late must not send the time it slept as `activeMs`. |
| Clock change / DST / new day | Daily counters roll over deterministically; no double reset, no negative durations. Daily rollover release (`day_rollover`) is not implemented yet. |
| Navigation mid-gate | Lease is scoped to `documentId`; navigating away releases it with `navigation`. |
| Extension reload / update mid-gate | Leases drop; the kernel re-evaluates from persisted state. A reconnecting worker resyncs from `welcome.activeLeases`, and a silent peer keeps its leases until the heartbeat times it out. |
| Snapshot write fails (disk full, permissions) | Keep running in memory, show a visible warning, retry with backoff, and never overwrite the last good snapshot. |
| Local reminders | Guaranteed only while the app runs. On relaunch, overdue reminders surface. No promise of background notification after Quit until an OS mechanism exists. |
| Tone validation fails twice | Fallback line is shown, the intervention still renders, the log records the fallback source (`docs/tone.md` §6). |

## 4. Contracts to resolve before implementation

Closed by §1.7–§1.9 and no longer blockers: tick semantics, sequencing, duplicate and replay handling, the inbound and outbound catalogue, the refusal and release vocabularies, and the limits and close-code mapping. What remains open:

- **Navigation:** same-document SPA route changes need stale-command protection on top of browser document identity. `documentId` is opaque to the kernel, so an SPA that never changes it looks like one document forever. Define how an adapter reports a route change without inventing a second identity.
- **Leases:** distinguish worker restart from extension reload; define **local escape acknowledgment** (no message today tells the kernel the user pressed the escape, which is why `user_override` is unreachable and the lease ends by TTL), renewal, and reissue after resync so a retry cannot extend or resurrect a released lease.
- **Clocks:** `timestamp` is the sender's clock and the kernel derives nothing from it. Decide whether cross-checking is wanted, and what the kernel does with a tick that arrives long after it was measured — MV3 workers can wake late, and §1.8 rule 3 forbids the extension from compensating by inflating `activeMs`.
- **Overlap and midnight:** accrual is per `(connection, documentId, signal)`. Two tabs of one site both qualifying, and a session crossing local midnight, are unspecified.
- **Capabilities:** `hello.capabilities[]` is informational until `packages/pack-sdk` defines the catalogue. Until then an unknown id is logged rather than refused (§1.7.1).
- **Persistence:** define field types, keys and references; distinguish graceful restart from crash durability. Define when critical changes may be acknowledged as durable, acceptable counter loss, backup recovery, unsupported versions and corruption handling. Never silently re-enable packs after a clean start.

## 5. Honesty requirements

- The activity log states what actually happened, including fallbacks, degraded sensors and skipped interventions.
- "Offline", "disconnected" and "paused" are three different visible states, never merged into one vague badge.
- If a sensor is not observing, the UI says so rather than showing a reassuring green dot.
- The shell keeps three bridge states apart in words a person reads: **not listening** (stopped, or the port is taken), **listening with no extension**, and **extension attached**. None of them may say "observing" while the handler behind the socket is a mock, and a mock handler is labelled as one wherever it is shown.
