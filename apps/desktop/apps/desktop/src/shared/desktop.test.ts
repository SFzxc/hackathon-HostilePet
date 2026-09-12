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
    const focus = { known: true, active: false, modeName: null, source: null, detail: null, watch: 'fs.watch+poll', reason: null }
    const state = { petVisible: true, preview: 'idle', petExpression: 'idle', bridge, focus, browser: 'no-pack-installed', handler: 'mock', agent: 'not-configured', character: 'placeholder' }
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
  it('will not let an unread Focus database be rounded down to a value', () => {
    const base = { petVisible: true, preview: 'idle', browser: 'no-pack-installed', handler: 'mock', agent: 'not-configured', character: 'placeholder' }
    const bridge = { phase: 'stopped', host: '127.0.0.1', port: 54321, security: 'dev-open', peer: null, activeLeases: 0, detail: null }
    const unread = { known: false, active: null, modeName: null, source: null, detail: 'Assertions.json: permission denied by macOS', watch: 'poll', reason: 'permission' }
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: unread }).success).toBe(true)
    // The sensor could not read anything: claiming "off" would be an invented state.
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: { ...unread, active: false } }).success).toBe(false)
    // A detected mode must say what detected it, and may not outlive the mode.
    const on = { known: true, active: true, modeName: 'Work', source: 'assertion', detail: null, watch: 'fs.watch+poll', reason: null }
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: on }).success).toBe(true)
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: { ...on, source: null } }).success).toBe(false)
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: { ...on, active: false } }).success).toBe(false)
    // An unknown watch mode is rejected rather than displayed as if it meant something.
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'idle', focus: { ...on, watch: 'fast' } }).success).toBe(false)
    // The pet may not wear a Focus expression it did not read: this is what stops a database
    // the app cannot open from producing a convincingly sleepy pet.
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'sleeping', focus: on }).success).toBe(true)
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'sleeping', focus: unread }).success).toBe(false)
    expect(statusSchema.safeParse({ ...base, bridge, petExpression: 'focused', focus: { ...on, active: false } }).success).toBe(false)
  })
})
