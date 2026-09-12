# Unrot Pet

Repository home for the Unrot Pet desktop application, browser extension,
local service, and go-to-market work.

## Structure

- `apps/` — deployable desktop, web, and local-server applications.
- `extensions/` — browser extension source and publishing material.
- `packages/` — contracts, UI, and shared configuration.
- `teams/` — marketing, video, growth, and agent coordination workspaces.
- `docs/` — architecture, product, and decision records.
- `infra/` — local development, CI, and release automation.

Read [AGENTS.md](AGENTS.md) before adding implementation work.

## Build the desktop app

The Electron desktop app — HostilePet — lives in `apps/desktop` and is currently
the only application in this repository that builds. Everything below refers to it.

`apps/desktop` is a pnpm workspace with its own root `package.json`, so **run every
command from `apps/desktop`**. The repository root has no `package.json`, and a pnpm
command there stops with `ERR_PNPM_NO_PKG_MANIFEST`.

### Prerequisites

| Requirement | Version | Pinned in |
| --- | --- | --- |
| macOS | 14 Sonoma or later | `docs/product/2026-09-12-hostilepet-requirements.md` |
| Node.js | 26.7.0 | `apps/desktop/.nvmrc` |
| pnpm | 10.28.2 | `packageManager` in `apps/desktop/package.json` |

The build is verified on Apple Silicon (arm64). Your pnpm must run natively for
your CPU architecture; an x64 pnpm on Apple Silicon breaks `typecheck`, `test`,
and `build`. See [Troubleshooting](#troubleshooting).

### Install and run

```sh
cd apps/desktop
pnpm install
pnpm dev
```

`pnpm dev` launches the app with hot reload. Open settings from the menu-bar icon
or the pet's **PLACEHOLDER ↗** button. Closing settings keeps the tray app running;
quit from settings or the tray menu.

### Build and verify

Run these from `apps/desktop`.

| Command | What it does | Output |
| --- | --- | --- |
| `pnpm typecheck` | Runs `tsc --noEmit` in all three packages | — |
| `pnpm test` | Runs Vitest in all three packages: 64 tests | — |
| `pnpm build` | Bundles main, preload, and renderer | `apps/desktop/apps/desktop/out/` |
| `pnpm package` | Builds, then packages a macOS app | `apps/desktop/apps/desktop/release/mac-arm64/HostilePet.app` |
| `pnpm smoke` | Builds, then runs the native Electron smoke check | a temporary user-data directory |

Mind the nesting: the workspace root is `apps/desktop`, and the desktop package
itself is `apps/desktop/apps/desktop`. Both `out/` and `release/` are gitignored.

`pnpm package` produces an unsigned app of about 300 MB that uses Electron's
default icon.
It is a local build for testing, not a signed or notarized release.

`pnpm smoke` launches real Electron windows and asserts the preload IPC boundary,
pet show/hide, settings rendering, and that the bridge reaches `listening`. It
needs a free port 54321 and a GUI session.

### Troubleshooting

**`pnpm typecheck` or `pnpm test` fails with a missing native package.** The errors
name the architecture they looked for:

```
Error: Unable to resolve @typescript/typescript-darwin-arm64.
Error: Cannot find module '@rollup/rollup-darwin-arm64'
```

Your pnpm runs under a different CPU architecture than your Node.js. On Apple
Silicon this happens when pnpm is the x64 build: it installs `darwin-x64` native
packages while Node runs as arm64 and looks for `darwin-arm64`.

Confirm it from `apps/desktop`:

```sh
ls node_modules/.pnpm | grep rollup-darwin   # must be darwin-arm64, not darwin-x64
```

Then reinstall pnpm for your architecture and rebuild from a clean tree:

```sh
npm install -g pnpm@10.28.2
cd apps/desktop
rm -rf node_modules apps/desktop/node_modules packages/*/node_modules
pnpm install
```

**`pnpm smoke` fails on the bridge assertion.** The check asserts the bridge is
listening on port 54321, so it fails when another process holds that port — a
running `pnpm dev` session, for example. Stop that process and rerun.

**`pnpm smoke` reports `sandbox initialization failed`.** Chromium's OS sandbox
cannot initialize in some restricted environments. Run the check with
`--no-sandbox`; the IPC-boundary assertions are unaffected by that switch.
