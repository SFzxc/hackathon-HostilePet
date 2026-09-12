# HostilePet — Agent Guide

## Purpose

HostilePet is a desktop product with a browser extension and a local service.
This repository is organized so product, engineering, marketing, demo-video,
and growth teams can work independently while sharing the same product context.

## Repository map

| Area | Owner | Purpose |
| --- | --- | --- |
| `apps/desktop` | Desktop team | Electron application shell and native integrations. |
| `apps/web` | Web team | Next.js product site, documentation site, and web experiences. |
| `apps/local-server` | Platform team | Local-only service and desktop/extension API boundary. |
| `extensions/browser` | Extension team | Browser extension implementation and store assets. |
| `packages/contracts` | Platform team | Shared API, event, and data contracts. |
| `packages/ui` | Design systems team | Reusable UI primitives and tokens. |
| `packages/config` | Platform team | Shared build and tooling configuration. |
| `teams` | Go-to-market teams | Planning, creative assets, and working briefs. |
| `docs` | All teams | Decisions, architecture, and product documentation. |
| `infra` | Platform team | Local development, CI, and release configuration. |

## Collaboration rules

- Keep executable product code inside `apps`, `extensions`, or `packages`.
- Before planning, designing, or implementing product behavior, review the relevant documentation in `docs/product/`.
- Treat product documents in `docs/product/` as the source of truth for product requirements; resolve conflicts by checking the most recently dated document or asking for clarification.
- Define a shared interface in `packages/contracts` before coupling the desktop app, extension, or local server.
- Keep publishable marketing assets in `teams/marketing/assets` and video source/exports in `teams/demo-video`.
- Record cross-team decisions in `docs/decisions` using a dated Markdown file.
- Do not add secrets, generated builds, raw customer data, or large unreviewed media files to Git.
- Each team adds its own local `AGENTS.md` only when it needs rules beyond this guide.

## Initial delivery boundaries

The first implementation phase should establish the local server contract, then
the desktop and extension clients. Marketing, demo-video, and growth teams may
prepare material in parallel without depending on application code.
