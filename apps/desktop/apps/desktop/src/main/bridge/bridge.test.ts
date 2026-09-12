import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  parseOutboundMessage,
  validInbound,
  type InboundMessage,
  type OutboundMessage
} from '@hostile-pet/contracts'
import { createMockHandler, type MockHandler } from './mock-handler'
import { createBridge } from './server'
import type { Bridge, BridgeLogRecord } from './types'

/**
 * Bridge integration tests. They run a real server on a real loopback socket and speak the
 * real wire format through the real contracts validators, because the thing under test is a
 * protocol, and a protocol tested against mocks of itself proves nothing
 * (`AGENTS.md` non-negotiable 10).
 */

const HOST = '127.0.0.1'
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

interface Harness {
  bridge: Bridge
  mock: MockHandler
  port: number
  logs: BridgeLogRecord[]
  stop(): Promise<void>
}

const running: Harness[] = []

afterEach(async () => {
  while (running.length) await running.pop()?.stop()
})

async function startBridge(overrides: Partial<Parameters<typeof createBridge>[0]> = {}, mockOptions = {}): Promise<Harness> {
  const logs: BridgeLogRecord[] = []
  const mock = createMockHandler(mockOptions)
  const bridge = createBridge({
    port: 0,
    host: HOST,
    security: 'dev-open',
    handler: mock,
    log: record => logs.push(record),
    ...overrides
  })
  const status = await bridge.start()
  expect(status.phase, status.detail ?? '').toBe('listening')
  const harness: Harness = {
    bridge,
    mock,
    port: status.port,
    logs,
    stop: async () => {
      await bridge.stop()
    }
  }
  running.push(harness)
  return harness
}

/** `'any'` is a wait target, not a message type: it matches whatever arrives next. */
type WaitTarget = OutboundMessage['type'] | 'any'

interface Client {
  socket: WebSocket
  received: OutboundMessage[]
  send(message: unknown): void
  waitFor(type: WaitTarget, timeoutMs?: number): Promise<OutboundMessage>
  closed: Promise<{ code: number; reason: string }>
  close(): void
}

function connect(port: number, origin: string = EXTENSION_ORIGIN): Client {
  const socket = new WebSocket(`ws://${HOST}:${port}`, { origin })
  const received: OutboundMessage[] = []
  const consumed = new Set<number>()
  const waiters: { type: WaitTarget; resolve: (message: OutboundMessage) => void }[] = []
  let closeInfo: { code: number; reason: string } | null = null
  let resolveClosed: (value: { code: number; reason: string }) => void = () => {}
  let transportError: Error | null = null

  socket.on('message', raw => {
    const parsed = parseOutboundMessage(JSON.parse(raw.toString()))
    // The kernel is required to send only valid frames; a failure here is the bug.
    if (!parsed.ok) throw new Error(`kernel sent an invalid frame: ${parsed.reason}: ${parsed.detail}`)
    received.push(parsed.value)
    for (const waiter of [...waiters]) {
      if (waiter.type !== 'any' && waiter.type !== parsed.value.type) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      consumed.add(received.indexOf(parsed.value))
      waiter.resolve(parsed.value)
    }
  })
  // Attached before anything else so a refused connection cannot become an uncaught event.
  socket.on('error', error => {
    transportError = error
  })
  socket.on('close', (code, reason) => {
    closeInfo = { code, reason: reason.toString('utf8') }
    resolveClosed(closeInfo)
  })

  const client: Client = {
    socket,
    received,
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error(`send before open: readyState ${socket.readyState}`)
      socket.send(JSON.stringify(message))
    },
    waitFor(type, timeoutMs = 2000) {
      // Messages are consumed in order: without this, a second waitFor for the same type
      // would hand back the first one again and quietly assert nothing.
      const index = received.findIndex((message, at) => !consumed.has(at) && (type === 'any' || message.type === type))
      if (index >= 0) {
        consumed.add(index)
        const already = received[index]
        if (already) return Promise.resolve(already)
      }
      if (transportError) return Promise.reject(transportError)
      return new Promise<OutboundMessage>((resolve, reject) => {
        const waiter = {
          type,
          resolve: (message: OutboundMessage) => {
            clearTimeout(timer)
            resolve(message)
          }
        }
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          const seen = received.map(m => m.type).join(', ') || 'nothing'
          reject(new Error(`no ${type} within ${timeoutMs} ms; saw ${seen}; error: ${transportError?.message ?? 'none'}`))
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
    closed: new Promise(resolve => {
      resolveClosed = resolve
      if (closeInfo) resolve(closeInfo)
    }),
    close() {
      socket.close()
    }
  }

  return client
}

/** Connects and waits for the socket to open, so no test can send into a connecting socket. */
async function connectReady(port: number, origin: string = EXTENSION_ORIGIN): Promise<Client> {
  const client = connect(port, origin)
  if (client.socket.readyState === WebSocket.OPEN) return client
  await new Promise<void>((resolve, reject) => {
    client.socket.once('open', () => resolve())
    client.socket.once('error', reject)
  })
  return client
}

function hello(overrides: Record<string, unknown> = {}): InboundMessage {
  return { ...validInbound.hello, messageId: randomUUID(), ...overrides } as InboundMessage
}

function tick(payload: Record<string, unknown> = {}, context: Record<string, unknown> = {}): InboundMessage {
  return {
    ...validInbound.tick,
    messageId: randomUUID(),
    context: { ...validInbound.tick.context, ...context },
    payload: { ...(validInbound.tick.payload as object), ...payload }
  } as InboundMessage
}

async function handshake(client: Client): Promise<OutboundMessage> {
  client.send(hello())
  return await client.waitFor('welcome')
}

/**
 * The server-side `close` handler runs after the client observes the close, so a log
 * assertion made immediately after `client.closed` is a race, not a fact.
 */
async function waitForLog<
  T extends BridgeLogRecord['event']
>(h: Harness, event: T, timeoutMs = 2000): Promise<Extract<BridgeLogRecord, { event: T }>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = h.logs.find((record): record is Extract<BridgeLogRecord, { event: T }> => record.event === event)
    if (found) return found
    if (Date.now() > deadline) {
      throw new Error(`no ${event} log within ${timeoutMs} ms; saw ${h.logs.map(r => r.event).join(', ') || 'nothing'}`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('handshake', () => {
  it('answers a valid hello with welcome, then records the peer', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    const welcome = await handshake(client)

    expect(welcome.type).toBe('welcome')
    if (welcome.type !== 'welcome') return
    expect(welcome.payload.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(welcome.payload.activeLeases).toEqual([])
    expect(welcome.payload.leaseDefaults.maxTtlMs).toBeGreaterThan(0)
    expect(h.bridge.status().peer?.extensionVersion).toBe('0.1.0')
    expect(h.bridge.status().peer?.origin).toBe(EXTENSION_ORIGIN)
    client.close()
  })

  it('refuses a future protocol version with a line a person can act on', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    client.send(hello({ protocolVersion: 2, payload: { ...validInbound.hello.payload, protocolVersion: 2 } }))

    const rejection = await client.waitFor('reject')
    expect(rejection.type).toBe('reject')
    if (rejection.type !== 'reject') return
    expect(rejection.payload.reason).toBe('version_mismatch')
    expect(rejection.payload.detail).toContain('protocol 2')
    expect(rejection.payload.expectedProtocolVersion).toBe(PROTOCOL_VERSION)
    expect((await client.closed).code).toBe(4411)
  })

  it('refuses a signal that arrives before hello', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    client.send(tick())

    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('protocol_violation')
    expect((await client.closed).code).toBe(4411)
  })

  it('refuses a sensor whose schema the kernel cannot read', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    client.send(
      hello({
        payload: {
          ...validInbound.hello.payload,
          sensors: [{ packId: 'hp.example', name: 'session.tick', schema: 'signal.session.tick@9' }]
        }
      })
    )

    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('unknown_schema')
    expect(rejection.payload.detail).toContain('signal.session.tick@9')
  })

  it('refuses invalid JSON and keeps a handshaken connection open', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    await handshake(client)
    client.socket.send('{not json')
    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('malformed')

    // Still usable: one mistake is not a reason to drop a working connection.
    client.send(tick({ activeMs: 1, seq: 1 }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(client.socket.readyState).toBe(WebSocket.OPEN)
  })

  it('refuses malformed JSON before hello without spending the violation budget', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    client.socket.send('{not json')
    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('malformed')
    // Nothing exists to preserve before the handshake, so the connection goes at once.
    expect((await client.closed).code).toBe(4400)
  })

  it('closes after the violation budget is exhausted', async () => {
    const h = await startBridge({ maxViolations: 2 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.socket.send('{not json')
    await client.waitFor('reject')
    client.socket.send('{still not json')
    expect((await client.closed).code).toBe(4411)
    expect(h.logs.filter(record => record.event === 'bridge.message.invalid').length).toBeGreaterThanOrEqual(2)
  })

  it('caps a refusal that quotes what the client sent', async () => {
    // The refusal sentence quotes the origin back, and an Origin header is client-controlled
    // up to Node's header limit: without a cap, one connection could write a novel into the
    // kernel's log.
    const h = await startBridge({ security: 'paired', pairedToken: 'expected-token', pairedOrigin: EXTENSION_ORIGIN })
    const client = await connectReady(h.port, `chrome-extension://${'y'.repeat(900)}`)
    client.send(hello({ payload: { ...validInbound.hello.payload, token: 'expected-token' } }))

    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('origin_not_paired')
    expect(rejection.payload.detail.length).toBeLessThan(400)
    expect(rejection.payload.detail).toContain('more characters')
    const refusal = h.logs.find(record => record.event === 'bridge.peer.refused')
    expect(refusal?.event === 'bridge.peer.refused' && refusal.detail.length).toBeLessThan(400)
  })

  it('gives up on a client that never says hello', async () => {
    const h = await startBridge({ handshakeTimeoutMs: 40 })
    const client = await connectReady(h.port)
    const closed = await client.closed
    expect(closed.code).toBe(4401)
    expect(h.logs.some(record => record.event === 'bridge.peer.refused')).toBe(true)
  })
})

describe('signal integrity', () => {
  it('refuses a signal nobody declared, without closing', async () => {
    const h = await startBridge()
    const client = await connectReady(h.port)
    await handshake(client)
    client.send({
      ...validInbound.tick,
      messageId: randomUUID(),
      type: 'signal.hp.undeclared.session.tick'
    })

    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('protocol_violation')
    expect(rejection.payload.detail).toContain('was not declared')
    expect(client.socket.readyState).toBe(WebSocket.OPEN)
  })

  it('ignores a repeated messageId instead of counting it twice', async () => {
    const h = await startBridge({}, { triggerActiveMs: 150 })
    const client = await connectReady(h.port)
    await handshake(client)

    const first = tick({ activeMs: 100, seq: 1 })
    client.send(first)
    client.send(first)
    client.send(tick({ activeMs: 100, seq: 2 }))

    const request = await client.waitFor('intervention.request')
    expect(request.type).toBe('intervention.request')
    // Two accepted ticks of 100 ms: exactly one duplicate was dropped, so the gate tripped
    // on the second real tick rather than the third.
    expect(h.logs.filter(record => record.event === 'bridge.message.duplicate')).toHaveLength(1)
  })

  it('drops a reused seq and says so', async () => {
    const h = await startBridge({}, { triggerActiveMs: 10_000 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.send(tick({ activeMs: 100, seq: 5 }))
    client.send(tick({ activeMs: 100, seq: 5 }))
    client.send(tick({ activeMs: 100, seq: 4 }))

    await new Promise(resolve => setTimeout(resolve, 100))
    const dropped = h.logs.filter(record => record.event === 'bridge.signal.dropped')
    expect(dropped).toHaveLength(2)
    expect(h.bridge.leases()).toHaveLength(0)
  })

  it('does not accrue while the page is hidden, idle or unfocused', async () => {
    const h = await startBridge({}, { triggerActiveMs: 150 })
    const client = await connectReady(h.port)
    await handshake(client)

    // Three ticks that report activity the product must not count, then a short real one.
    client.send(tick({ activeMs: 1000, seq: 1, visible: false }))
    client.send(tick({ activeMs: 1000, seq: 2, idle: true }))
    client.send(tick({ activeMs: 1000, seq: 3 }, { windowFocused: false }))
    client.send(tick({ activeMs: 60, seq: 4 }))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(client.received.some(message => message.type === 'intervention.request')).toBe(false)

    // Only now is the 150 ms threshold crossed: 60 + 100, not 3000 + 160.
    client.send(tick({ activeMs: 100, seq: 5 }))
    const request = await client.waitFor('intervention.request')
    if (request.type !== 'intervention.request') throw new Error('expected a request')
    expect(request.payload.lease.packId).toBe('hp.example')
    expect(h.mock.stats().accruedMs).toBe(160)
  })

  it('enforces the message size limit', async () => {
    const h = await startBridge({ maxMessageBytes: 256 })
    const client = await connectReady(h.port)
    client.socket.send(JSON.stringify({ padding: 'x'.repeat(600) }))
    const closed = await client.closed
    expect(closed.code).toBeGreaterThan(0)
  })

  it('enforces the inbound rate limit', async () => {
    const h = await startBridge({ rateLimit: { capacity: 3, refillPerSecond: 0 } })
    const client = await connectReady(h.port)
    await handshake(client)
    for (let i = 0; i < 3; i += 1) client.send(tick({ activeMs: 1, seq: i }))

    const rejection = await client.waitFor('reject')
    if (rejection.type !== 'reject') throw new Error('expected a reject')
    expect(rejection.payload.reason).toBe('rate_limited')
    expect(h.logs.some(record => record.event === 'bridge.message.dropped')).toBe(true)
  })
})

describe('heartbeat', () => {
  it('pings and accepts a pong', async () => {
    const h = await startBridge({ heartbeatIntervalMs: 30 })
    const client = await connectReady(h.port)
    await handshake(client)

    const ping = await client.waitFor('health.ping')
    if (ping.type !== 'health.ping') throw new Error('expected a ping')
    client.send({ protocolVersion: 1, messageId: randomUUID(), type: 'health.pong', timestamp: Date.now(), payload: {} })

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(client.socket.readyState).toBe(WebSocket.OPEN)
  })

  it('closes a peer that stops answering', async () => {
    const h = await startBridge({ heartbeatIntervalMs: 20 })
    const client = await connectReady(h.port)
    await handshake(client)
    const closed = await client.closed
    expect(closed.code).toBe(4409)
    const disconnected = await waitForLog(h, 'bridge.peer.disconnected')
    expect(disconnected.code).toBe(4409)
    expect(disconnected.detachedLeases).toBe(0)
  })
})

describe('leases', () => {
  it('mints a lease with a finite TTL, visible escape and a mock marking', async () => {
    const h = await startBridge({}, { triggerActiveMs: 50, leaseTtlMs: 1000 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.send(tick({ activeMs: 60, seq: 1 }))

    const request = await client.waitFor('intervention.request')
    if (request.type !== 'intervention.request') throw new Error('expected a request')
    const { lease, copy, demoMode } = request.payload
    expect(lease.ttlMs).toBe(1000)
    expect(lease.expiresAt).toBeGreaterThan(lease.ttlMs)
    expect(lease.scope.documentId).toBe(validInbound.tick.context.documentId)
    expect(lease.kind).toBe('bubble')
    expect(lease.escapeLabel.length).toBeGreaterThan(0)
    expect(lease.reason).toContain('stand-in handler')
    expect(copy.source).toBe('mock')
    expect(demoMode).toBe(true)
    expect(h.bridge.leases()).toHaveLength(1)
    expect(h.logs.find(record => record.event === 'bridge.intervention.requested')?.handler).toBe('mock')
  })

  it('releases the lease when the TTL elapses, and re-arms', async () => {
    const h = await startBridge({}, { triggerActiveMs: 50, leaseTtlMs: 1000 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.send(tick({ activeMs: 60, seq: 1 }))
    await client.waitFor('intervention.request')

    const release = await client.waitFor('intervention.release', 3000)
    if (release.type !== 'intervention.release') throw new Error('expected a release')
    expect(release.payload.reason).toBe('ttl_elapsed')
    expect(h.bridge.leases()).toHaveLength(0)
    expect(h.mock.stats().completedCycles).toBe(1)

    // The loop is live: the next qualifying tick trips the gate again.
    client.send(tick({ activeMs: 60, seq: 2 }))
    const second = await client.waitFor('intervention.request')
    if (second.type !== 'intervention.request') throw new Error('expected a second request')
    expect(second.payload.lease.leaseId).not.toBe(release.payload.leaseId)
  })

  it('refuses a TTL outside the product cap', async () => {
    const h = await startBridge({}, { triggerActiveMs: 10, leaseTtlMs: 10 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.send(tick({ activeMs: 60, seq: 1 }))

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(client.received.some(message => message.type === 'intervention.request')).toBe(false)
    expect(h.logs.some(record => record.event === 'bridge.signal.dropped' && record.reason === 'ttl_out_of_range')).toBe(true)
  })

  it('resyncs a returning worker through welcome.activeLeases', async () => {
    const h = await startBridge({}, { triggerActiveMs: 50, leaseTtlMs: 2000, })
    const first = await connectReady(h.port)
    await handshake(first)
    first.send(tick({ activeMs: 60, seq: 1 }))
    await first.waitFor('intervention.request')
    const leaseId = h.bridge.leases()[0]?.leaseId

    // The service worker dies. The lease is deliberately kept so the surface can reconcile.
    first.socket.terminate()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(h.bridge.leases()).toHaveLength(1)

    const second = await connectReady(h.port)
    const welcome = await handshake(second)
    if (welcome.type !== 'welcome') throw new Error('expected welcome')
    expect(welcome.payload.activeLeases.map(lease => lease.leaseId)).toEqual([leaseId])
    second.close()
  })

  it('releases every lease on stop', async () => {
    const h = await startBridge({}, { triggerActiveMs: 50, leaseTtlMs: 3000 })
    const client = await connectReady(h.port)
    await handshake(client)
    client.send(tick({ activeMs: 60, seq: 1 }))
    await client.waitFor('intervention.request')

    await h.bridge.stop()
    expect(h.bridge.leases()).toHaveLength(0)
    expect(h.logs.find(record => record.event === 'bridge.stopped')?.releasedLeases).toBe(1)
  })
})

describe('transport hygiene', () => {
  it('reports the port it actually bound', async () => {
    const h = await startBridge()
    expect(h.port).toBeGreaterThan(0)
    expect(h.bridge.status().port).toBe(h.port)
  })

  it('reports a port collision instead of failing silently', async () => {
    const first = await startBridge()
    const second = createBridge({
      port: first.port,
      host: HOST,
      security: 'dev-open',
      handler: createMockHandler(),
      log: () => {}
    })
    const status = await second.start()
    expect(status.phase).toBe('port-in-use')
    expect(status.detail).toContain(String(first.port))
    await second.stop()

    // The failed server released the handle, so a retry on the same port succeeds.
    const retry = await first.bridge.start()
    expect(retry.phase).toBe('listening')
  })

  it('refuses to start in paired mode without a token', async () => {
    const bridge = createBridge({
      port: 0,
      host: HOST,
      security: 'paired',
      handler: createMockHandler(),
      log: () => {}
    })
    const status = await bridge.start()
    expect(status.phase).toBe('failed')
    await bridge.stop()
  })

  it('replaces an older connection instead of serving two', async () => {
    const h = await startBridge()
    const first = await connectReady(h.port)
    await handshake(first)
    const second = await connectReady(h.port)
    await handshake(second)

    expect((await first.closed).code).toBe(4410)
    expect(h.bridge.status().peer?.connectionId).not.toBeUndefined()
    second.close()
  })
})
