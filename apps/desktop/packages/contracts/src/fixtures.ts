import type { DeclaredSensor } from './signals'
import type { HealthPingMessage, HealthPongMessage } from './health'
import type { HelloMessage, SignalMessage } from './inbound'
import type {
  InterventionReleaseMessage,
  InterventionRequestMessage,
  RejectMessage,
  RejectReason,
  WelcomeMessage
} from './outbound'

/**
 * Cross-boundary fixtures (`docs/engineering.md` §1: "Shared contracts MUST have
 * cross-boundary fixtures so main, renderer and extension validate the same payloads").
 *
 * These are deliberately keyed to a placeholder pack (`hp.example` on `example.com`), not
 * to a reference pack. `docs/architecture.md` §8 invariant 1 extends its domain-agnostic
 * grep to this package, so no real site or pack name may appear here.
 *
 * `valid*` entries are typed as the message unions: a schema change breaks the build rather
 * than letting a fixture drift. `invalidInbound` carries the refusal reason the kernel is
 * required to give, which is what makes an extension's error path testable.
 */

export const EXAMPLE_SENSOR: DeclaredSensor = {
  packId: 'hp.example',
  name: 'session.tick',
  schema: 'signal.session.tick@1',
  sites: ['example.com']
}

const MESSAGE_IDS = {
  hello: '11111111-1111-4111-8111-111111111111',
  tick: '22222222-2222-4222-8222-222222222222',
  healthPing: '33333333-3333-4333-8333-333333333333',
  healthPong: '44444444-4444-4444-8444-444444444444',
  welcome: '55555555-5555-4555-8555-555555555555',
  reject: '66666666-6666-4666-8666-666666666666',
  request: '77777777-7777-4777-8777-777777777777',
  release: '88888888-8888-4888-8888-888888888888',
  lease: '99999999-9999-4999-8999-999999999999'
} as const

export const SAMPLE_TIMESTAMP = 1730000000000

export const validInbound: {
  hello: HelloMessage
  tick: SignalMessage
  healthPing: HealthPingMessage
  healthPong: HealthPongMessage
} = {
  hello: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.hello,
    type: 'hello',
    timestamp: SAMPLE_TIMESTAMP,
    payload: {
      protocolVersion: 1,
      extensionVersion: '0.1.0',
      token: 'placeholder-token-not-a-real-secret',
      sensors: [EXAMPLE_SENSOR],
      capabilities: ['surface.bubble']
    }
  },
  tick: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.tick,
    type: 'signal.hp.example.session.tick',
    timestamp: SAMPLE_TIMESTAMP,
    context: { tabId: 12, documentId: 'document-1', windowFocused: true },
    payload: {
      activeMs: 1000,
      seq: 1,
      active: true,
      visible: true,
      idle: false,
      site: 'example.com',
      pageType: 'feed'
    }
  },
  healthPing: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.healthPing,
    type: 'health.ping',
    timestamp: SAMPLE_TIMESTAMP,
    payload: {}
  },
  healthPong: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.healthPong,
    type: 'health.pong',
    timestamp: SAMPLE_TIMESTAMP,
    payload: {}
  }
}

export const validOutbound: {
  welcome: WelcomeMessage
  reject: RejectMessage
  interventionRequest: InterventionRequestMessage
  interventionRelease: InterventionReleaseMessage
} = {
  welcome: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.welcome,
    type: 'welcome',
    timestamp: SAMPLE_TIMESTAMP,
    payload: {
      protocolVersion: 1,
      leaseDefaults: { minTtlMs: 1000, defaultTtlMs: 60000, maxTtlMs: 300000 },
      toneLocale: 'vi',
      activeLeases: []
    }
  },
  reject: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.reject,
    type: 'reject',
    timestamp: SAMPLE_TIMESTAMP,
    payload: {
      reason: 'version_mismatch',
      detail: 'Extension speaks protocol 2, app expects protocol 1 — update one of them.',
      expectedProtocolVersion: 1,
      receivedProtocolVersion: 2
    }
  },
  interventionRequest: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.request,
    type: 'intervention.request',
    timestamp: SAMPLE_TIMESTAMP,
    context: { tabId: 12, documentId: 'document-1', windowFocused: true },
    payload: {
      lease: {
        leaseId: MESSAGE_IDS.lease,
        kind: 'bubble',
        ttlMs: 60000,
        expiresAt: SAMPLE_TIMESTAMP + 60000,
        scope: { tabId: 12, documentId: 'document-1' },
        packId: 'hp.example',
        ruleId: 'example-budget',
        escapeLabel: 'Placeholder escape label',
        reason: 'Placeholder reason from a fixture, not from the pet.'
      },
      copy: { text: 'Placeholder line from a fixture.', locale: 'vi', source: 'fallback' },
      demoMode: true
    }
  },
  interventionRelease: {
    protocolVersion: 1,
    messageId: MESSAGE_IDS.release,
    type: 'intervention.release',
    timestamp: SAMPLE_TIMESTAMP,
    context: { tabId: 12, documentId: 'document-1', windowFocused: true },
    payload: { leaseId: MESSAGE_IDS.lease, reason: 'ttl_elapsed' }
  }
}

/**
 * Envelope- and message-level refusals. These are the cases `parseInboundMessage` decides:
 * it validates the envelope and the message shape, but not a signal payload, because that
 * needs the sensors the connection declared in `hello`.
 */
export const invalidInbound: { name: string; input: unknown; reason: RejectReason }[] = [
  {
    name: 'protocol major mismatch',
    input: { ...validInbound.hello, protocolVersion: 2, payload: { ...validInbound.hello.payload, protocolVersion: 2 } },
    reason: 'version_mismatch'
  },
  {
    name: 'hello payload and envelope disagree on version',
    input: { ...validInbound.hello, payload: { ...validInbound.hello.payload, protocolVersion: 3 } },
    reason: 'version_mismatch'
  },
  { name: 'unknown message type', input: { ...validInbound.healthPing, type: 'policy.decision' }, reason: 'unsupported_type' },
  { name: 'not an object', input: 'hello', reason: 'malformed' },
  { name: 'missing messageId', input: { protocolVersion: 1, type: 'health.ping', timestamp: 1, payload: {} }, reason: 'malformed' },
  {
    name: 'messageId is not a uuid',
    input: { ...validInbound.healthPing, messageId: 'not-a-uuid' },
    reason: 'malformed'
  },
  {
    name: 'unknown envelope field',
    input: { ...validInbound.healthPing, pageText: 'must never be sent' },
    reason: 'malformed'
  },
  {
    name: 'signal without context',
    input: { protocolVersion: 1, messageId: MESSAGE_IDS.tick, type: 'signal.hp.example.session.tick', timestamp: 1, payload: {} },
    reason: 'malformed'
  },
  { name: 'hello without sensors', input: { ...validInbound.hello, payload: { ...validInbound.hello.payload, sensors: undefined } }, reason: 'malformed' },
  {
    name: 'health payload is not empty',
    input: { ...validInbound.healthPing, payload: { seq: 1 } },
    reason: 'malformed'
  }
]

/**
 * Payload-level refusals, decided by `parseSignalPayload` once the declaring sensor is
 * known. Kept separate because a signal payload is validated against the schema id the
 * sensor announced, which only exists after `hello`.
 */
export const invalidSignalPayloads: { name: string; schema: string; payload: unknown; reason: RejectReason }[] = [
  {
    name: 'schema the kernel does not implement',
    schema: 'signal.unknown.thing@1',
    payload: {},
    reason: 'unknown_schema'
  },
  { name: 'activeMs is not a number', schema: 'signal.session.tick@1', payload: { ...(validInbound.tick.payload as object), activeMs: 'lots' }, reason: 'malformed' },
  {
    name: 'site carries a full URL with a query string',
    schema: 'signal.session.tick@1',
    payload: { ...(validInbound.tick.payload as object), site: 'https://example.com/feed?q=1' },
    reason: 'malformed'
  },
  {
    name: 'activeMs exceeds one tick',
    schema: 'signal.session.tick@1',
    payload: { ...(validInbound.tick.payload as object), activeMs: 10 * 60 * 1000 },
    reason: 'malformed'
  },
  {
    name: 'payload repeats documentId from context',
    schema: 'signal.session.tick@1',
    payload: { ...(validInbound.tick.payload as object), documentId: 'document-1' },
    reason: 'malformed'
  }
]
