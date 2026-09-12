/**
 * Wire constants for the extension ↔ kernel bridge.
 *
 * Owning document: `docs/protocol.md` §1. Every value here is part of the contract a
 * separate implementer builds against, so changing one is a protocol change, not a
 * tuning knob. This module has no runtime dependency on Electron, Chrome or Node APIs:
 * it is imported by the kernel side and by the extension build.
 */

/**
 * Protocol major version, carried both by the envelope and by `hello` / `welcome`.
 * Additive optional fields do not bump it; a framing or required-semantics change does.
 */
export const PROTOCOL_VERSION = 1

/**
 * The single fixed default bridge port (`docs/protocol.md` §1.4). Chosen from the IANA
 * dynamic range (49152–65535) so it cannot collide with a well-known service. Overridable
 * on both sides; there is no scanning and no fallback to a port the extension cannot find.
 */
export const BRIDGE_DEFAULT_PORT = 54321

/** Loopback only. `docs/protocol.md` §1: bind `127.0.0.1`, never `0.0.0.0`. */
export const BRIDGE_HOST = '127.0.0.1'

/** Largest accepted inbound frame, in bytes. Oversized frames close the socket. */
export const BRIDGE_MAX_MESSAGE_BYTES = 64 * 1024

/** A connection that has not completed the handshake inside this window is closed. */
export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * Cadence of the kernel's `health.ping`. `docs/engineering.md` §3 requires bridge idle
 * traffic to be limited to the heartbeat.
 */
export const BRIDGE_HEARTBEAT_INTERVAL_MS = 15_000

/** Inbound budget: burst capacity, then a sustained refill. */
export const BRIDGE_RATE_LIMIT_CAPACITY = 60
export const BRIDGE_RATE_LIMIT_REFILL_PER_SECOND = 20

/**
 * Consecutive post-handshake violations before the socket is closed. Mirrors
 * `docs/packs.md` §9: repeated malformed input stops being tolerated.
 */
export const BRIDGE_MAX_VIOLATIONS = 10

/** `welcome.leaseDefaults`. The cap is `docs/architecture.md` §7. */
export const LEASE_MIN_TTL_MS = 1_000
export const LEASE_DEFAULT_TTL_MS = 60_000
export const LEASE_MAX_TTL_MS = 300_000

/** Upper bound on a single `session.tick` increment; a tick covers at most a minute. */
export const MAX_TICK_MS = 60_000

/**
 * Application close codes (RFC 6455 §7.4.2 reserves 3000–4999). A close code is only a
 * hint; the readable refusal is the `reject` message, or the structured log line.
 */
export const BRIDGE_CLOSE = {
  malformed: 4400,
  handshakeTimeout: 4401,
  forbidden: 4403,
  rateLimited: 4408,
  healthTimeout: 4409,
  replacedByNewPeer: 4410,
  protocolViolation: 4411
} as const

/** Default BCP-47 tag for kernel-produced plain language. */
export const DEFAULT_TONE_LOCALE = 'vi'
