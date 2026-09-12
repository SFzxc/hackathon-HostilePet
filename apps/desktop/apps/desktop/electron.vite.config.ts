import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * `.env` lives one level up, beside the workspace's `package.json`, so that one file covers
 * the whole app rather than only this package.
 */
const envDir = resolve(__dirname, '..', '..')

export default defineConfig(({ mode }) => {
  // The main process now reads `.env` itself at startup (`src/main/env-file.ts`), which is what
  // makes the file work in a packaged bundle: there is no parent process to inherit from when
  // the app is launched from Finder. This load stays for everything the CLI spawns, and it runs
  // first, so precedence is unchanged and documented in one place — an existing `process.env`
  // value wins, and a shell export is the exception rather than the rule.
  //
  // electron-vite would not do this on its own: it exposes file values only through
  // `import.meta.env`, only for the `VITE_` / `MAIN_VITE_` / `PRELOAD_VITE_` /
  // `RENDERER_VITE_` prefixes, and `HOSTILEPET_` matches none of them.
  Object.assign(process.env, loadEnv(mode, envDir, ['HOSTILEPET_']))

  // `envDir` keeps all three scopes resolving `.env` from the one directory the file actually
  // lives in. Left unset, Vite would default to `process.cwd()` — this package, where there is
  // no `.env` at all — so the main process would read the workspace file while the renderer
  // read nothing, which is a split worth avoiding before someone adds a `VITE_*` value.
  //
  // It does NOT make an edit to `.env` take effect on a running `pnpm dev`. Vite notices the
  // change and restarts its dev server, but that is the renderer only: the Electron main process
  // is a separate `build --watch` and is not restarted, and the value this process already put
  // in `process.env` would outrank a re-read anyway. Restart `pnpm dev` after editing the file.
  const env = { envDir }

  return {
    main: {
      ...env,
      build: {
        rollupOptions: {
          // electron-vite 5 derives `build.lib.entry` from a single `src/main/index.ts`, so a
          // second entry has to be declared here. Both land flat in `out/main/`, which is what
          // the `bridge:mock` script runs. See `docs/browser-pack.md` §5 for why the fake
          // kernel is a separate process from the app.
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            'bridge-standalone': resolve(__dirname, 'src/main/bridge-standalone.ts')
          }
        }
      }
    },
    preload: { ...env, build: { externalizeDeps: false } },
    renderer: { ...env, plugins: [react(), {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // Vite's React refresh preamble is inline in development only.
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      }
    }] }
  }
})
