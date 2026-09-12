import type { z } from 'zod'
import type { RejectReason } from './outbound'

/**
 * Result of validating anything arriving across the bridge. A failure carries a stable
 * wire `reason` (usable verbatim in a `reject`) plus developer detail.
 *
 * Detail contains zod issue paths and codes only — never the received values. Redaction
 * is a requirement, not a precaution: an inbound payload can carry page-derived data and
 * `docs/engineering.md` §2 forbids logging raw content.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RejectReason; detail: string }

/** Builds redacted developer detail from a zod error. */
export function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
  const suffix = error.issues.length > issues.length ? ` (+${error.issues.length - issues.length} more)` : ''
  return issues.join('; ') + suffix
}
