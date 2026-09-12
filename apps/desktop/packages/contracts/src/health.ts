import { z } from 'zod'
import { envelopeContextSchema, envelopeFields } from './envelope'

/**
 * Heartbeat. `docs/architecture.md` §5 gives `health.ping` / `health.pong` the direction
 * "both": either side may probe, and the peer must answer. It is the only traffic allowed
 * while the bridge is idle (`docs/engineering.md` §3).
 *
 * The payload is intentionally empty. Correlation, retry counts and backoff remain open
 * (`docs/protocol.md` §4); inventing them here would settle a contract by accident.
 */
export const healthPayloadSchema = z.object({}).strict()

export const healthPingMessageSchema = z
  .object({
    ...envelopeFields,
    type: z.literal('health.ping'),
    context: envelopeContextSchema.optional(),
    payload: healthPayloadSchema
  })
  .strict()

export const healthPongMessageSchema = z
  .object({
    ...envelopeFields,
    type: z.literal('health.pong'),
    context: envelopeContextSchema.optional(),
    payload: healthPayloadSchema
  })
  .strict()

export type HealthPingMessage = z.infer<typeof healthPingMessageSchema>
export type HealthPongMessage = z.infer<typeof healthPongMessageSchema>
