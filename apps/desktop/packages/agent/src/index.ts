/**
 * @hostile-pet/agent — provider adapter, context builder, tool runtime and output validator.
 *
 * Status: dependency boundary only (ADR 0006). LangGraph JS and `@langchain/core` are pinned and
 * verified to load on Electron's Node runtime; no graph, tool or prompt is implemented here yet.
 *
 * This module is deliberately empty. `docs/agent.md` §4 requires one settled tool-dispatch format,
 * result receipts, confirmation states and final-response protocol before the agent boundary is
 * implemented. Adopting a graph library does not settle that protocol, and this module must not
 * invent one implicitly.
 *
 * Invariants that no implementation in this package may break:
 *
 * - No checkpoint store is authoritative. Commitments, counters, grants and leases belong to the
 *   kernel. A LangGraph checkpointer is at most a transcript cache and must never be read as
 *   policy truth (`docs/agent.md` §9).
 * - No framework path may enable, widen, weaken or disable a rule, or bypass user approval.
 * - This package is Node-only and must never be imported into the renderer or the extension
 *   bundle (`docs/engineering.md` §2).
 * - The model API key is read from macOS Keychain by the privileged core, never from this
 *   package's environment, arguments or persisted state.
 */

export {}
