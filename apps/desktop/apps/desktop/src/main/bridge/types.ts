import type {
  Copy,
  DeclaredSensor,
  InterventionKind,
  Lease,
  LeaseScope,
  OutboundMessage,
  RejectReason,
  ReleaseReason,
  SignalMessage,
  SignalPayload
} from '@hostile-pet/contracts'

/**
 * How strictly the bridge admits an extension.
 *
 * `dev-open` performs no token or origin check. It is loopback-only, records the origin it
 * saw, and MUST NOT ship: any local process — including a web page that opens
 * `ws://127.0.0.1` from a script — could impersonate an extension. `docs/protocol.md` §1.2
 * owns that decision, and the desktop shell refuses to start the bridge in a packaged build.
 */
export type BridgeSecurity = 'dev-open' | 'paired'

export type BridgePhase = 'stopped' | 'listening' | 'port-in-use' | 'failed'

/** What the kernel knows about the extension it is talking to. */
export interface BridgePeer {
  connectionId: string
  /** The `Origin` header, recorded verbatim, or null when the client omitted it. */
  origin: string | null
  extensionVersion: string
  sensors: DeclaredSensor[]
  capabilities: string[]
  connectedAt: number
}

/**
 * Bridge state as the tray and settings screen need it. `detail` is plain language: it is
 * shown to a person, never parsed.
 */
export interface BridgeStatus {
  phase: BridgePhase
  host: string
  port: number
  security: BridgeSecurity
  peer: BridgePeer | null
  activeLeases: number
  detail: string | null
}

/**
 * Every bridge log line. A closed union, like the desktop shell's action log, so a call
 * site cannot log a payload by accident: `docs/engineering.md` §2 requires structural,
 * minimal records with no secrets and no surplus page data.
 */
export type BridgeLogRecord =
  | { event: 'bridge.listening'; host: string; port: number; security: BridgeSecurity }
  | { event: 'bridge.stopped'; port: number; releasedLeases: number }
  | { event: 'bridge.failed'; code: string; detail: string }
  | {
      event: 'bridge.peer.connected'
      connectionId: string
      origin: string | null
      extensionVersion: string
      sensorCount: number
      capabilityCount: number
    }
  | { event: 'bridge.peer.refused'; connectionId: string; reason: RejectReason; detail: string; origin: string | null }
  | { event: 'bridge.peer.disconnected'; connectionId: string; code: number; detail: string; detachedLeases: number }
  | { event: 'bridge.message.invalid'; connectionId: string; reason: RejectReason; detail: string; violations: number }
  | { event: 'bridge.message.duplicate'; connectionId: string }
  | { event: 'bridge.message.dropped'; connectionId: string; reason: 'rate_limited' | 'too_large' | 'binary' }
  | { event: 'bridge.outbound.invalid'; connectionId: string; detail: string }
  | { event: 'bridge.signal.dropped'; connectionId: string; signal: string; reason: string; detail: string }
  | {
      event: 'bridge.intervention.requested'
      connectionId: string | null
      packId: string
      ruleId: string
      leaseId: string
      /** Which handler produced it. `mock` means nothing about behaviour is proven. */
      handler: string
    }
  | {
      event: 'bridge.intervention.released'
      connectionId: string | null
      packId: string
      ruleId: string
      leaseId: string
      reason: ReleaseReason
    }

/** Everything a handler may ask of the bridge. */
export interface HandlerContext {
  readonly connectionId: string
  readonly origin: string | null
  readonly sensors: readonly DeclaredSensor[]
  now(): number
  /** Sends to this connection. False when it is already gone. */
  send(message: OutboundMessage): boolean
  /**
   * Mints a lease and sends `intervention.request`. The bridge owns the lease registry:
   * TTL enforcement, the sweep and `welcome.activeLeases` are transport guarantees, so
   * every handler gets them without reimplementing them.
   *
   * Returns the lease, or null when the request was rejected (bad TTL, no connection).
   */
  requestIntervention(request: InterventionRequest): Lease | null
  /** Releases a lease early. False when it was already gone. */
  releaseIntervention(leaseId: string, reason: ReleaseReason): boolean
  log(record: BridgeLogRecord): void
}

export interface InterventionRequest {
  scope: LeaseScope
  /**
   * Window focus as the extension observed it in the signal that triggered this. Passed in
   * rather than looked up so no outbound frame has to invent a value it did not observe —
   * the alternative would be a fabricated field in a protocol that forbids fabrication.
   */
  windowFocused: boolean
  packId: string
  ruleId: string
  kind: InterventionKind
  ttlMs: number
  copy: Copy
  escapeLabel: string
  reason: string
  demoMode: boolean
}

/**
 * What decides *when* to intervene. The bridge decides how anything crosses the wire.
 *
 * A handler is deliberately not called "the kernel": the mock handler is a stub, and
 * `docs/hackathon.md` §4 requires that a stub be identifiable as one wherever it shows up.
 */
export interface BridgeHandler {
  /** Recorded in every intervention log line so a stub can never be mistaken for policy. */
  readonly id: string
  onConnected?(peer: BridgePeer, ctx: HandlerContext): void
  onSignal?(message: SignalMessage, sensor: DeclaredSensor, payload: SignalPayload, ctx: HandlerContext): void
  /**
   * Called for every lease that leaves the registry, whenever it leaves it — TTL, Pause,
   * Quit, pack disabled. A handler that tracks its own state must not discover a release by
   * noticing that the lease vanished.
   */
  onReleased?(lease: Lease, reason: ReleaseReason): void
  onDisconnected?(connectionId: string): void
}

export interface BridgeOptions {
  port: number
  host: string
  security: BridgeSecurity
  handler: BridgeHandler
  log(record: BridgeLogRecord): void
  onStatus?(status: BridgeStatus): void
  /** Required when `security` is `paired`; ignored otherwise. */
  pairedToken?: string
  /** Required when `security` is `paired`; ignored otherwise. */
  pairedOrigin?: string
  now?(): number
  heartbeatIntervalMs?: number
  handshakeTimeoutMs?: number
  maxMessageBytes?: number
  /** Inbound budget per connection: burst capacity, then a sustained refill rate. */
  rateLimit?: { capacity: number; refillPerSecond: number }
  maxViolations?: number
}

export interface Bridge {
  start(): Promise<BridgeStatus>
  stop(): Promise<void>
  status(): BridgeStatus
  /** Sends to the connected extension. False when nobody is listening. */
  send(message: OutboundMessage): boolean
  /** Unexpired leases, kernel-side. Drives `welcome.activeLeases` and the tray. */
  leases(): readonly Lease[]
  /** Releases every lease with one reason — Pause, Quit, pack disabled. */
  releaseAll(reason: ReleaseReason): number
}
