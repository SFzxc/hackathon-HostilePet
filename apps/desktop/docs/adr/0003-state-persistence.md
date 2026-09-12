# ADR 0003 — State persistence for the MVP

**Status:** accepted for this build
**Related:** `docs/protocol.md` §2, `docs/stack.md` §1, `docs/architecture.md` §4

> Runtime update: ADR 0004 replaces the original Rust kernel/WebView with a TypeScript core in Electron main and sandboxed renderers. Kernel ownership and JSON snapshots remain accepted. Serialize asynchronous mutations and writes; a single JS thread does not by itself prevent asynchronous races.

## Context

State has to survive a restart: enabled packs and their grants, commitments and thresholds, usage counters and cooldowns, wishlist items, reminders, the activity log, agent turn records.

Three forces met here:

1. `docs/protocol.md` assumed **SQLite via rusqlite** with versioned migrations.
2. The question came up whether a **Pinia store** — the fast, persisted-store approach BongoCat uses — is simply the quicker path.
3. The build is a hackathon: time spent on a migration framework is time not spent on the vertical slice.

The decisive constraint is not speed, it is **ownership**. The kernel is the single writer of policy state, and the kernel is Rust. Pinia (and its React equivalent) holds reactive state inside the WebView, on the other side of the boundary. Making the WebView the source of truth for counters and leases would invert the dependency: the offline rule engine, the lease model and the "kernel is authoritative" invariant all assume the state lives kernel-side.

So the question is not "store or database" but "which store, on which side".

## Decision

1. **WebView UI state → Zustand.** Panels, chat scrollback, onboarding step, selected pack. Pinia is Vue-only and we are on React; Zustand is the closest thing in spirit. This state is allowed to be lost.
2. **Kernel policy state → one JSON snapshot**, written atomically by the kernel: serialize to `state.json.tmp`, `fsync`, rename over `state.json`, keep one `.bak`. Loaded at boot; saved debounced (~1 s) and on quit. A `version` field at the top allows in-place shape upgrades.
3. **SQLite is deferred, not rejected.** The data model in `docs/protocol.md` §2 is the contract a future SQLite schema must match.

## Consequences

**Positive**

- A few dozen lines instead of a migration framework and a query layer — the fastest correct option at this size.
- Inspectable while debugging: `cat state.json` beats opening a database at 2 a.m. during a demo rehearsal.
- Single writer in a single process means no locking, no connection pool, no busy-retry logic — one whole class of failure disappears.
- The boundary stays right: policy state never depends on a webview being alive.

**Negative**

- Whole-file rewrite per save. Fine below ~1 MB; silly above a few MB. The activity log and `agent_turns` are therefore capped ring buffers, not growing tables.
- No queries, no partial updates, no transactions. Mitigated by atomic rename plus one `.bak`, and by retrying with backoff instead of crashing the pet window.
- Changing the snapshot shape requires bumping `version` and handling the old shape on load. A snapshot that fails to load must start clean and say so, never crash silently and never pretend state exists.
- Deferred cost: if the product grows past the hackathon, the SQLite work still happens. That is accepted deliberately.

## Alternatives

| Option | Why not |
| --- | --- |
| **Pinia / store as the source of truth** | Wrong side of the boundary, and Vue-only. It cannot own counters, leases and grants that the Rust kernel must read while the WebView is closed. |
| **SQLite now** | Correct for the long term, and the eventual answer — but a schema, migrations and a query layer is a day spent before anything is on screen. |
| **`sled` / `redb` (embedded Rust KV)** | No SQL tax and crash-safe, but a new dependency to learn for a shape we can already serialize. Reasonable middle path if the snapshot outgrows itself. |
| **localStorage in the WebView** | Same boundary problem as Pinia, plus size limits and no cross-process visibility. |

## Revisit triggers

- The snapshot exceeds ~2 MB, or the activity log needs real queries.
- A second process needs to read the state.
- Post-hackathon hardening begins — at that point this ADR is superseded by the SQLite one.
