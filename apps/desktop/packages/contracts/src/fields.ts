import { z } from 'zod'

/** Protocol major version, carried by the envelope and by `hello` / `welcome`. */
export const protocolVersionField = z.number().int().positive()

/** `docs/protocol.md` §1.1: a UUID, unique per message. Duplicates are ignored. */
export const messageIdField = z.uuid()

/**
 * UTC epoch milliseconds. The clock is the sender's; `docs/protocol.md` §4 still lists
 * clock agreement as unresolved, so the kernel never derives durations from this field —
 * it uses it for ordering and logging only.
 */
export const timestampField = z.number().int().nonnegative()

/**
 * A lowercase host with at least one dot, and nothing else: no scheme, no path, no query,
 * no port. `docs/browser-pack.md` §1 forbids sending URLs with query strings, and
 * `docs/architecture.md` §3 treats anything from the page as untrusted. Validating the
 * shape here is what keeps a lazy adapter from smuggling a full URL through `site`.
 */
export const siteSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/)

/** An adapter-defined lowercase token describing the kind of page, e.g. `checkout`. */
export const pageTypeSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)

/** Reverse-DNS-ish pack namespace: `hp.deep-work` (`docs/packs.md` §3). */
export const packIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/)

/** A pack's signal name, as declared in its manifest `signals[].id`. */
export const signalNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/)

/** An id from a pack's `actions:` or `rules:` list. */
export const resourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)

/** BCP-47 language tag, e.g. `vi`. */
export const localeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
