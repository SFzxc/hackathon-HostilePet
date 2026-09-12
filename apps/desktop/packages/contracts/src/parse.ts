import type { z } from 'zod'
import { envelopeSchema } from './envelope'
import { healthPingMessageSchema, healthPongMessageSchema } from './health'
import { helloMessageSchema, signalMessageSchema, type InboundMessage } from './inbound'
import {
  interventionReleaseMessageSchema,
  interventionRequestMessageSchema,
  rejectMessageSchema,
  type OutboundMessage,
  welcomeMessageSchema
} from './outbound'
import { isSignalType } from './signals'
import type { ParseResult } from './result'
import { describeIssues } from './result'
import { isSupportedProtocolVersion, protocolVersionMismatchDetail } from './version'

/**
 * One message schema per inbound type. `signal.*` is a family rather than a literal, so a
 * discriminated union cannot express it — the type string is routed explicitly and the
 * payload is checked against the declaring sensor's schema afterwards.
 */
function inboundSchemaFor(type: string): z.ZodType | null {
  if (type === 'hello') return helloMessageSchema
  if (type === 'health.ping') return healthPingMessageSchema
  if (type === 'health.pong') return healthPongMessageSchema
  if (isSignalType(type)) return signalMessageSchema
  return null
}

/** One schema per outbound type. `health.ping` / `health.pong` travel both ways. */
function outboundSchemaFor(type: string): z.ZodType | null {
  if (type === 'welcome') return welcomeMessageSchema
  if (type === 'reject') return rejectMessageSchema
  if (type === 'intervention.request') return interventionRequestMessageSchema
  if (type === 'intervention.release') return interventionReleaseMessageSchema
  if (type === 'health.ping') return healthPingMessageSchema
  if (type === 'health.pong') return healthPongMessageSchema
  return null
}

/**
 * Validate one inbound frame. Order matters and is part of the contract:
 *
 * 1. envelope shape → `malformed`
 * 2. protocol major version → `version_mismatch`, with a line a person can act on
 * 3. message type → `unsupported_type`
 * 4. message schema → `malformed`
 * 5. `hello`'s duplicated `protocolVersion` → `version_mismatch`
 *
 * Version is checked before the message schema so an extension speaking a future protocol
 * is told precisely that, instead of being handed a field-level complaint about a shape it
 * was right to change.
 */
export function parseInboundMessage(input: unknown): ParseResult<InboundMessage> {
  const envelope = envelopeSchema.safeParse(input)
  if (!envelope.success) {
    return { ok: false, reason: 'malformed', detail: describeIssues(envelope.error) }
  }
  const { type, protocolVersion } = envelope.data
  if (!isSupportedProtocolVersion(protocolVersion)) {
    return { ok: false, reason: 'version_mismatch', detail: protocolVersionMismatchDetail(protocolVersion) }
  }
  const schema = inboundSchemaFor(type)
  if (!schema) {
    return { ok: false, reason: 'unsupported_type', detail: `unknown message type: ${type}` }
  }
  const message = schema.safeParse(input)
  if (!message.success) {
    return { ok: false, reason: 'malformed', detail: describeIssues(message.error) }
  }
  const value = message.data as InboundMessage
  if (value.type === 'hello') {
    // Re-parsed against the hello schema rather than cast: `signal.*` has a free-form type
    // string, so the union cannot be narrowed by discriminant alone.
    const hello = helloMessageSchema.safeParse(value)
    if (hello.success && hello.data.payload.protocolVersion !== protocolVersion) {
      return {
        ok: false,
        reason: 'version_mismatch',
        detail: `hello payload declares protocol ${hello.data.payload.protocolVersion} but the envelope declares ${protocolVersion}; they must agree.`
      }
    }
  }
  return { ok: true, value }
}

/**
 * Validate one outbound frame — the direction an extension implementer consumes, and the
 * one the kernel checks its own output against before sending.
 *
 * There is no `version_mismatch` here: the kernel only ever emits its own protocol version,
 * so a mismatch means the two sides disagree about which version is current, which the
 * extension detects on `welcome`.
 */
export function parseOutboundMessage(input: unknown): ParseResult<OutboundMessage> {
  const envelope = envelopeSchema.safeParse(input)
  if (!envelope.success) {
    return { ok: false, reason: 'malformed', detail: describeIssues(envelope.error) }
  }
  if (!isSupportedProtocolVersion(envelope.data.protocolVersion)) {
    return {
      ok: false,
      reason: 'version_mismatch',
      detail: protocolVersionMismatchDetail(envelope.data.protocolVersion)
    }
  }
  const { type } = envelope.data
  const schema = outboundSchemaFor(type)
  if (!schema) {
    return { ok: false, reason: 'unsupported_type', detail: `unknown message type: ${type}` }
  }
  const message = schema.safeParse(input)
  if (!message.success) {
    return { ok: false, reason: 'malformed', detail: describeIssues(message.error) }
  }
  return { ok: true, value: message.data as OutboundMessage }
}
