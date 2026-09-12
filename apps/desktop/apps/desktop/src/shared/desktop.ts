import { z } from 'zod'
export const commandSchema = z.enum(['show-pet', 'hide-pet', 'open-settings', 'quit', 'open-focus-permission', 'relaunch', 'dismiss-line'])
export type DesktopCommand = z.infer<typeof commandSchema>

/**
 * What the shell may honestly say about the bridge.
 *
 * `peer.sensors` is a count and not the declared sensors themselves: the renderer needs to
 * know whether the extension is connected, and `docs/architecture.md` §4 keeps pack data
 * behind the kernel boundary rather than in a window.
 */
export const bridgeStatusSchema = z.object({
  phase: z.enum(['stopped', 'listening', 'port-in-use', 'failed']),
  host: z.string(),
  port: z.number().int().nonnegative(),
  security: z.enum(['dev-open', 'paired']),
  peer: z.object({
    extensionVersion: z.string(),
    origin: z.string().nullable(),
    sensors: z.number().int().nonnegative()
  }).strict().nullable(),
  activeLeases: z.number().int().nonnegative(),
  /** Plain language, shown to a person, never parsed. */
  detail: z.string().nullable()
}).strict()
export type BridgeSnapshot = z.infer<typeof bridgeStatusSchema>

/**
 * What the shell may honestly say about the macOS Focus sensor.
 *
 * `known: false` means the database could not be read, which is a different claim from
 * "no Focus mode is on". The refinement below makes that structural rather than a matter
 * of discipline in the renderer: an unread state cannot carry a value, a value cannot
 * appear without saying how it was detected, and a name cannot outlive its mode.
 */
export const focusStatusSchema = z.object({
  known: z.boolean(),
  active: z.boolean().nullable(),
  modeName: z.string().nullable(),
  source: z.enum(['assertion', 'schedule']).nullable(),
  /** Plain language, shown to a person, never parsed. */
  detail: z.string().nullable(),
  /** `fs.watch+poll` is the fast path; `poll` means macOS refused the directory watch. */
  watch: z.enum(['fs.watch+poll', 'poll', 'stopped']),
  /**
   * Why there is no reading. Only `permission` may be offered a fix, because it is the one cause
   * the person in front of the screen can remove — a window that guessed would send them to a
   * switch that changes nothing.
   */
  reason: z.enum(['permission', 'unreadable']).nullable()
}).strict().superRefine((focus, ctx) => {
  if (focus.known !== (focus.active !== null)) {
    ctx.addIssue({ code: 'custom', message: 'an unread Focus state cannot carry a value' })
  }
  if (focus.known === (focus.reason !== null)) {
    ctx.addIssue({ code: 'custom', message: 'a reason to offer a fix for, or a reading: never both' })
  }
  if (focus.active !== true && (focus.modeName !== null || focus.source !== null)) {
    ctx.addIssue({ code: 'custom', message: 'a mode name or source without an active mode' })
  }
  if (focus.active === true && focus.source === null) {
    ctx.addIssue({ code: 'custom', message: 'an active mode must say how it was detected' })
  }
})
export type FocusSnapshot = z.infer<typeof focusStatusSchema>

/**
 * The expressions the pet can wear.
 *
 * `idle` is the resting face and `thinking` is what a burst waiting to be analysed, or a turn in
 * flight, is drawn as. `focused`, `sleeping` and `dozing` are the only ones a Focus reading may
 * produce (ADR 0007); `suspicious`, `intervene` and `pleased` are the agent's, from the visual
 * state machine in `docs/agent.md` §8. `speaking` belongs to the character vocabulary a pack
 * must satisfy (`docs/pet-visual-brief.md`); the shell has no state of its own that forces it,
 * now that nothing is previewed on demand (ADR 0011).
 *
 * This vocabulary is provisional: `docs/pet-visual-brief.md` owns the state contract that a
 * character pack must satisfy, and these are additions to it, not the pack's own set.
 */
export const petExpressionSchema = z.enum([
  'idle', 'thinking', 'speaking', 'focused', 'sleeping', 'dozing', 'suspicious', 'intervene', 'pleased'
])
export type PetExpression = z.infer<typeof petExpressionSchema>
/** Expressions that mean "the sensor read a mode": they may never be shown without one. */
const FOCUS_EXPRESSIONS: readonly PetExpression[] = ['focused', 'sleeping', 'dozing']
/** Expressions only the agent earns: they may never be shown without a turn behind them. */
const AGENT_EXPRESSIONS: readonly PetExpression[] = ['suspicious', 'intervene', 'pleased']

/**
 * What the shell may say about the agent.
 *
 * Two claims are kept apart on purpose. `isModel` is false while the provider running has no
 * words of its own, so a turn that ran without a model can never be shown as copy a model wrote;
 * a line can never exist without a source, because provenance is stamped by the runtime and
 * never by whatever wrote the words (`docs/tone.md` §6).
 */
export const agentStatusSchema = z.object({
  provider: z.enum(['fake', 'openai']),
  isModel: z.boolean(),
  phase: z.enum(['idle', 'thinking', 'offline']),
  /** Escalation rung from observed time — the ceiling this turn's action was clamped to. */
  level: z.number().int().min(0).max(3),
  levelLabel: z.string(),
  turns: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  lastLine: z.string().nullable(),
  lastSource: z.enum(['model', 'fallback']).nullable(),
  lastAction: z.enum(['say_bubble', 'mood_only', 'notify', 'none']).nullable(),
  lastAt: z.number().nullable(),
  intervalSeconds: z.number().int().positive(),
  /** Plain language, shown to a person, never parsed. */
  detail: z.string().nullable(),
  /** Validator and clamp notes from the last turn, so a quiet pet is explainable. */
  notes: z.array(z.string()).max(4)
}).strict().superRefine((agent, ctx) => {
  if ((agent.lastLine !== null) !== (agent.lastSource !== null)) {
    ctx.addIssue({ code: 'custom', message: 'a line must carry its source, and a source must have a line' })
  }
  if (agent.lastLine !== null && agent.lastAt === null) {
    ctx.addIssue({ code: 'custom', message: 'a line must say when it was said' })
  }
  if (agent.isModel === false && agent.lastSource === 'model') {
    ctx.addIssue({ code: 'custom', message: 'a stand-in provider cannot produce model-sourced copy' })
  }
})
export type AgentSnapshot = z.infer<typeof agentStatusSchema>

/**
 * What the shell may say about the event log. `demoMode` says a threshold was lowered to make
 * the demo happen, which `docs/hackathon.md` §4 requires to be visible wherever it applies.
 */
export const eventLogStatusSchema = z.object({
  total: z.number().int().nonnegative(),
  path: z.string(),
  lastSite: z.string().nullable(),
  lastCategory: z.string().nullable(),
  lastAt: z.number().nullable(),
  demoMode: z.boolean(),
  /** Pre-formatted, newest last. The renderer prints these and derives nothing. */
  recent: z.array(z.string()).max(8),
  detail: z.string().nullable()
}).strict()
export type EventLogSnapshot = z.infer<typeof eventLogStatusSchema>

/** What the shell may say about the watched-site list it actually loaded. */
export const catalogStatusSchema = z.object({
  loaded: z.boolean(),
  path: z.string().nullable(),
  sites: z.number().int().nonnegative(),
  categories: z.array(z.string()).max(16),
  detail: z.string().nullable()
}).strict()
export type CatalogSnapshot = z.infer<typeof catalogStatusSchema>

export const statusSchema = z.object({
  petVisible: z.boolean(),
  /**
   * What the pet is actually wearing, after the sensor and the agent are folded together. The
   * renderer draws this and never derives it, so the sources can disagree only where this
   * schema allows them to.
   */
  petExpression: petExpressionSchema,
  /** The one line the pet is showing, or null. Already validated and provenance-stamped. */
  petLine: z.object({
    say: z.string(),
    source: z.enum(['model', 'fallback']),
    badge: z.string().nullable(),
    at: z.number()
  }).strict().nullable(),
  bridge: bridgeStatusSchema,
  focus: focusStatusSchema,
  agent: agentStatusSchema,
  events: eventLogStatusSchema,
  catalog: catalogStatusSchema,
  /**
   * The transport is real; no pack runtime is. Non-negotiable 10 and
   * `docs/hackathon.md` §4 forbid letting a stub read as a working pack, so the shell
   * reports the transport and the missing pack runtime separately instead of collapsing
   * them into one reassuring word.
   */
  browser: z.literal('no-pack-installed'),
  handler: z.enum(['mock', 'kernel']),
  character: z.literal('placeholder')
}).strict().superRefine((state, ctx) => {
  // The pet may only look like it read a Focus mode if it actually did. This is
  // non-negotiable 6 expressed as a type: an unread database cannot produce a dozing pet.
  if (FOCUS_EXPRESSIONS.includes(state.petExpression) && state.focus.active !== true) {
    ctx.addIssue({ code: 'custom', message: 'a Focus expression without an active mode' })
  }
  // And it may only look like the agent reacted if a turn actually happened.
  if (AGENT_EXPRESSIONS.includes(state.petExpression) && state.agent.lastAt === null) {
    ctx.addIssue({ code: 'custom', message: 'an agent expression without a turn behind it' })
  }
  if (state.petLine !== null && state.agent.lastAt === null) {
    ctx.addIssue({ code: 'custom', message: 'a line on screen without a turn behind it' })
  }
})
export type DesktopStatus = z.infer<typeof statusSchema>
export interface DesktopAPI {
  status: () => Promise<DesktopStatus>
  command: (command: DesktopCommand) => Promise<void>
  onStatus: (listener: (status: DesktopStatus) => void) => () => void
  onSpeech: (listener: (audio: Uint8Array) => void) => () => void
}
