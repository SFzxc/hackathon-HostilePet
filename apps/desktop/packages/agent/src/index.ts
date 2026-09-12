/**
 * `@hostile-pet/agent` — the line the pet says, and the one action it takes.
 *
 * Shape of this slice: the kernel accumulates observed site time deterministically, the turn
 * runner asks for a turn on a slow cadence, and this package turns a context package into
 * **one message and one action** — generated, clamped to the escalation level the kernel
 * chose, and validated against the deterministic floor before anything is shown.
 *
 * Invariants no implementation in this package may break (ADR 0006, `docs/agent.md`):
 *
 * - No output here enables, widens, weakens or disables a rule. The model proposes; policy
 *   clamps (`outcome.ts`) and the kernel decides the level.
 * - A model never declares its own provenance: `source` is stamped by `run-turn.ts`.
 * - Node-only. Never imported into the renderer or the extension bundle.
 * - The API key is read from macOS Keychain by the privileged core and handed to
 *   `createOpenAiProvider` for one call; it is never read from this package's environment,
 *   never persisted, and never logged.
 *
 * Still open (`docs/agent.md` §4): the tool-dispatch format. This slice has no tools, which is
 * why the LangGraph runtime pinned in ADR 0006 is not wired yet — there is no graph to route.
 * The turn is one bounded call, and introducing a graph library for a straight line would add
 * a dependency without adding a decision.
 */
export * from './context'
export * from './lines/vi'
export * from './outcome'
export * from './prompt'
export * from './provider'
export * from './run-turn'
export * from './validate'
