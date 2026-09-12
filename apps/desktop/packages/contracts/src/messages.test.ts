import { describe, expect, it } from 'vitest'
import {
  composeSignalType,
  findDeclaredSensor,
  invalidInbound,
  invalidSignalPayloads,
  outboundMessageSchema,
  parseInboundMessage,
  parseSignalPayload,
  signalTypeSchema,
  validInbound,
  validOutbound,
  type DeclaredSensor
} from './index'

const sensors: DeclaredSensor[] = [...validInbound.hello.payload.sensors]

describe('inbound fixtures', () => {
  for (const [name, message] of Object.entries(validInbound)) {
    it(`accepts the ${name} fixture`, () => {
      const result = parseInboundMessage(message)
      expect(result.ok, result.ok ? '' : `${result.reason}: ${result.detail}`).toBe(true)
    })
  }
})

describe('refusals', () => {
  for (const fixture of invalidInbound) {
    it(`refuses ${fixture.name} with ${fixture.reason}`, () => {
      const result = parseInboundMessage(fixture.input)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe(fixture.reason)
        expect(result.detail.length).toBeGreaterThan(0)
      }
    })
  }

  for (const fixture of invalidSignalPayloads) {
    it(`refuses a signal payload where ${fixture.name} with ${fixture.reason}`, () => {
      const result = parseSignalPayload(fixture.schema, fixture.payload)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe(fixture.reason)
    })
  }

  it('never echoes a received value into the detail', () => {
    const result = parseSignalPayload('signal.session.tick@1', { activeMs: 'secret-page-text' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).not.toContain('secret-page-text')
  })

  it('leaves signal payload validation to the second stage', () => {
    // Documented boundary: the envelope/message stage cannot judge a payload, because the
    // schema id comes from the sensor the connection declared in `hello`. The bridge MUST
    // run `parseSignalPayload` before handing a tick to any rule.
    const result = parseInboundMessage({ ...validInbound.tick, payload: { nonsense: true } })
    expect(result.ok).toBe(true)
  })
})

describe('outbound fixtures', () => {
  for (const [name, message] of Object.entries(validOutbound)) {
    it(`accepts the ${name} fixture`, () => {
      const result = outboundMessageSchema.safeParse(message)
      expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true)
    })
  }

  it('rejects an outbound message carrying an undeclared field', () => {
    const welcome = validOutbound.welcome as Record<string, unknown>
    expect(outboundMessageSchema.safeParse({ ...welcome, surprise: true }).success).toBe(false)
  })
})

describe('signal routing', () => {
  it('resolves a dotted pack id by exact match rather than by splitting', () => {
    const type = validInbound.tick.type
    expect(findDeclaredSensor(sensors, type)).toEqual(validInbound.hello.payload.sensors[0])
    expect(composeSignalType('hp.example', 'session.tick')).toBe(type)
  })

  it('does not resolve a signal nobody declared', () => {
    expect(findDeclaredSensor(sensors, 'signal.hp.other.session.tick')).toBeUndefined()
  })

  it('accepts the real tick payload schema id', () => {
    const result = parseSignalPayload('signal.session.tick@1', validInbound.tick.payload)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.data.activeMs).toBe(1000)
  })

  it('rejects malformed signal type strings', () => {
    for (const value of ['signal.', 'signal.hp', 'signal.hp.', 'Signal.hp.a', 'policy.decision']) {
      expect(signalTypeSchema.safeParse(value).success, value).toBe(false)
    }
  })
})
