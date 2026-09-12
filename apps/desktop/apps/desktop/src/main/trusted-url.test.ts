import { expect, it } from 'vitest'
import { isTrustedURL } from './trusted-url'
it('normalizes the development root while retaining exact origin and path checks', () => {
  expect(isTrustedURL('http://localhost:5173/#pet', 'http://localhost:5173')).toBe(true)
  for (const candidate of ['http://localhost:5174/#pet', 'http://localhost:5173/other', 'https://example.com', 'invalid']) {
    expect(isTrustedURL(candidate, 'http://localhost:5173')).toBe(false)
  }
})
it('accepts only the packaged entry file, with any surface hash', () => {
  expect(isTrustedURL('file:///app/index.html#settings', 'file:///app/index.html')).toBe(true)
  expect(isTrustedURL('file:///other/index.html', 'file:///app/index.html')).toBe(false)
})
