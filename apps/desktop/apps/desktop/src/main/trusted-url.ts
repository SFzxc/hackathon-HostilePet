export function isTrustedURL(candidate: string, expected: string): boolean {
  try {
    const actual = new URL(candidate)
    const allowed = new URL(expected)
    actual.hash = ''
    allowed.hash = ''
    return actual.href === allowed.href
  } catch { return false }
}
