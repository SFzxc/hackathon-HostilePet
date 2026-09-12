# ADR 0005 — Desktop build tooling

**Status:** accepted for the desktop scaffold
**Related:** ADR 0004; `docs/engineering.md`

Use electron-vite to build main, sandbox-compatible bundled preload, and React renderer. Use electron-builder for a local macOS `.app` directory build. Both keep Electron lifecycle code directly in the application; no framework-specific runtime owns policy.

Dependencies are pinned in the workspace manifests and lockfile. The first package target is an unsigned local build; distribution signing and notarization remain separate work. Browser extension, model provider, agent library, Live2D wrapper and policy schemas are not selected by this scaffold.

The initial preload API controls the desktop shell only. It is not the pack or browser protocol. Shell actions carry null `packId` and `ruleId` with `source: user-shell` because no pack or rule caused them; pack-caused effects must carry real identifiers.
