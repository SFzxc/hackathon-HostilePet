import { describe, expect, it } from 'vitest'
import { commandSchema, statusSchema } from './desktop'
describe('desktop IPC boundary', () => {
  it('rejects arbitrary privileged operations', () => {
    for (const value of ['read-file', 'execute', { command: 'quit' }, null]) {
      expect(commandSchema.safeParse(value).success).toBe(false)
    }
  })
  it('rejects fabricated connectivity and surplus data', () => {
    const bridge = { phase: 'listening', host: '127.0.0.1', port: 54321, security: 'dev-open', peer: null, activeLeases: 0, detail: null }
    const state = { petVisible: true, preview: 'idle', bridge, browser: 'no-pack-installed', handler: 'mock', agent: 'not-configured', character: 'placeholder' }
    expect(statusSchema.safeParse(state).success).toBe(true)
    // The shell may report a transport; it may never report observation, because nothing
    // observes anything yet.
    expect(statusSchema.safeParse({ ...state, browser: 'connected' }).success).toBe(false)
    expect(statusSchema.safeParse({ ...state, browser: 'observing' }).success).toBe(false)
    // The stub may not be relabelled as the thing that will replace it.
    expect(statusSchema.safeParse({ ...state, handler: 'policy' }).success).toBe(false)
    // An attached extension is a peer object, never a bare "connected" flag that a window
    // could render as truth without saying who is attached.
    expect(statusSchema.safeParse({ ...state, bridge: { ...bridge, peer: 'connected' } }).success).toBe(false)
    expect(statusSchema.safeParse({ ...state, bridge: { ...bridge, peer: { extensionVersion: '0.1.0', origin: null, sensors: 0 } } }).success).toBe(true)
    // Surplus data is rejected rather than ignored: the renderer must not become a side
    // channel for anything the kernel did not decide to show it.
    expect(statusSchema.safeParse({ ...state, token: 'unexpected' }).success).toBe(false)
    expect(statusSchema.safeParse({ ...state, bridge: { ...bridge, url: 'https://example.com/feed?q=1' } }).success).toBe(false)
  })
})
