# ADR 0006 — Agent library: LangGraph JS on LangChain core

**Status:** accepted for this build; decision 6's key source is superseded by ADR 0010
**Related:** `docs/agent.md`, `docs/stack.md` §1 and §4, ADR 0004, ADR 0010

## Context

`AGENTS.md` decision 10 and `docs/stack.md` §4 left the agent library open between a direct SDK loop, LangChain JS and LangGraph JS, and required the choice before the agent is implemented. Decision 1 left the model provider open.

What the loop actually needs (`docs/agent.md` §1, §4, §6): typed state that survives several steps, conditional routing, tool binding, schema-validated structured output, and a bounded run of at most four tool calls with one retry on validator rejection. A hand-rolled loop can do all of that; the question is whether it should.

Two constraints bound the choice:

1. The core runs TypeScript in Electron main (ADR 0004). Any dependency must load on Electron's bundled Node, not the build-time Node.
2. The model, its tools and its output are the *only* thing the library owns. Enforcement stays with the deterministic rule engine.

## Decision

1. **Adopt LangGraph JS** — `@langchain/langgraph` — as the graph runtime, with **`@langchain/core`** for messages, tools and structured output. They live in `packages/agent` (`docs/engineering.md` §1).
2. **Pinned versions:** `@langchain/langgraph` 1.4.15, `@langchain/core` 1.2.11, zod 4.6.2. Zod was already the workspace pin and satisfies LangGraph's peer range `^3.25.32 || ^4.2.0`.
3. **Do not adopt the umbrella `langchain` package.** It pulls `langsmith` (a tracing client) and `@langchain/langgraph-sdk` (a LangGraph Platform HTTP client) into the application. `docs/stack.md` §3 forbids telemetry SDKs and neither is needed for a local loop.
4. **Provider: OpenAI** (`AGENTS.md` decision 1). No provider package is installed: `packages/agent/src/provider.ts` makes one `POST /chat/completions` with `response_format: { type: 'json_object' }` through `fetch`, and parses `{say, mood, action}`.
5. **Model: `gpt-5.6-luna`**, pinned as `DEFAULT_MODEL` in that file and overridable with `HOSTILEPET_MODEL`. The structured-output smoke test in `docs/agent.md` §7 has not been run — no key was available when this was wired — so the first real turn is the test. Revisit if the model proves unreliable at the contract; nothing downstream depends on the name.
6. **Selection:** `HOSTILEPET_PROVIDER=openai` selects the model, and any missing piece — no key, unreadable persona artifact — leaves the provider that has no words in place **with a reason the UI shows** (`docs/agent.md` §6). The API key comes from `HOSTILEPET_OPENAI_API_KEY` in the git-ignored `.env` or from the login Keychain (`hostilepet.openai`, read in `apps/desktop/src/main/agent/keychain.ts`), resolved in `apps/desktop/src/main/agent/api-key.ts`; it is passed to one call and is never persisted or logged. **ADR 0010 supersedes this decision's key source** and records why the environment was allowed in front of the Keychain. **ADR 0011 supersedes its fallback copy**: there are no curated lines to fall back to, so a turn that gets no line from a model says nothing, and calling the no-model provider the "default" no longer describes a choice between two voices.

## Boundaries

- **The graph is not a policy store.** Commitments, counters, grants, cooldowns and leases belong to the kernel. A checkpointer — `MemorySaver`, `SqliteSaver`, `@langchain/langgraph-checkpoint` — is at most a transcript cache and must never be read as policy truth (`docs/agent.md` §9).
- **No framework path may enable, widen, weaken or disable a rule**, or substitute for user approval. Interrupts and human-in-the-loop constructs do not replace a kernel grant.
- **The four-call budget and action receipts stay application-owned.** A model-proposed action is a proposal, not a completed effect (`docs/agent.md` §4).
- **No telemetry, no remote runtime.** LangSmith tracing is not configured and stays off; there is no LangGraph Platform deployment and no remote `graph-sdk` client.
- **The API key stays out of the state file, the logs and the windows** (ADR 0010 amends the original "never in env" form of this line): it is read from the git-ignored `.env` or the login Keychain by the privileged core, and handed to one call.
- **Node-only.** `packages/agent` is never imported into the renderer or the extension bundle (`docs/engineering.md` §2).

## Verification

Recorded against Electron 44.3.0 (bundled Node 24.20.0, Chromium 152, ABI 149):

- Engine ranges are satisfied: `@langchain/core` requires `>=20`, `@langchain/langgraph` requires `>=18`; the runtime is 24.20.0.
- Both packages publish a CommonJS `require` condition alongside ESM, so the CJS main bundle loads them without ESM-interop work. This was checked rather than assumed, because both are `"type": "module"`.
- `pnpm --filter @hostile-pet/agent test` — a graph compiles, invokes, and reduces concurrent channel writes.
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../../packages/agent/scripts/electron-runtime-check.cjs` from `apps/desktop` → `{"check":"agent.runtime","electron":"44.3.0","node":"24.20.0","graph":"ok","core":"ok"}`.

Pinning is not completion. In-app wiring stays unproven until the desktop smoke test exercises a real turn on the demo machine.

## Consequences

**Positive**

- Typed state, conditional routing and streaming come from a maintained library instead of a hand-written loop; structured output and tool binding are already integrated with Zod, which the workspace uses at every boundary.
- The loop shape in `docs/agent.md` §1 maps directly onto graph nodes, so the offline fallback path is an alternate edge rather than a second implementation.

**Negative**

- A large dependency tree in the privileged main process. electron-vite externalizes dependencies by default, so these ship inside `app.asar` rather than being bundled. Measure main-process startup and idle memory against `docs/stack.md` §2.
- Framework abstractions invite drift: a checkpointer that quietly becomes authoritative would invert ownership. The boundaries above are the guard, and any graph that writes policy state is a defect, not a configuration choice.
- Adopting a graph library does **not** settle the tool-dispatch protocol. `docs/agent.md` §4 still requires one dispatch format, result receipts, confirmation states and a defined final-response request before the boundary is implemented.
- The ADR-documented prohibition on telemetry is now a property of a third-party tree. `langsmith` is absent only because the umbrella package was not adopted; re-check on every dependency change.

## Alternatives

| Option | Why not |
| --- | --- |
| **Direct SDK loop** | No dependency weight and total control, but typed multi-step state, conditional edges and the retry/fallback transitions in `docs/agent.md` §6 become hand-written infrastructure that has to be tested like framework code. |
| **Umbrella `langchain` package** | Convenient re-exports, but it drags in `langsmith` tracing and the remote `graph-sdk`. Directly at odds with `docs/stack.md` §3, for no gain over the two scoped packages. |
| **LangChain JS without LangGraph** | Chains express a straight line, not the branch-and-retry shape this loop needs; the graph adds little weight over `@langchain/core` alone. |
| **A Rust or Python agent sidecar** | Rejected with the runtime in ADR 0004: it would add a second deployment unit, a second policy boundary and a wire format to a build that has none. |

## Revisit triggers

- Main-process startup latency or idle memory regresses measurably on the demo machine.
- A checkpoint store is proposed as authoritative policy state — that is a superseding ADR, not a configuration change.
- The provider changes, the pinned model proves unreliable at the output contract, or a local model becomes the default.
- The agent is moved into a `utilityProcess` (an isolation path ADR 0004 keeps open); this ADR stays valid, but the serialization boundary needs its own decision.
