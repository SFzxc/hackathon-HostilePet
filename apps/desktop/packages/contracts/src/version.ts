import { PROTOCOL_VERSION } from './constants'

/**
 * `protocolVersion` is a positive integer major version. There is no minor component yet:
 * an additive optional field does not need one, and a required change bumps the major.
 * A mismatch is an explicit refusal, never a silent degrade (`docs/protocol.md` §1.3).
 */
export function isSupportedProtocolVersion(value: number): boolean {
  return value === PROTOCOL_VERSION
}

/**
 * The human-readable mismatch line required by `docs/protocol.md` §1.3: readable enough
 * that a person can act on it without the source. Plain language, no jargon.
 */
export function protocolVersionMismatchDetail(received: number): string {
  return `Extension speaks protocol ${received}, app expects protocol ${PROTOCOL_VERSION} — update one of them.`
}
