# Packs — format, capabilities, lifecycle

> Owns: the pack contract. Kernel internals live in `docs/architecture.md`; the browser pack's site specifics in `docs/browser-pack.md`.

## 1. Why packs

The platform claim is that a use case is data, not a fork. A pack is a directory plus a manifest; the kernel implements the effects, so a pack can never execute code, open a socket, or read a file. That is what makes user-authored and agent-authored packs safe to ship early.

## 2. Kinds

| Kind | Runtime | Ships now |
| --- | --- | --- |
| `sensor` | declarative descriptor listing the signals it emits; the transport (this build: our extension) delivers them | yes |
| `rule` | declarative JSON evaluated by the kernel rule engine | yes |
| `action` | declarative descriptor + a kernel-provided effect from a fixed catalog | yes |
| `persona` | data only: tone profile + line packs | yes |
| `character` | data only: Live2D model, textures, motions, expressions | yes |
| code plugin (WASM/subprocess) | user code in a sandbox | **no** — `docs/vision.md` |

A pack MAY declare several kinds. `hp.focus-shorts` is sensor + rule + persona.

## 3. Manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "hp.focus-shorts",
  "kinds": ["sensor", "rule", "persona"],
  "name": "Focus: Shorts",
  "version": "0.1.0",
  "license": "MIT",
  "origin": "bundled",            // bundled | user | agent-drafted
  "capabilities": [
    { "id": "browser.host_permissions",
      "value": ["https://www.youtube.com/*"],
      "why": "Đếm thời gian xem Shorts trên YouTube" },
    { "id": "storage.pack_kv", "why": "Store this pack’s local settings" },
    { "id": "notify.desktop", "why": "Show reminders approved by the user" }
  ],
  "signals":  [{ "id": "session.tick", "schema": "signal.session.tick@1" }],
  "rules":    ["rules/shorts-budget.json"],
  "actions":  ["actions/soft-gate.json"],
  "lines":    { "vi": "lines/vi.json" },
  "settings": [{ "key": "dailyLimitMinutes", "type": "integer", "default": 15, "min": 1, "max": 240 }]
}
```

- Schema and capability catalog live in `packages/pack-sdk`, validated on load.
- An unknown capability, an undeclared signal, or a missing `why` is a hard failure, not a warning.
- Ids are reverse-DNS-ish and stable: `hp.<name>` for first-party, `<author>.<name>` otherwise.

## 4. Capability grants

- **Default deny.** A pack gets nothing it did not declare, and declarations are shown in plain language *before* enablement.
- Every capability REQUIRES a human-readable `why`. A manifest without one fails lint.
- Host permissions are requested from Chrome only when the sensor pack needing them is enabled, and released when it is disabled.
- Disabling a pack MUST: stop its sensors, release its active leases, and offer to delete its data.
- The activity log records which pack caused each intervention. No anonymous side effects.

## 5. Lifecycle

`install → review capabilities → enable → observe → disable / uninstall`

- Install does not imply enable. Bundled packs start disabled during onboarding.
- Rules are inert until enabled *and* their signals are available. A missing sensor degrades the pack to "unavailable" — never to a silent no-op that looks like compliance.
- Pack errors are isolated: a failing pack is disabled and reported; the kernel and other packs keep running.

## 6. Agent-drafted packs

The strongest expression of "extensible by user": the user describes a commitment in words, the agent drafts it, the user approves it.

1. User: *"sau 23h đừng để tôi mua đồ trên 1 triệu"* — typed or spoken to the pet.
2. Agent returns a `RulePackDraft`: trigger signal, conditions, threshold, intervention kind, tone hints, required capabilities.
3. Kernel validates against what exists. Unknown signal, unknown action or unavailable capability ⇒ reject with a readable reason. Thresholds and TTLs are clamped to safe bounds.
4. UI shows a plain-language diff: *what will happen*, *what will never happen*, *what it needs access to*.
5. User approves ⇒ persisted with `origin: "agent-drafted"`, `source_hash` recorded, hot-loaded, versioned. Editable, disableable, deletable like any pack.
6. The agent MUST NOT enable, widen or activate a rule on its own. Drafting is agentic; consent is human.

Required for the demo (`docs/hackathon.md`): it exercises extensibility, the agent, and the consent model in one beat.

## 7. Reference packs in this build

| Pack | Kinds | Sensor | Rule | Action |
| --- | --- | --- | --- | --- |
| `hp.focus-shorts` | sensor, rule, persona | browser (YouTube Shorts) | daily budget, warn → soft gate | bubble, optional grayscale, +5 min exception |
| `hp.impulse-shopping` | sensor, rule, persona | browser (demo shop, then one real site) | price + quiet-hours threshold at checkout | pause overlay, wishlist, morning reminder |
| `hp.starter-commitments` | rule | none | a few safe defaults the user can accept or edit | — |

These MUST be built *through* the pack runtime, never special-cased in the kernel. That is what proves the platform claim.

## 8. Implementation blockers

Resolve these in the pack contract before building the rule interpreter or draft flow. No schema/version change is approved by this list.

- Define the minimal rule/action/draft schema: signal references, operators, units, windows, threshold crossings, cooldowns, exceptions, safe bounds and multi-rule precedence. Include complete reference-pack examples and rejection fixtures.
- Define the enabled-update lifecycle. Reviewed content and grants must remain associated; changed behavior must not silently inherit an earlier approval.
- Define shared host-permission ownership, Chrome’s user-gesture approval flow and manual permission revocation. Disabling one pack must not revoke access still needed by another approved pack.
- Distinguish shopping restriction hours from speech quiet hours. One triggers a commitment; the other suppresses unsolicited dialogue.

## 9. Isolation and failure

| Case | Required behaviour |
| --- | --- |
| Invalid manifest or unknown capability | Refuse to load; surface a plain-language error; kernel and other packs unaffected. |
| Undeclared or malformed signal | Reject and log; after repeated violations auto-disable the pack. |
| Pack disabled mid-lease | Release its leases immediately; counters persist but stop accruing. |
| Pack uninstalled | Delete its `pack_kv` rows and unused observations after confirming with the user. |
| Pack needs an absent sensor | Mark dependent rules `unavailable` in the UI. |
| Pack version changed | Log the version with every intervention so behaviour stays traceable. |
