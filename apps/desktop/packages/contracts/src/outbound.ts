import { z } from 'zod'
import { LEASE_DEFAULT_TTL_MS, LEASE_MAX_TTL_MS, LEASE_MIN_TTL_MS, PROTOCOL_VERSION } from './constants'
import { envelopeContextSchema } from './envelope'
import { localeSchema, messageIdField, packIdSchema, resourceIdSchema, timestampField } from './fields'
import { healthPingMessageSchema, healthPongMessageSchema, type HealthPingMessage, type HealthPongMessage } from './health'

/**
 * Why the kernel refused a connection (`docs/protocol.md` §1.3).
 *
 * `bad_token`, `origin_not_paired`, `version_mismatch` and `rate_limited` are the four
 * codes the protocol names. `malformed`, `unsupported_type`, `unknown_schema`,
 * `protocol_violation` and `handshake_timeout` are additive v1 codes introduced with this
 * catalogue: without them a developer whose JSON is broken, whose sensor declares a schema
 * the kernel cannot read, who sends a signal before `hello`, or who never says `hello` at
 * all gets silence instead of a readable refusal — which `docs/protocol.md` §5 forbids.
 *
 * The enum may grow additively inside protocol 1. A client MUST treat an unrecognised
 * reason as a refusal and display `detail` unchanged.
 */
export const rejectReasonSchema = z.enum([
  'bad_token',
  'origin_not_paired',
  'version_mismatch',
  'rate_limited',
  'malformed',
  'unsupported_type',
  'unknown_schema',
  'protocol_violation',
  'handshake_timeout'
])

export type RejectReason = z.infer<typeof rejectReasonSchema>

/** Plain-language escape affordance, always visible and always clickable. */
export const escapeLabelSchema = z.string().min(1).max(60)

/**
 * The line the surface renders, produced by the kernel — never by the extension and never
 * by the page. `source` records where it came from so the activity log can be honest about
 * a fallback (`docs/tone.md` §6).
 *
 * `mock` exists so a stubbed handler can be visibly identified as a stub on screen
 * (`docs/hackathon.md` §4). It is not a valid source in a shipped build.
 */
export const copySchema = z
  .object({
    text: z.string().min(1).max(160),
    locale: localeSchema,
    source: z.enum(['model', 'fallback', 'mock'])
  })
  .strict()

export const interventionKindSchema = z.enum(['bubble', 'overlay', 'grayscale'])

export type InterventionKind = z.infer<typeof interventionKindSchema>

/** Page identity a lease is scoped to. A `documentId` change releases the lease. */
export const leaseScopeSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(128)
  })
  .strict()

/**
 * A lease, as `docs/architecture.md` §7 enumerates it, plus the pieces a surface needs to
 * render without asking again.
 *
 * `expiresAt` is absolute and kernel-computed: the extension MUST NOT extend it, recompute
 * it, or treat a retry as a renewal. Renewal semantics are still open
 * (`docs/protocol.md` §4), so there is deliberately no renewal message.
 */
export const leaseSchema = z
  .object({
    leaseId: z.uuid(),
    kind: interventionKindSchema,
    ttlMs: z.number().int().min(LEASE_MIN_TTL_MS).max(LEASE_MAX_TTL_MS),
    expiresAt: timestampField,
    scope: leaseScopeSchema,
    packId: packIdSchema,
    ruleId: resourceIdSchema,
    escapeLabel: escapeLabelSchema,
    reason: z.string().min(1).max(200)
  })
  .strict()

export type Lease = z.infer<typeof leaseSchema>
export type LeaseScope = z.infer<typeof leaseScopeSchema>
export type Copy = z.infer<typeof copySchema>

/** Lease bounds the kernel announces, so the extension knows what to expect. */
export const leaseDefaultsSchema = z
  .object({
    minTtlMs: z.number().int().positive(),
    defaultTtlMs: z.number().int().positive(),
    maxTtlMs: z.number().int().positive()
  })
  .strict()

export const welcomePayloadSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    leaseDefaults: leaseDefaultsSchema,
    toneLocale: localeSchema,
    /**
     * `docs/protocol.md` §1.3: this is how the extension resyncs after an MV3
     * service-worker restart. The kernel is the source of truth; the worker is not.
     */
    activeLeases: z.array(leaseSchema).max(64)
  })
  .strict()

export const welcomeMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    messageId: messageIdField,
    timestamp: timestampField,
    type: z.literal('welcome'),
    payload: welcomePayloadSchema
  })
  .strict()

export const rejectPayloadSchema = z
  .object({
    reason: rejectReasonSchema,
    /** Readable line a developer can act on. Safe to log and to display. */
    detail: z.string().min(1).max(400),
    expectedProtocolVersion: z.number().int().positive().optional(),
    receivedProtocolVersion: z.number().int().positive().optional(),
    retryAfterMs: z.number().int().positive().optional()
  })
  .strict()

export const rejectMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    messageId: messageIdField,
    timestamp: timestampField,
    type: z.literal('reject'),
    payload: rejectPayloadSchema
  })
  .strict()

/**
 * `docs/architecture.md` §5 lists `{kind, leaseId, ttlMs, copy, escapeLabel}` for this
 * message and omits the scope, the causation ids and the demo flag. The lease is carried
 * whole instead, so a surface renders from one object and the activity log has real
 * `packId` / `ruleId` for every effect (`AGENTS.md` working rule 5).
 */
export const interventionRequestPayloadSchema = z
  .object({
    lease: leaseSchema,
    copy: copySchema,
    /**
     * `docs/browser-pack.md` §2 and `docs/hackathon.md` §4 require a visible badge
     * wherever a threshold was artificially lowered. A surface cannot know that on its
     * own, so the kernel says so explicitly.
     */
    demoMode: z.boolean()
  })
  .strict()

export const interventionRequestMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    messageId: messageIdField,
    timestamp: timestampField,
    type: z.literal('intervention.request'),
    context: envelopeContextSchema,
    payload: interventionRequestPayloadSchema
  })
  .strict()

/**
 * Release reasons are exactly the triggers `docs/architecture.md` §7 lists, so a released
 * lease can always be explained. `user_override` is unreachable until
 * `docs/protocol.md` §4 settles local escape acknowledgment: today the extension has no
 * message that tells the kernel the user pressed the escape.
 */
export const releaseReasonSchema = z.enum([
  'ttl_elapsed',
  'user_override',
  'navigation',
  'disconnect',
  'pause',
  'quit',
  'pack_disabled',
  'day_rollover',
  'replaced_by_new_peer'
])

export const interventionReleaseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    messageId: messageIdField,
    timestamp: timestampField,
    type: z.literal('intervention.release'),
    /**
     * Deliberately optional, unlike `intervention.request`: `leaseId` is the identity of the
     * thing being torn down. A release can be caused by a navigation that has already
     * replaced the page the lease was scoped to, so echoing a page identity back would be
     * stale at best and misleading at worst.
     */
    context: envelopeContextSchema.optional(),
    payload: z
      .object({
        leaseId: z.uuid(),
        reason: releaseReasonSchema
      })
      .strict()
  })
  .strict()

export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>
export type RejectMessage = z.infer<typeof rejectMessageSchema>
export type InterventionRequestMessage = z.infer<typeof interventionRequestMessageSchema>
export type InterventionReleaseMessage = z.infer<typeof interventionReleaseMessageSchema>
export type ReleaseReason = z.infer<typeof releaseReasonSchema>

/** Kernel-provided lease bounds, used to fill `welcome`. */
export const defaultLeaseDefaults = {
  minTtlMs: LEASE_MIN_TTL_MS,
  defaultTtlMs: LEASE_DEFAULT_TTL_MS,
  maxTtlMs: LEASE_MAX_TTL_MS
} as const

/**
 * Everything the kernel may send. Heartbeat messages travel both ways, so they are part of
 * both directions' catalogues — an extension validating kernel output must accept them.
 */
export const outboundMessageSchema = z.union([
  welcomeMessageSchema,
  rejectMessageSchema,
  interventionRequestMessageSchema,
  interventionReleaseMessageSchema,
  healthPingMessageSchema,
  healthPongMessageSchema
])

export type OutboundMessage =
  | WelcomeMessage
  | RejectMessage
  | InterventionRequestMessage
  | InterventionReleaseMessage
  | HealthPingMessage
  | HealthPongMessage
