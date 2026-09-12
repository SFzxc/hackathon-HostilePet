import { z } from 'zod'
import { MAX_TICK_MS } from './constants'
import { packIdSchema, pageTypeSchema, signalNameSchema, siteSchema } from './fields'
import type { ParseResult } from './result'
import { describeIssues } from './result'

/**
 * Signal message `type` is `signal.<packId>.<name>` (`docs/architecture.md` §5,
 * `docs/engineering.md` §2). `packId` may itself contain dots (`hp.deep-work`), so the
 * kernel never splits the string: it resolves `packId` and `name` by exact match against
 * the sensors the extension declared in `hello`.
 */
export const signalTypeSchema = z
  .string()
  .min(10)
  .max(160)
  .regex(/^signal\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/)

export function composeSignalType(packId: string, name: string): string {
  return `signal.${packId}.${name}`
}

export function isSignalType(type: string): boolean {
  return signalTypeSchema.safeParse(type).success
}

/**
 * `signal.session.tick@1` — observed-time increments for one page.
 *
 * Semantics decided in `docs/protocol.md` §1.7 (previously open in §4):
 *
 * - `activeMs` is an **increment**, not a cumulative session total. The kernel owns
 *   accrual, so a semi-trusted transport can never dictate a counter value.
 * - `seq` is strictly increasing per `(connection, documentId, signal)`. A tick whose
 *   `seq` is not greater than the last accepted one is a replay and is dropped, which is
 *   what makes a retry safe (`docs/protocol.md` §1.1).
 * - `activeMs` covers qualifying observed time only. `docs/architecture.md` §6 forbids
 *   counting sleeping, disconnected or unfocused time.
 * - The three qualification inputs the kernel needs are split by authority:
 *   `windowFocused` travels in `context`, while `active`, `visible` and `idle` describe
 *   the page inside the payload.
 */
export const sessionTickPayloadSchema = z
  .object({
    activeMs: z.number().int().min(0).max(MAX_TICK_MS),
    seq: z.number().int().nonnegative(),
    active: z.boolean(),
    visible: z.boolean(),
    idle: z.boolean(),
    site: siteSchema.optional(),
    pageType: pageTypeSchema.optional()
  })
  .strict()

export type SessionTick = z.infer<typeof sessionTickPayloadSchema>

/**
 * Payload schemas the kernel implements, keyed by the versioned schema id a pack declares
 * in its manifest (`docs/packs.md` §3: `"schema": "signal.session.tick@1"`).
 *
 * A sensor declaring anything absent from this table is refused at `hello` with
 * `unknown_schema`, so the extension learns immediately that the kernel cannot interpret
 * its signals instead of having every tick silently dropped.
 */
export const signalPayloadSchemas = {
  'signal.session.tick@1': sessionTickPayloadSchema
} as const

export type KnownSignalSchemaId = keyof typeof signalPayloadSchemas
export type SignalPayloadFor<K extends KnownSignalSchemaId> = z.infer<(typeof signalPayloadSchemas)[K]>

/** Validated signal payload, discriminated by the schema that produced it. */
export type SignalPayload = {
  [K in KnownSignalSchemaId]: { schema: K; data: SignalPayloadFor<K> }
}[KnownSignalSchemaId]

export const knownSignalSchemaIds = Object.keys(signalPayloadSchemas) as KnownSignalSchemaId[]

export function isKnownSignalSchemaId(value: string): value is KnownSignalSchemaId {
  return Object.hasOwn(signalPayloadSchemas, value)
}

export function parseSignalPayload(schemaId: string, payload: unknown): ParseResult<SignalPayload> {
  if (!isKnownSignalSchemaId(schemaId)) {
    return { ok: false, reason: 'unknown_schema', detail: `unsupported signal schema: ${schemaId}` }
  }
  const result = signalPayloadSchemas[schemaId].safeParse(payload)
  if (!result.success) {
    return { ok: false, reason: 'malformed', detail: describeIssues(result.error) }
  }
  // The table is keyed by schema id, so the parsed output is that schema's payload type.
  return { ok: true, value: { schema: schemaId, data: result.data } as SignalPayload }
}

/** A sensor the extension declares support for during `hello`. */
export const declaredSensorSchema = z
  .object({
    packId: packIdSchema,
    name: signalNameSchema,
    schema: z.string().min(1).max(64),
    /** Hosts this sensor will report on. Display/debug only; the kernel does not enforce. */
    sites: z.array(siteSchema).max(16).optional()
  })
  .strict()

export type DeclaredSensor = z.infer<typeof declaredSensorSchema>

/**
 * Resolve an inbound `signal.*` type to the sensor that declared it, by exact match.
 *
 * There is no string splitting: `hp.deep-work` is a legal pack id, so
 * `signal.hp.deep-work.session.tick` cannot be divided into pack and name by position.
 * The `hello` declaration is what makes the mapping unambiguous — and what lets the kernel
 * refuse a signal nobody declared.
 */
export function findDeclaredSensor(sensors: readonly DeclaredSensor[], type: string): DeclaredSensor | undefined {
  return sensors.find(sensor => composeSignalType(sensor.packId, sensor.name) === type)
}
