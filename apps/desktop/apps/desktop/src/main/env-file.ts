import { join } from 'node:path'

/**
 * `.env`, read by the app itself.
 *
 * `electron.vite.config.ts` already loads the file into the environment of the process that
 * *spawns* Electron, which is enough for `pnpm dev` and for nothing else: a packaged bundle has
 * no such parent. Launched from Finder, `process.env` is whatever launchd handed it, so every
 * `HOSTILEPET_*` would be unset and the shell would quietly run the provider that has no words on
 * the one machine where the model was configured.
 *
 * So the main process reads the file too, at startup and before its first `HOSTILEPET_*` read.
 * Node's loader leaves an already-set variable alone, which is the order this project wants: a
 * shell export is the exception and still wins over the file.
 *
 * `.env` is git-ignored and is the one file on disk that may hold a secret in plain text, so
 * nothing here is logged: only the candidate paths are computed, never a value read back out.
 */
export function dotenvPaths(appPath: string, exePath: string, resourcesPath: string): string[] {
  return [
    // Development: `apps/desktop/apps/desktop` → `apps/desktop/.env`, the same hop the persona
    // and catalog resolvers make.
    join(appPath, '..', '..', '.env'),
    // Monorepo development: allow the shared repository-root `.env` used by local commands.
    join(appPath, '..', '..', '..', '..', '.env'),
    // Packaged, beside `HostilePet.app`: editable without opening the bundle. `exePath` names a
    // file, not a directory, so the first hop only drops the file name — four reach the folder
    // that holds the bundle (`…/HostilePet.app/Contents/MacOS/HostilePet` → `/Applications`).
    join(exePath, '..', '..', '..', '..', '.env'),
    // Packaged, inside the bundle: where `extraResources` puts `packs/` and `prompts/`.
    join(resourcesPath, '.env')
  ]
}

/**
 * Reads every candidate that exists, in order. The first file to define a variable sets it —
 * the loader never overwrites — so the order of `dotenvPaths` is the precedence order.
 *
 * A missing file is the normal case, not an error: the three candidates cover three layouts and
 * a run has exactly one of them. A malformed line is dropped by Node's own parser rather than
 * thrown, so a stray edit costs that line and not the app.
 */
export function loadDotEnv(paths: string[]): void {
  for (const path of paths) {
    try {
      process.loadEnvFile(path)
    } catch { /* not there, or not a file: the next candidate is the answer */ }
  }
}
