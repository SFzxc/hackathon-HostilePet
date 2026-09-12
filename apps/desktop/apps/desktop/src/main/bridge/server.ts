import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
  BRIDGE_CLOSE,
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_HEARTBEAT_INTERVAL_MS,
  BRIDGE_MAX_MESSAGE_BYTES,
  BRIDGE_MAX_VIOLATIONS,
  BRIDGE_RATE_LIMIT_CAPACITY,
  BRIDGE_RATE_LIMIT_REFILL_PER_SECOND,
  DEFAULT_TONE_LOCALE,
  LEASE_MAX_TTL_MS,
  LEASE_MIN_TTL_MS,
  PROTOCOL_VERSION,
  defaultLeaseDefaults,
  findDeclaredSensor,
  isKnownSignalSchemaId,
  parseInboundMessage,
  parseOutboundMessage,
  parseSignalPayload,
  type DeclaredSensor,
  type HelloMessage,
  type Lease,
  type OutboundMessage,
  type RejectReason,
  type ReleaseReason,
  type SignalMessage
} from '@hostile-pet/contracts'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Bridge, BridgeLogRecord, BridgeOptions, BridgePeer, BridgeStatus, HandlerContext, InterventionRequest } from './types'

/**
 * The bridge: one loopback WebSocket server, one extension at a time, zero Electron imports.
 *
 * It is deliberately host-agnostic so the same code runs inside the Electron main process
 * and inside the standalone fake-kernel entry (`bridge-standalone.ts`), which is what lets
 * the extension be developed without the desktop app (`docs/browser-pack.md` §5).
 *
 * Responsibilities are split so neither side has to trust the other for a decision it
 * cannot verify:
 *
 * | Concern | Owner |
 * | --- | --- |
 * | framing, size, rate, heartbeat, handshake, refusals | this file |
 * | `messageId` de-duplication | this file |
 * | lease registry, TTL, sweep, `welcome.activeLeases` | this file |
 * | when to intervene, `seq` monotonicity, accrual, copy | the `BridgeHandler` |
 *
 * Everything inbound is validated by `@hostile-pet/contracts` before a handler sees it, and
 * everything outbound is validated before it is sent — a handler bug becomes a log line
 * instead of a malformed frame on the wire.
 */

/** Bounded de-duplication window, in messages, per connection. */
const SEEN_MESSAGE_IDS = 256

/** Extra slack before a silent peer is treated as gone. */
const HEALTH_SLACK_MS = 1_000

/**
 * Timers are unref'd so a pending sweep never keeps a process alive on its own. Typed
 * through a helper because `setTimeout` resolves to Node's `Timeout` here but to a plain
 * number under the DOM lib this app also compiles against.
 */
function unref(timer: ReturnType<typeof setTimeout>): void {
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

interface Session {
  id: string
  socket: WebSocket
  origin: string | null
  connectedAt: number
  peer: BridgePeer | null
  sensors: DeclaredSensor[]
  violations: number
  tokens: number
  lastRefillAt: number
  lastInboundAt: number
  seenIds: string[]
  seenIdSet: Set<string>
  handshakeTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  closing: boolean
}

export function createBridge(options: BridgeOptions): Bridge {
  const now = options.now ?? Date.now
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? BRIDGE_HEARTBEAT_INTERVAL_MS
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? BRIDGE_HANDSHAKE_TIMEOUT_MS
  const maxMessageBytes = options.maxMessageBytes ?? BRIDGE_MAX_MESSAGE_BYTES
  const maxViolations = options.maxViolations ?? BRIDGE_MAX_VIOLATIONS
  const rateLimit = options.rateLimit ?? {
    capacity: BRIDGE_RATE_LIMIT_CAPACITY,
    refillPerSecond: BRIDGE_RATE_LIMIT_REFILL_PER_SECOND
  }

  const leases = new Map<string, Lease>()
  let server: WebSocketServer | null = null
  let session: Session | null = null
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  // The port actually bound. Differs from options.port when the caller asks for 0 and the
  // OS picks one, and the tray shows this value, so reporting the request would be a lie.
  let boundPort = options.port
  let phase: BridgeStatus['phase'] = 'stopped'
  let detail: string | null = null

  const log = (record: BridgeLogRecord): void => options.log(record)

  /**
   * A refusal sentence can quote what the client sent, so it is capped: a log line that can
   * grow without bound is a log line that eventually fills a disk.
   */
  const DETAIL_MAX = 240
  function clip(text: string): string {
    return text.length <= DETAIL_MAX ? text : `${text.slice(0, DETAIL_MAX)}… (${text.length - DETAIL_MAX} more characters)`
  }

  function status(): BridgeStatus {
    return {
      phase,
      host: options.host,
      port: boundPort,
      security: options.security,
      peer: session?.peer ?? null,
      activeLeases: leases.size,
      detail
    }
  }

  function publish(): BridgeStatus {
    const next = status()
    options.onStatus?.(next)
    return next
  }

  // ---------------------------------------------------------------- outbound plumbing

  /**
   * `protocolVersion` is annotated rather than inferred: an object literal widens `1` to
   * `number`, and the outbound schemas pin the version to the literal, so the widened form
   * would not typecheck against the message union.
   */
  function envelopeBase(): { protocolVersion: typeof PROTOCOL_VERSION; messageId: string; timestamp: number } {
    return { protocolVersion: PROTOCOL_VERSION, messageId: randomUUID(), timestamp: now() }
  }

  function write(target: Session, message: OutboundMessage): boolean {
    const valid = parseOutboundMessage(message)
    if (!valid.ok) {
      // A kernel-side bug, not a peer error. Refusing to send is the honest outcome: a
      // malformed frame would be worse than a missing one.
      log({ event: 'bridge.outbound.invalid', connectionId: target.id, detail: `${message.type}: ${valid.reason}: ${valid.detail}` })
      return false
    }
    if (target.socket.readyState !== target.socket.OPEN) return false
    target.socket.send(JSON.stringify(valid.value))
    return true
  }

  function send(message: OutboundMessage): boolean {
    const target = session
    if (!target || !target.peer || target.closing) return false
    return write(target, message)
  }

  function reject(target: Session, reason: RejectReason, text: string, retryAfterMs?: number): void {
    write(target, {
      ...envelopeBase(),
      type: 'reject',
      payload: {
        reason,
        detail: clip(text),
        ...(reason === 'version_mismatch' ? { expectedProtocolVersion: PROTOCOL_VERSION } : {}),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs })
      }
    })
  }

  function closeCodeFor(reason: RejectReason): number {
    switch (reason) {
      case 'malformed':
        return BRIDGE_CLOSE.malformed
      case 'handshake_timeout':
        return BRIDGE_CLOSE.handshakeTimeout
      case 'rate_limited':
        return BRIDGE_CLOSE.rateLimited
      case 'bad_token':
      case 'origin_not_paired':
        return BRIDGE_CLOSE.forbidden
      default:
        return BRIDGE_CLOSE.protocolViolation
    }
  }

  /**
   * Sends a readable refusal, then closes. The close reason is deliberately the short code
   * — WebSocket caps a close reason at 123 bytes — and the full sentence travels in the
   * `reject` payload, which is where a person will actually read it.
   */
  function refuse(target: Session, reason: RejectReason, text: string): void {
    if (target.closing) return
    target.closing = true
    log({ event: 'bridge.peer.refused', connectionId: target.id, reason, detail: clip(text), origin: target.origin })
    reject(target, reason, text)
    target.socket.close(closeCodeFor(reason), reason)
  }

  // ------------------------------------------------------------------ lease registry

  function scheduleSweep(): void {
    if (sweepTimer) {
      clearTimeout(sweepTimer)
      sweepTimer = null
    }
    let nextExpiry = Number.POSITIVE_INFINITY
    for (const lease of leases.values()) nextExpiry = Math.min(nextExpiry, lease.expiresAt)
    if (!Number.isFinite(nextExpiry)) return
    sweepTimer = setTimeout(() => {
      sweepTimer = null
      sweep()
    }, Math.max(0, nextExpiry - now()) + 1)
    unref(sweepTimer)
  }

  /**
   * Expires what is due. The release reason records whether anyone was there to be told: a
   * lease that ran out while the extension was connected expired normally, and one that ran
   * out while the worker was away expired because the extension was gone. Both are true;
   * nothing is inferred about why it left.
   */
  function sweep(): void {
    const at = now()
    for (const lease of [...leases.values()]) {
      if (lease.expiresAt <= at) release(lease.leaseId, session?.peer ? 'ttl_elapsed' : 'disconnect', at)
    }
    scheduleSweep()
  }

  function release(leaseId: string, reason: ReleaseReason, at = now()): boolean {
    const lease = leases.get(leaseId)
    if (!lease) return false
    leases.delete(leaseId)
    const owner = session?.peer ? session : null
    if (owner) {
      write(owner, {
        ...envelopeBase(),
        timestamp: at,
        type: 'intervention.release',
        payload: { leaseId, reason }
      })
    }
    log({
      event: 'bridge.intervention.released',
      connectionId: owner?.id ?? null,
      packId: lease.packId,
      ruleId: lease.ruleId,
      leaseId,
      reason
    })
    options.handler.onReleased?.(lease, reason)
    scheduleSweep()
    publish()
    return true
  }

  function releaseAll(reason: ReleaseReason): number {
    const ids = [...leases.keys()]
    for (const id of ids) release(id, reason)
    return ids.length
  }

  // ---------------------------------------------------------------------- heartbeat

  function startHeartbeat(target: Session): void {
    if (heartbeatIntervalMs <= 0) return
    target.heartbeatTimer = setInterval(() => {
      const idle = now() - target.lastInboundAt
      if (idle > heartbeatIntervalMs * 2 + HEALTH_SLACK_MS) {
        // An MV3 service worker that cannot answer within the window is treated as gone.
        // Leases are deliberately kept: `welcome.activeLeases` is how the surface resyncs
        // when the worker comes back, and the TTL still bounds it either way.
        target.closing = true
        log({
          event: 'bridge.message.invalid',
          connectionId: target.id,
          reason: 'protocol_violation',
          detail: `no inbound traffic for ${idle} ms`,
          violations: target.violations
        })
        target.socket.close(BRIDGE_CLOSE.healthTimeout, 'health timeout')
        return
      }
      write(target, { ...envelopeBase(), type: 'health.ping', payload: {} })
    }, heartbeatIntervalMs)
    unref(target.heartbeatTimer)
  }

  function context(target: Session): HandlerContext {
    return {
      connectionId: target.id,
      origin: target.origin,
      sensors: target.sensors,
      now,
      send: (message: OutboundMessage) => (session === target ? send(message) : false),
      requestIntervention: (request: InterventionRequest) => requestIntervention(target, request),
      releaseIntervention: (leaseId: string, reason: ReleaseReason) => release(leaseId, reason),
      log
    }
  }

  // ----------------------------------------------------------------------- handshake

  function handleHello(target: Session, message: HelloMessage): void {
    if (options.security === 'paired') {
      if (!options.pairedToken) {
        refuse(target, 'bad_token', 'this app is configured to require a token but has none; refusing every peer until it is configured.')
        return
      }
      if (message.payload.token !== options.pairedToken) {
        refuse(target, 'bad_token', 'the token in hello does not match the one this app is paired with.')
        return
      }
      if (options.pairedOrigin !== undefined && target.origin !== options.pairedOrigin) {
        refuse(
          target,
          'origin_not_paired',
          `this app is paired with ${options.pairedOrigin}, not ${target.origin ?? 'a client that sent no Origin header'}.`
        )
        return
      }
    }

    const unknownSchema = message.payload.sensors.find(sensor => !isKnownSignalSchemaId(sensor.schema))
    if (unknownSchema) {
      refuse(
        target,
        'unknown_schema',
        `this app cannot read schema ${unknownSchema.schema} for ${unknownSchema.packId}.${unknownSchema.name}; the only schema it implements is signal.session.tick@1.`
      )
      return
    }

    if (target.handshakeTimer) {
      clearTimeout(target.handshakeTimer)
      target.handshakeTimer = null
    }

    // One extension at a time: the newest hello wins, and the older socket is told why it
    // is going away instead of being dropped silently.
    const previous = session
    if (previous && previous !== target) {
      previous.closing = true
      previous.socket.close(BRIDGE_CLOSE.replacedByNewPeer, 'replaced by a newer connection')
    }

    target.sensors = [...message.payload.sensors]
    target.peer = {
      connectionId: target.id,
      origin: target.origin,
      extensionVersion: message.payload.extensionVersion,
      sensors: target.sensors,
      capabilities: [...message.payload.capabilities],
      connectedAt: target.connectedAt
    }
    session = target
    startHeartbeat(target)

    sweep()
    write(target, {
      ...envelopeBase(),
      type: 'welcome',
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        leaseDefaults: defaultLeaseDefaults,
        toneLocale: DEFAULT_TONE_LOCALE,
        activeLeases: [...leases.values()]
      }
    })

    log({
      event: 'bridge.peer.connected',
      connectionId: target.id,
      origin: target.origin,
      extensionVersion: target.peer.extensionVersion,
      sensorCount: target.sensors.length,
      capabilityCount: target.peer.capabilities.length
    })
    publish()
    options.handler.onConnected?.(target.peer, context(target))
  }

  // ----------------------------------------------------------------- intervention mint

  function requestIntervention(target: Session, request: InterventionRequest): Lease | null {
    if (session !== target || !target.peer) return null
    if (!Number.isInteger(request.ttlMs) || request.ttlMs < LEASE_MIN_TTL_MS || request.ttlMs > LEASE_MAX_TTL_MS) {
      // The cap is a product guarantee, not a preference: `docs/architecture.md` §7.
      log({
        event: 'bridge.signal.dropped',
        connectionId: target.id,
        signal: 'intervention',
        reason: 'ttl_out_of_range',
        detail: `ttlMs ${request.ttlMs} is outside ${LEASE_MIN_TTL_MS}..${LEASE_MAX_TTL_MS}`
      })
      return null
    }
    const lease: Lease = {
      leaseId: randomUUID(),
      kind: request.kind,
      ttlMs: request.ttlMs,
      expiresAt: now() + request.ttlMs,
      scope: request.scope,
      packId: request.packId,
      ruleId: request.ruleId,
      escapeLabel: request.escapeLabel,
      reason: request.reason
    }
    const sent = write(target, {
      ...envelopeBase(),
      type: 'intervention.request',
      context: { ...lease.scope, windowFocused: request.windowFocused },
      payload: { lease, copy: request.copy, demoMode: request.demoMode }
    })
    if (!sent) return null
    leases.set(lease.leaseId, lease)
    log({
      event: 'bridge.intervention.requested',
      connectionId: target.id,
      packId: lease.packId,
      ruleId: lease.ruleId,
      leaseId: lease.leaseId,
      handler: options.handler.id
    })
    scheduleSweep()
    publish()
    return lease
  }

  // -------------------------------------------------------------------- inbound routing

  function spendToken(target: Session): boolean {
    const at = now()
    const elapsed = Math.max(0, at - target.lastRefillAt)
    target.tokens = Math.min(rateLimit.capacity, target.tokens + (elapsed / 1000) * rateLimit.refillPerSecond)
    target.lastRefillAt = at
    if (target.tokens < 1) return false
    target.tokens -= 1
    return true
  }

  function isDuplicate(target: Session, messageId: string): boolean {
    if (target.seenIdSet.has(messageId)) return true
    target.seenIds.push(messageId)
    target.seenIdSet.add(messageId)
    if (target.seenIds.length > SEEN_MESSAGE_IDS) {
      const oldest = target.seenIds.shift()
      if (oldest !== undefined) target.seenIdSet.delete(oldest)
    }
    return false
  }

  function violation(target: Session, reason: RejectReason, text: string): void {
    target.violations += 1
    log({ event: 'bridge.message.invalid', connectionId: target.id, reason, detail: clip(text), violations: target.violations })
    if (target.violations >= maxViolations) {
      refuse(target, 'protocol_violation', `${maxViolations} invalid messages on this connection; closing. Last one: ${text}`)
      return
    }
    reject(target, reason, text)
  }

  function handleMessage(target: Session, raw: unknown): void {
    target.lastInboundAt = now()
    if (!spendToken(target)) {
      log({ event: 'bridge.message.dropped', connectionId: target.id, reason: 'rate_limited' })
      refuse(target, 'rate_limited', `more than ${rateLimit.capacity} messages arrived faster than ${rateLimit.refillPerSecond}/s; slow down and reconnect.`)
      return
    }

    const parsed = parseInboundMessage(raw)
    if (!parsed.ok) {
      if (target.peer === null) refuse(target, parsed.reason, parsed.detail)
      else violation(target, parsed.reason, parsed.detail)
      return
    }
    const message = parsed.value

    if (isDuplicate(target, message.messageId)) {
      // Legal, not an error: `docs/protocol.md` §1.1 makes a retry safe by making messageId
      // the identity of a message.
      log({ event: 'bridge.message.duplicate', connectionId: target.id })
      return
    }

    // `signal.*` carries a free-form type string, so the union cannot be narrowed by its
    // discriminant; each branch casts to the type its route already guaranteed.
    if (message.type === 'hello') {
      if (target.peer) violation(target, 'protocol_violation', 'hello was sent twice on one connection')
      else handleHello(target, message as HelloMessage)
      return
    }
    if (message.type === 'health.ping') {
      write(target, { ...envelopeBase(), type: 'health.pong', payload: {} })
      return
    }
    if (message.type === 'health.pong') return

    if (target.peer === null) {
      refuse(target, 'protocol_violation', 'a signal arrived before hello; the first message on a connection must be hello.')
      return
    }
    const signal = message as SignalMessage
    const sensor = findDeclaredSensor(target.sensors, signal.type)
    if (!sensor) {
      violation(target, 'protocol_violation', `${signal.type} was not declared in hello`)
      return
    }
    const payload = parseSignalPayload(sensor.schema, signal.payload)
    if (!payload.ok) {
      violation(target, payload.reason, payload.detail)
      return
    }
    options.handler.onSignal?.(signal, sensor, payload.value, context(target))
  }

  function handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const target: Session = {
      id: randomUUID(),
      socket,
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : null,
      connectedAt: now(),
      peer: null,
      sensors: [],
      violations: 0,
      tokens: rateLimit.capacity,
      lastRefillAt: now(),
      lastInboundAt: now(),
      seenIds: [],
      seenIdSet: new Set(),
      handshakeTimer: null,
      heartbeatTimer: null,
      closing: false
    }
    target.handshakeTimer = setTimeout(() => {
      target.handshakeTimer = null
      refuse(target, 'handshake_timeout', `no hello within ${handshakeTimeoutMs} ms.`)
    }, handshakeTimeoutMs)
    unref(target.handshakeTimer)

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        log({ event: 'bridge.message.dropped', connectionId: target.id, reason: 'binary' })
        if (target.peer === null) refuse(target, 'malformed', 'binary frames are not part of the protocol; send JSON text frames.')
        else violation(target, 'malformed', 'binary frame')
        return
      }
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (buffer.byteLength > maxMessageBytes) {
        log({ event: 'bridge.message.dropped', connectionId: target.id, reason: 'too_large' })
        target.closing = true
        socket.close(BRIDGE_CLOSE.malformed, 'malformed')
        return
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(buffer.toString('utf8'))
      } catch {
        if (target.peer === null) refuse(target, 'malformed', 'the frame is not valid JSON.')
        else violation(target, 'malformed', 'frame is not valid JSON')
        return
      }
      handleMessage(target, decoded)
    })

    socket.on('close', (code, reason) => {
      if (target.handshakeTimer) clearTimeout(target.handshakeTimer)
      if (target.heartbeatTimer) clearInterval(target.heartbeatTimer)
      const wasPeer = target.peer !== null
      if (session === target) session = null
      if (wasPeer) {
        log({
          event: 'bridge.peer.disconnected',
          connectionId: target.id,
          code,
          detail: reason.toString('utf8') || 'no reason given',
          detachedLeases: leases.size
        })
        options.handler.onDisconnected?.(target.id)
        publish()
      }
    })

    // A failed socket also closes; `close` reports it once. Logging here too would
    // double-count a single disconnect.
    socket.on('error', () => {})
  }

  // ------------------------------------------------------------------------- lifecycle

  async function start(): Promise<BridgeStatus> {
    if (server) return status()
    if (options.security === 'paired' && !options.pairedToken) {
      phase = 'failed'
      detail = 'paired mode was requested without a token; refusing to start rather than run open.'
      log({ event: 'bridge.failed', code: 'missing_token', detail })
      return publish()
    }

    return await new Promise<BridgeStatus>(resolve => {
      let settled = false
      const wss = new WebSocketServer({
        host: options.host,
        port: options.port,
        maxPayload: maxMessageBytes,
        perMessageDeflate: false,
        clientTracking: true
      })
      server = wss

      const finish = (next: BridgeStatus): void => {
        if (settled) return
        settled = true
        resolve(next)
      }

      wss.on('listening', () => {
        const address = wss.address()
        boundPort = typeof address === 'object' && address !== null ? address.port : options.port
        phase = 'listening'
        detail = null
        log({ event: 'bridge.listening', host: options.host, port: boundPort, security: options.security })
        finish(publish())
      })

      wss.on('error', (error: NodeJS.ErrnoException) => {
        const code = error.code ?? 'unknown'
        phase = code === 'EADDRINUSE' ? 'port-in-use' : 'failed'
        detail =
          code === 'EADDRINUSE'
            ? `port ${options.port} on ${options.host} is already in use; another copy of the app or the mock kernel is probably running.`
            : `the bridge could not listen on ${options.host}:${options.port} (${code}).`
        log({ event: 'bridge.failed', code, detail })
        // Released so a later start() can retry once the port is free again.
        server = null
        try {
          wss.close()
        } catch {
          // Already closed; nothing to release.
        }
        finish(publish())
      })

      wss.on('connection', handleConnection)
    })
  }

  async function stop(): Promise<void> {
    if (sweepTimer) {
      clearTimeout(sweepTimer)
      sweepTimer = null
    }
    const released = releaseAll('quit')
    const target = session
    session = null
    if (target) {
      if (target.handshakeTimer) clearTimeout(target.handshakeTimer)
      if (target.heartbeatTimer) clearInterval(target.heartbeatTimer)
      target.closing = true
    }
    const wss = server
    server = null
    if (wss) {
      await new Promise<void>(resolve => {
        try {
          for (const client of wss.clients) client.terminate()
          wss.close(() => resolve())
        } catch {
          resolve()
        }
      })
    } else if (target) {
      target.socket.terminate()
    }
    phase = 'stopped'
    log({ event: 'bridge.stopped', port: boundPort, releasedLeases: released })
    publish()
  }

  return {
    start,
    stop,
    status,
    send,
    leases: () => [...leases.values()],
    releaseAll
  }
}
