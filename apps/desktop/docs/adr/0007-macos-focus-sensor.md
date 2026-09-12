# ADR 0007 — macOS Focus sensor

**Status:** accepted for the demo slice — instructed by the human on 2026-09-12, which is the
decision this record formalises
**Related:** `docs/architecture.md` §2.1, §5; `docs/engineering.md` §2, §3; ADR 0005;
`apps/desktop/scripts/focus-state.cjs`

## Decision

Read the macOS Focus state from `~/Library/DoNotDisturb/DB/` (`Assertions.json`,
`ModeConfigurations.json`) in the Electron main process, and publish it as
`signal.hp.focus-mode.changed`. This is the first non-browser sensor.

Two files, two different truths. `Assertions.json` records what a person turned on by hand.
Schedule-driven Focus is **not** in it, so a scheduled mode is derived from the triggers in
`ModeConfigurations.json`. A manual assertion outranks the schedule for naming the mode; a
coinciding scheduled window is kept in `candidates` rather than hidden.

## Why this route

macOS ships no public API that exposes the Focus **mode name**. Three routes exist, and the
choice between them is what makes this ADR-worthy:

| Route | Mode name | Permission | Verdict |
| --- | --- | --- | --- |
| `~/Library/DoNotDisturb/DB/*.json` | yes | Full Disk Access | **chosen** — documented shape, degrades honestly |
| Private `DoNotDisturb.framework` (`DNDStateService`) | yes | none | not chosen — see below |
| Public `INFocusStatusCenter` | boolean only | Apple-approved Communication Notifications entitlement | not available to this build |

The private framework is the tempting one: no permission at all. `DNDStateService
queryCurrentStateWithError:` could not be made to answer on the development machine — every
call returned `BSServiceConnectionErrorDomain Code=3` from both a bare CLI and an ad-hoc
signed bundle. That result is **inconclusive, not a finding**: the probe ran inside a sandbox
that also refused `ps` and `log show`, so a sandbox artefact cannot be ruled out. Choosing it
would mean linking a private framework whose failure mode is silent, on a machine where the
fallback is one settings toggle away. Revisit only with an unsandboxed probe.

## The permission, stated plainly

Full Disk Access is a wide grant: it exposes Mail, Messages, Safari and every other
protected store to the process that holds it. This sensor needs exactly one directory.

- The database is unreadable without it, and macOS refuses even `fs.watch` on the directory.
- A grant is recorded per **path**, so granting the packaged app does nothing for a CLI run
  from Terminal, and vice versa. `scripts/focus-state.cjs --doctor` names the app that TCC
  will actually charge for the current process.
- TCC is read when a process starts: a grant applies only after the app is quit and reopened.
- The build is unsigned (ADR 0005), so its signature is Electron's own ad-hoc one and its
  cdhash changes on every rebuild. A grant can therefore stop matching after `pnpm package`;
  re-add the entry when `--doctor` regresses to `EPERM`.

Reading is opt-out per launch with `HOSTILEPET_FOCUS_SENSOR=off`. Default-on is deliberate:
the product feature is the point of the sensor, and the failure mode when permission is
absent is an honest "cannot read", not a wrong answer.

### Reaching the switch, without pretending to flip it

The shell may not grant this to itself; only the person in front of the screen can. What it
can do is stop the user hunting for the pane. While the sensor is running and macOS is
refusing the read, the tray and the settings window both offer **Grant permission**
(`shell.openExternal` on
`x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles`,
anchored on the pane's real bundle id) and **Quit and reopen**, because TCC is read at process
start and the grant does nothing until the app restarts. Neither button claims to have granted
anything, and the unread state stays `known: false` until a read actually succeeds.

The affordance is offered only for a cause a grant would fix, and the reading carries that
cause as data rather than as a sentence: `focusStatusSchema.reason` is `'permission'` when
macOS answered `EPERM`/`EACCES`, and `'unreadable'` for every other failure — a database macOS
has not written yet, a malformed file, a vanished directory. Only `'permission'` shows the
button; `'unreadable'` keeps its own detail text and offers nothing, because sending the user
to a privacy switch for a file that does not exist fixes nothing. The two are mutually
exclusive with a reading by construction: the schema refuses a state that is `known` and
carries a `reason` at once, so no window has to decide which one to believe.

The word "permission" is deliberate, and so is leaving out the name of the pane. Earlier
copy said "Full Disk Access" in the button and in the tray; that is the accurate name of the
grant, and it is still the name used in this record and in `--doctor`. In the product's own
voice it was replaced, because the label a person reads should name the action they are
taking, not the mechanism they are granting. A sensor switched off with
`HOSTILEPET_FOCUS_SENSOR=off` is equally unread, and offering it a permission button would
send the user to a switch that changes nothing — a worse answer than no button.

## Honesty rules this sensor must keep

Non-negotiable 6 is load-bearing here, because a state that cannot be read looks exactly like
a state that is off.

- An unreadable database yields `known: false, active: null`. It never yields `active: false`.
  If either file fails to parse, the reading is unknown: half the inputs cannot support a
  conclusion about schedules.
- A payload that does not match its envelope is a failed read, not an empty one. An empty
  `storeAssertionRecords` is a real reading — nobody turned Focus on by hand.
- A read that fails immediately after a filesystem event is retried before it may emit, so a
  torn write cannot be published as "Focus turned off".
- `statusSchema.focus` enforces the above at the IPC boundary: an unread state cannot carry a
  value, a value must say what detected it, and a mode name cannot outlive its mode.
- Normalising the newline-only "off": there is no such thing as an inferred off. Focus is off
  only when the database was read and no assertion or schedule matched.

## What this does not decide

- **No rule consumes the signal yet.** The kernel does not exist; the signal is logged and
  surfaced in the shell. Nothing counts Focus time, and no intervention depends on it.
- **The mode-to-expression table is shell data, not a pack.** `src/main/pet/expression.ts` maps
  a mode to what the pet wears, which is product behaviour and therefore belongs in a pack
  (non-negotiable 1). It sits in the shell only because the pack runtime does not exist; when it
  does, the table moves and the shell keeps the plumbing. Its identifiers are **inferred, not
  observed** — `--dump` on a granted machine is what confirms them, and an identifier matching
  nothing degrades to `dozing`, which is true but unspecific.
- **The pet does not speak about Focus.** `docs/tone.md` §2 forbids pet-initiated lines during a
  focus session, and the anti-spam layer that enforces the rest of that rule (cooldown, one line
  per intervention) does not exist. Adding a line now would route around a non-negotiable
  requirement, so this slice changes only what the pet looks like.
- **No pack.** The sensor is in-process, not a declarative pack, because packs may not read
  files (non-negotiable 2). When the pack runtime lands, this becomes a privileged built-in
  sensor that a pack may subscribe to, not a pack that reads the disk.
- **Lock-screen and sleep are not distinguished** from Focus. A rule that counts "focused
  time" must not treat the two as the same thing; that is rule-engine work.

## Consequences

- `docs/architecture.md` §1 and the invariants list said exactly one sensor transport exists
  in this build. That is no longer true, and both are updated in the same change.
- The standalone `scripts/focus-state.cjs` duplicates the parser so it can run before the app
  can read anything — it is the tool that diagnoses the permission the app depends on. Delete
  its reader once the app path is proven on the demo machine, and keep `--doctor`/`--grant`.
- The parser is written against an undocumented format and has never been checked against a
  real file on this machine, because every read so far has been refused. `--dump` is the
  verification step, and the fixture tests are **not** evidence that the real database is
  read (non-negotiable 10).
