/**
 * `@hostile-pet/contracts` — the bridge wire format, in one place.
 *
 * Owning document: `docs/protocol.md` §1. Anything an extension implementer needs to agree
 * with the kernel on is here: the envelope, the inbound and outbound message catalogue, the
 * wire constants, and cross-boundary fixtures.
 *
 * This package is pure data and validation. It imports zod and nothing else — no Electron,
 * no Node APIs, no filesystem — so the same source can be bundled into the privileged main
 * process and into the extension build.
 */
export * from './constants'
export * from './envelope'
export * from './fields'
export * from './fixtures'
export * from './health'
export * from './inbound'
export * from './outbound'
export * from './parse'
export * from './result'
export * from './signals'
export * from './version'
