import { z } from 'zod'
import { envelopeContextSchema, envelopeFields } from './envelope'
import { protocolVersionField } from './fields'
import { healthPingMessageSchema, healthPongMessageSchema } from './health'
import { declaredSensorSchema, signalTypeSchema } from './signals'

/**
 * `hello` — the extension's opening statement (`docs/protocol.md` §1.3).
 *
 * `protocolVersion` appears in the envelope *and* here, because the protocol table requires
 * it in both. Rather than leave two sources of truth, they MUST agree: the kernel refuses
 * the pair with `version_mismatch` when they do not.
 *
 * `sensors[]` is what lets the UI mark dependent rules available or unavailable, and what
 * the kernel resolves a `signal.*` message against. Signals not declared here are refused
 * at the bridge, before they reach any rule.
 */
export const helloPayloadSchema = z
  .object({
    protocolVersion: protocolVersionField,
    /** The extension's own version string, for the activity log. Display only. */
    extensionVersion: z.string().min(1).max(32),
    /**
     * The pairing token (`docs/protocol.md` §1.2). Optional only while the bridge runs in
     * its explicit local development mode; a build that requires pairing will refuse a
     * `hello` without it. The field stays in the format so an extension implementer builds
     * the right thing once.
     */
    token: z.string().min(1).max(512).optional(),
    sensors: z.array(declaredSensorSchema).max(32),
    /**
     * What this extension can render and observe, e.g. `surface.bubble`.
     *
     * Informational in protocol 1: the capability catalogue lives in `packages/pack-sdk`,
     * which does not exist yet, so an unknown id is logged rather than refused
     * (`docs/protocol.md` §1.7). When the catalogue lands, unknown ids become a rejection.
     */
    capabilities: z.array(z.string().min(1).max(64)).max(32)
  })
  .strict()

export const helloMessageSchema = z
  .object({
    ...envelopeFields,
    type: z.literal('hello'),
    context: envelopeContextSchema.optional(),
    payload: helloPayloadSchema
  })
  .strict()

/**
 * A sensor reading. The payload is validated separately, against the schema id the
 * declaring sensor announced in `hello` — see `parseSignalPayload`.
 */
export const signalMessageSchema = z
  .object({
    ...envelopeFields,
    type: signalTypeSchema,
    context: envelopeContextSchema,
    payload: z.unknown()
  })
  .strict()

export type HelloMessage = z.infer<typeof helloMessageSchema>
export type SignalMessage = z.infer<typeof signalMessageSchema>

export const inboundMessageSchema = z.union([
  helloMessageSchema,
  signalMessageSchema,
  healthPingMessageSchema,
  healthPongMessageSchema
])

export type InboundMessage =
  | HelloMessage
  | SignalMessage
  | z.infer<typeof healthPingMessageSchema>
  | z.infer<typeof healthPongMessageSchema>
