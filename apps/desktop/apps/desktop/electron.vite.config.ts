import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
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
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      // Vite's React refresh preamble is inline in development only.
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }
  }] }
})
