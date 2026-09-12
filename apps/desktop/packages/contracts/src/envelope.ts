import { z } from 'zod'
import { messageIdField, protocolVersionField, timestampField } from './fields'

/**
 * Routing identity for anything page-scoped. `docs/protocol.md` §1.1 requires commands to
 * carry tab + document identity so navigation cannot inherit a stale gate.
 *
 * `context` is authoritative: a signal payload MUST NOT repeat `tabId`, `documentId` or
 * `windowFocused` (`docs/protocol.md` §1.7). One location per fact, so two copies can
 * never disagree.
 */
export const envelopeContextSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(128),
    windowFocused: z.boolean()
  })
  .strict()

/**
 * The envelope every message shares (`docs/protocol.md` §1.1).
 *
 * Strict on purpose: an unknown envelope field is a rejection, not something to ignore.
 * `payload` is validated per message type afterwards.
 */
export const envelopeSchema = z
  .object({
    protocolVersion: protocolVersionField,
    messageId: messageIdField,
    type: z.string().min(1).max(160),
    timestamp: timestampField,
    context: envelopeContextSchema.optional(),
    payload: z.unknown()
  })
  .strict()

export type Envelope = z.infer<typeof envelopeSchema>

/** Envelope fields a message schema spreads into its own shape. */
export const envelopeFields = {
  protocolVersion: protocolVersionField,
  messageId: messageIdField,
  timestamp: timestampField
} as const
