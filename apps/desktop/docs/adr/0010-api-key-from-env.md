# ADR 0010 — The model key: `.env` first, Keychain as the fallback

**Status:** accepted for this build
**Related:** `AGENTS.md` non-negotiable 8 and open decision 1, ADR 0006 decision 6, ADR 0004, `docs/engineering.md` §5, `docs/architecture.md`

## Context

Non-negotiable 8 says secrets live in Keychain, and ADR 0006 decision 6 put the model key there:
`security add-generic-password -s hostilepet.openai -a "$USER" -w`, read by
`apps/desktop/src/main/agent/keychain.ts`. That is still where the shipped product would keep it,
and this ADR does not change the store the product would use.

What it changes is the cost of *trying* the flag. Every other value about the model already comes
from `.env` — `HOSTILEPET_PROVIDER`, `HOSTILEPET_MODEL`, `HOSTILEPET_OPENAI_BASE_URL` — so the key
was the one value a developer had to fetch from a different place, with a different command, on
every machine, including a machine borrowed for one demo. The failure mode pointed the wrong way:
`HOSTILEPET_PROVIDER=openai` with no Keychain item falls back to the curated lines, so the app ran
and looked correct while the model never ran at all.

A second problem surfaced while making the change, and it is the more serious of the two.
`.env` reached the main process only through `electron.vite.config.ts`, which loads the file into
the environment of the process that *spawns* Electron. A packaged bundle has no such parent:
launched from Finder, its environment is whatever launchd handed it. On that build every
`HOSTILEPET_*` was unset — the one build that has to demonstrate the model was the one where the
file did nothing.

## Decision

1. **`HOSTILEPET_OPENAI_API_KEY` is read first; the login Keychain is the fallback**
   (`apps/desktop/src/main/agent/api-key.ts`). The environment wins because it is the value a
   developer can change without touching Keychain; the Keychain stays because a machine that
   already stores the key there must keep working with no `.env` at all.
2. **An empty or whitespace-only value counts as absent.** A bare `HOSTILEPET_OPENAI_API_KEY=`
   falls through to the Keychain rather than sending an empty bearer token. `HOSTILEPET_MODEL` and
   `HOSTILEPET_OPENAI_BASE_URL` keep their existing `??` behaviour, which `.env.example` still
   warns about; this exception is written into the reader, not into the file.
3. **The main process reads `.env` itself at startup** (`src/main/env-file.ts`), before its first
   `HOSTILEPET_*` read. Candidates, in precedence order: `apps/desktop/.env` in development (the
   same hop `persona.ts` and `site-catalog.ts` already make), `.env` beside `HostilePet.app`, and
   `Contents/Resources/.env` in a bundle.
4. **A variable already present in the environment is never overwritten** by the file. Node's
   `loadEnvFile` behaves this way on its own, and `electron.vite.config.ts` reads the file into
   `process.env` under the same rule, so a shell export stays the exception and one precedence
   order is documented in one place.
5. **The source travels with the key.** `ProviderSetup.keySource` carries `env` or `keychain`, and
   Settings says which one ran, so provenance is shown rather than guessed. A run that used a key
   pasted into a file never reads as one that used the Keychain.

## Boundaries

- **The key still never leaves the main process.** It goes from `api-key.ts` into one
  `Authorization` header: not to the renderer, not to the extension, not to `state.json` or
  `events.json`, not to a log line. Nothing in the API returns it, including the status snapshot
  the windows read.
- **`.env` is git-ignored** (`.env`, `.env.*`, with `!.env.example`), and `.env.example` carries a
  placeholder only. A real key in a tracked file remains a defect, not a configuration choice.
- **The Keychain path is not removed.** Deleting `keychain.ts` would turn the fallback into a
  claim the code does not honour; it is also the only path a machine with no `.env` has.
- **This does not license a general plaintext secret store.** The bridge pairing token keeps its
  own rule and its own narrow exception (ADR 0001). Nothing here extends to it.
- **Non-negotiable 8 is amended, not abandoned**, and `AGENTS.md` is updated in the same change to
  say what is now allowed: the model key may come from this one git-ignored file, read only by the
  privileged core, or from the Keychain. Every other clause of that rule stands.

## Verification

- `pnpm -r typecheck` and `pnpm -r test`: the pre-existing red in `src/main/events/site-tracker.ts`
  and `src/shared/desktop.test.ts` is unchanged by this decision, and neither new module adds an
  error.
- Real Electron main process, launched **without** electron-vite (so the config's `loadEnv` never
  runs): with `HOSTILEPET_OPENAI_API_KEY=` empty the status reports the provider that has no words
  and names the missing key; with a key in the file the same launch reports `key from env`. That is
  the packaged-build path exercised without packaging.
- The negative case is the one that matters: an empty variable must not select the model. It falls
  through to the Keychain instead.
- **The packaged build was then found to be broken anyway, and fixed here.** `dotenvPaths()` derived
  its second candidate with `join(exePath, '..', '..', '..', '.env')`, but `process.execPath` names
  the executable **file** (`…/HostilePet.app/Contents/MacOS/HostilePet`), so the first hop only drops
  the file name and three hops land on `/Applications/HostilePet.app/.env` — inside the bundle, where
  no one would put a file. The installed app reported `provider: null`, `keyLen: 0` while
  `process.loadEnvFile('/Applications/.env')` in the same process returned `OK` and a 64-character
  key. Four hops reach the folder that holds the bundle, which is the candidate the decision above
  describes. Verified on the installed bundle: `provider: "openai"`, `isModel: true`,
  `detail: "gpt-5.6-luna · persona-vi@3 · key from env"`. A `.env` inside `Contents/Resources` also
  works; one inside the `.app` root does not.

## Consequences

**Positive**

- The flag is now set in the one file that already holds the rest of the model configuration, and
  a packaged build reads its configuration at all — which was broken for every `HOSTILEPET_*`
  variable, not only the key.
- The failure is loud in the right place: a missing key names both sources in Settings instead of
  only the Keychain command.

**Negative**

- A secret can now sit in plain text in a file on disk. It is a file the project already had, it
  is git-ignored, and it is readable by anything running as the user — which is also true of the
  Keychain item once the login session is unlocked. This is a real reduction in the guarantee that
  non-negotiable 8 described, accepted for a build that runs on the demo machine.
- Two sources for one value means one of them can be stale. The UI reporting the source is the
  mitigation; a person reading `key from env` while wondering why an old key is in use at least
  knows where to look.
- A `.env` file is now read by the shipped binary, so a bundle can be reconfigured by editing a
  file next to it. That is intended for a demo build and would need to be revisited for a signed,
  distributed app.

## Alternatives

| Option | Why not |
| --- | --- |
| **Keychain only (the previous rule)** | The rule this ADR amends. It is the strongest store and it stays as the fallback, but it made the model flag cost a separate command per machine and made the packaged build's configuration silently empty. |
| **Env only, delete `keychain.ts`** | Simpler by one file, and it would strand every machine that already stored the key. It also removes the stronger store rather than keeping it available. |
| **`OPENAI_API_KEY`** | The name is familiar and already used by `extensions/server.mjs`, but that server is a different process with a different lifetime. `HOSTILEPET_` is the prefix the config already loads and the one every other variable uses; sharing a name across two processes invites a value set for one to be read by the other. |
| **Inlining the key at build time** (`define`) | It would put the secret in the bundle, in build output, and in any cache or log that touches them — worse than either source above, and it cannot be changed without a rebuild. |
| **Reading `.env` only in development** | Leaves the packaged build exactly as broken as it was, which is the defect this ADR is partly about. |

## Revisit triggers

- The app is distributed beyond the demo machine, or signed and notarized: the file-next-to-the-
  bundle read needs its own decision before that happens.
- A key is ever found in a tracked file, a build artifact or a log — that is the risk this decision
  accepts, and the first real instance of it supersedes the decision.
- Pairing is wired and the bridge token moves to the Keychain (ADR 0001): the two secrets then have
  different rules on purpose, and the wording in `AGENTS.md` should be re-read to confirm it still
  says so.
