# Desktop–Extension Real-Time Bridge Design

**Date:** 2026-09-12

**Status:** Approved design

**Scope:** Happy-path, local, real-time communication between the browser extension and the Electron desktop application

## Goal

Connect the browser extension to the desktop application's AI and policy runtime with a low-latency, bidirectional JSON channel. The extension records consented browser signals and executes page-scoped decisions. The desktop validates signals, decides whether an intervention is needed, and returns an action only when necessary.

This design optimizes for a fast first vertical slice. The desktop is assumed to be running. Durable queues, replay after downtime, production pairing, and broad failure hardening are deliberately deferred.

## Selected approach

Use the existing loopback WebSocket bridge in the Electron main process at `ws://127.0.0.1:54321`.

WebSocket is the smallest viable transport because it provides a persistent, ordered, bidirectional connection and maps directly to the JSON contracts already implemented under `apps/desktop/packages/contracts`. HTTP plus polling would add latency and request correlation without adding value to this phase. Chrome Native Messaging may be reconsidered for distribution hardening, but its host installation and packaging cost are outside this phase.

The existing bridge remains the transport boundary. Business rules and AI behavior do not move into the WebSocket server.

## Architecture

```text
Browser page
  -> content script: observe and sanitize browser activity
  -> extension service worker: normalize and send signal JSON
  -> loopback WebSocket
  -> Electron main-process bridge: validate and route
  -> bridge handler
  -> deterministic rule/policy runtime
  -> AI runtime only when judgment or language is needed
  -> bridge handler creates a page-scoped intervention lease
  -> loopback WebSocket
  -> extension service worker routes the decision
  -> content script verifies page identity and renders the action
```

### Ownership

| Component | Responsibility |
| --- | --- |
| Content script | Observe consented page activity, remove unnecessary page data, and render or remove page UI. |
| Extension service worker | Own the single WebSocket connection, normalize content-script messages, and route desktop decisions to the target tab. |
| Desktop bridge | Parse and validate JSON, manage the connection and intervention leases, and route valid messages. |
| Bridge handler | Adapt validated signals to the policy/AI runtime and convert decisions into bridge messages. |
| Deterministic policy runtime | Decide whether an intervention is permitted and required. |
| AI runtime | Evaluate ambiguous context or produce short copy when requested by policy; it does not control transport or enforcement. |
| Desktop presentation | Reflect pet state independently of browser page rendering. |

The content script must not connect directly to the desktop. Electron renderer processes must not own or expose the bridge. Raw DOM, typed text, payment fields, private messages, credentials, and complete page content must not cross the boundary.

The Python service under `apps/local-server` is outside this bridge flow. If it is used for camera or local inference later, the Electron runtime remains the owner of browser policy decisions and extension commands.

## Protocol

The first slice keeps protocol version 1 and the existing contract vocabulary:

- extension to desktop: `hello`, `signal.*`, `health.ping`, and `health.pong`;
- desktop to extension: `welcome`, `intervention.request`, `intervention.release`, `health.ping`, and `health.pong`;
- `reject` remains available for a malformed handshake or message but is not a primary happy-path flow.

There is no acknowledgment for every signal and no result callback for every decision in this phase. WebSocket ordering is sufficient while one live connection is assumed. When no intervention is required, the desktop sends no response.

### Shared envelope

Every application message carries:

```json
{
  "protocolVersion": 1,
  "messageId": "22222222-2222-4222-8222-222222222222",
  "timestamp": 1789142401000,
  "type": "signal.browser.session.tick",
  "context": {
    "tabId": 42,
    "documentId": "doc-abc",
    "windowFocused": true
  },
  "payload": {}
}
```

`messageId` identifies one message. `timestamp` is Unix time in milliseconds. Page-scoped messages use `tabId` plus `documentId`; this pair is the correlation identity between an observed signal and a decision. A `leaseId` identifies the lifetime of one intervention. No additional general-purpose `correlationId` is needed.

### Handshake

The service worker opens the socket and sends `hello` before any signal:

```json
{
  "protocolVersion": 1,
  "messageId": "11111111-1111-4111-8111-111111111111",
  "timestamp": 1789142400000,
  "type": "hello",
  "payload": {
    "protocolVersion": 1,
    "extensionVersion": "0.1.0",
    "sensors": [
      {
        "packId": "browser",
        "name": "session.tick",
        "schema": "signal.session.tick@1"
      }
    ],
    "capabilities": ["surface.overlay", "surface.bubble"]
  }
}
```

The desktop replies with `welcome`. Only after `welcome` may the service worker forward browser signals.

### Browser signal

The initial end-to-end slice uses the existing incremental session tick:

```json
{
  "protocolVersion": 1,
  "messageId": "22222222-2222-4222-8222-222222222222",
  "timestamp": 1789142401000,
  "type": "signal.browser.session.tick",
  "context": {
    "tabId": 42,
    "documentId": "doc-abc",
    "windowFocused": true
  },
  "payload": {
    "activeMs": 1000,
    "seq": 15,
    "active": true,
    "visible": true,
    "idle": false,
    "site": "youtube.com",
    "pageType": "short-form-feed"
  }
}
```

The extension reports observations, not policy conclusions. `activeMs` is an increment. `seq` increases for each signal within the live document. Site-specific thresholds and decisions belong to a browser pack or policy layer rather than bridge code.

### Desktop decision

When policy requires an extension action, the desktop sends the existing `intervention.request`:

```json
{
  "protocolVersion": 1,
  "messageId": "33333333-3333-4333-8333-333333333333",
  "timestamp": 1789142401200,
  "type": "intervention.request",
  "context": {
    "tabId": 42,
    "documentId": "doc-abc",
    "windowFocused": true
  },
  "payload": {
    "lease": {
      "leaseId": "44444444-4444-4444-8444-444444444444",
      "kind": "overlay",
      "ttlMs": 60000,
      "expiresAt": 1789142461200,
      "scope": {
        "tabId": 42,
        "documentId": "doc-abc"
      },
      "packId": "browser",
      "ruleId": "doomscroll-warning",
      "escapeLabel": "Return to focus",
      "reason": "Short-form feed threshold reached"
    },
    "copy": {
      "text": "You came here for one video. That was fifteen minutes ago.",
      "locale": "en",
      "source": "model"
    },
    "demoMode": false
  }
}
```

Before rendering, the extension verifies that both the tab and document still match the decision scope. A decision for a previous document is ignored. The user-visible escape remains available for every intervention.

The desktop ends the action with `intervention.release`:

```json
{
  "protocolVersion": 1,
  "messageId": "55555555-5555-4555-8555-555555555555",
  "timestamp": 1789142461200,
  "type": "intervention.release",
  "payload": {
    "leaseId": "44444444-4444-4444-8444-444444444444",
    "reason": "ttl_elapsed"
  }
}
```

The extension removes the UI associated with that `leaseId`.

## Runtime lifecycle

### Extension lifecycle

1. The service worker opens the loopback WebSocket.
2. It sends `hello` and waits for `welcome`.
3. Content scripts send sanitized observations to the service worker through Chrome runtime messaging.
4. The service worker emits normalized `signal.*` messages.
5. It routes `intervention.request` to the target tab.
6. The content script confirms `documentId`, then renders the requested surface.
7. `intervention.release` removes the surface by `leaseId`.
8. On an unexpected disconnect, the worker reconnects with delays of 1, 2, then 5 seconds. It does not replay old signals.

### Desktop lifecycle

1. Electron main starts the loopback bridge.
2. The bridge validates `hello` and returns `welcome`.
3. It validates each signal against the schema declared during the handshake.
4. The bridge handler passes a valid signal to policy.
5. Policy completes without output when no action is needed.
6. When action is needed, policy optionally asks AI for evaluation or copy.
7. The handler requests a finite intervention lease from the bridge.
8. The bridge sends `intervention.request` and later `intervention.release` when the lease expires or is explicitly released.

## Implementation slices

Implementation should proceed as one thin vertical path rather than building every sensor and action first:

1. **Shared contract:** continue using `apps/desktop/packages/contracts` as the TypeScript source of truth. Wire the extension build to consume it instead of duplicating interfaces.
2. **Extension bridge client:** add one service-worker WebSocket client and runtime-message routing. Initially, a valid received intervention may be logged before page UI is connected.
3. **Desktop handler:** replace the mock handler in the application path with a real adapter that invokes policy/AI. Keep domain rules outside `bridge/server.ts`.
4. **End-to-end surface:** connect one `session.tick` signal to one finite `overlay` intervention, including its release. Only after this works should more browser signals or shopping actions be added.

## Minimal verification

The phase does not add a broad unit-test matrix. Completion requires one real loopback smoke flow plus type/build checks for the changed packages.

The smoke flow must demonstrate:

```text
PASS desktop bridge listens on 127.0.0.1
PASS extension bridge client receives welcome
PASS one browser signal reaches and is parsed by the desktop handler
PASS the handler emits intervention.request
PASS the decision reaches the intended tab and document
PASS intervention.release removes the rendered action
```

Mocks may establish protocol wiring but do not prove that the real policy or AI path works. The final smoke must exercise the real handler selected for the first vertical slice. A live production website is not required; a controlled browser fixture is sufficient.

## Deferred work

The following are intentionally excluded from the first implementation:

- durable event storage or replay after desktop downtime;
- per-message acknowledgments and generic decision-result callbacks;
- multi-profile or multiple simultaneous extension peers;
- production pairing, token distribution, and packaged-build security hardening;
- Chrome Native Messaging;
- a comprehensive failure and compatibility test matrix;
- camera, gaze, and Python local-inference transport;
- additional sensors, shopping adapters, and renewal semantics.

These exclusions do not weaken the existing product rules: processing remains local, browser data remains minimal and consented, deterministic policy owns enforcement, and every intervention has a finite lease and visible escape.

## Acceptance criteria

The design is implemented when:

1. The extension maintains one WebSocket connection to the running desktop app.
2. A real browser event travels from a content script through the service worker to the desktop handler.
3. The desktop returns a valid decision scoped by `tabId`, `documentId`, and `leaseId`.
4. The extension renders and releases the intervention on the intended page.
5. Raw DOM, typed text, private content, credentials, and payment data do not cross the bridge.
6. The complete flow runs locally without a cloud transport dependency.
