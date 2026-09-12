# ADR 0008 — Event log as a capped JSON ring buffer

**Status:** accepted for the demo slice — instructed by the human on 2026-09-12
**Related:** `docs/protocol.md` §2, `docs/agent.md` §1–2, `docs/architecture.md` §6,
ADR 0003 (state persistence), `apps/desktop/src/main/events/event-log.ts`

## Decision

Observed time and agent turns are recorded in `userData/events.json` as a **capped ring buffer**:
500 records, debounced one second, written `events.json.tmp` → `rename` over `events.json`. Four
record kinds, discriminated by `kind`:

| Kind | Holds |
| --- | --- |
| `site.observed` | host, category, qualifying seconds, page count, `watch` or `threshold`, demo badge |
| `site.session` | the same figures when a connection drops |
| `agent.turn` | level, provider, `source`, prompt version, site, category, line, mood, action, result, latency |
| `agent.error` | a code and a one-line detail |

A record that no longer parses is dropped at load with a `detail`; the file is never repaired by
guessing. `demoMode` is stamped on a record only when a lowered threshold is what put it there.

This log is **memory the agent reads**, not policy state. Counters, cooldowns and lease reasons
that affect enforcement stay in the `state.json` snapshot that ADR 0003 owns.

## Why this route

The alternative was to extend `state.json` with an `events` collection and let the existing
snapshot writer own it. Three things pushed the other way:

- **Write frequency.** Ticks arrive continuously; the snapshot holds policy state whose loss
  forces a clean start. Coupling a chatty append-only log to it would either flush policy state
  constantly or lose observations, and it would make "state that affects policy survives restart"
  harder to reason about.
- **Read pattern.** The agent reads a *window* — the last N records — every 30–60 s. A separate
  file makes that a bounded read with no parser for the whole snapshot.
- **Failure isolation.** A corrupt log must never stop the pet from starting. Keeping the two
  files apart means a bad log costs the log, not the state.

SQLite is still deferred, not rejected (ADR 0003). At demo scale a 500-record array is smaller
than one JPEG, and a file a human can read is worth more on stage than an index.

## Consequences

- The ring buffer is a **window, not an archive**: totals shown in the UI are counted from what is
  still in the file. `docs/protocol.md` §2's longer retention plan (~14 days) is not implemented.
- Eviction is by count, not by age. A quiet afternoon keeps everything; a busy one keeps the tail.
  When retention by age matters, the cap becomes a window and this ADR is superseded.
- Records never carry page content, titles or URLs with query strings — only a host, a category and
  numbers. The redaction is a property of the record schemas, so a new field is a schema change.
- The file is a development-visibility surface as much as an agent input: Settings prints the last
  few records verbatim, so what the pet reacted to can be checked by a person during a rehearsal.
