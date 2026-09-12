# Reference pack — browser sensor

> Owns: the site-specific half of the browser pack. Site-specific adapter behavior is defined here; other docs may name reference packs and supported sites. Generic sensor, transport and policy rules live in `docs/architecture.md` and `docs/packs.md`.

The browser pack ships as a Chrome MV3 extension acting as a *sensor transport*: it observes declared facts on declared hosts, sanitizes them into typed signals, and renders leased in-page interventions. It contains no policy and no rule logic.

## 1. Permissions and data

- Request host permissions only for supported sites; prefer optional permissions requested when the sensor pack is enabled.
- `<all_urls>` MUST NOT be used, including for development convenience.
- Never read passwords, card numbers, cookies, auth tokens, messages, or full browsing history.
- Never send raw HTML, full page text, or URLs with query strings to the model.
- Incognito support stays off.
- A visible tracking indicator, a Pause control, and "delete local data" MUST exist.
- The pairing secret authenticates the bridge only. It MUST NOT be placed in the page DOM or content script.

## 2. Social adapter — YouTube Shorts

- Detect the Shorts route, including SPA navigation.
- Session qualification uses active tab + focused window + document visibility + idle state.
- Scroll count is not a measure of time or intent. Never conclude "addiction".
- Sample commitment: max 15 minutes of Shorts per day; warn before the limit; soft gate at the limit.
- Demo mode may lower the threshold to 30 seconds and MUST display a clear "Demo mode" badge.
- +5 minute exceptions follow the rule pack; reloading or opening a new tab MUST NOT reset the daily budget.
- Deduplicate across tabs and windows; never count sleep or disconnected periods as observed time.

## 3. Shopping adapter

- Build the local demo shop first: stable cart/checkout structure, no real payments.
- A real-site adapter is optional for this build. If time permits, choose exactly one with the user and verify it before claiming support.
- Extract the minimum: domain, page type, item name, displayed price, currency, cart total when trustworthy, timestamp, extraction confidence.
- Distinguish item price / cart total / shipping / discounted price. Store money as integer minor units plus currency.
- Never compare across currencies without an explicit conversion rule.
- If the price cannot be parsed, ask or nudge. Never hard-block on a guessed price.
- Sample commitment: unplanned purchase above 1,000,000 VND needs a pause; after 23:00 suggest saving it until morning.
- Late night is a user-chosen condition, not evidence of impulse.
- The overlay always keeps an escape. The extension MUST NOT click buy, submit an order, or perform payment.
- Wishlist means "deferred item", never "money saved".

## 4. In-page intervention surface

- The extension renders what the kernel requests and nothing more: bubble, overlay, optional grayscale.
- Every surface renders `escapeLabel` verbatim, always visible, always clickable.
- On navigation or `documentId` change, the surface tears down. It never survives into another page.
- On disconnect from the kernel, the surface shows a disconnected state and stops claiming to be watching.
- The in-page pet uses the same character pack as the desktop (`docs/pet-visual-brief.md`). Desktop and extension stay in sync; the desktop pet may hide briefly during handoff and is restored on navigation or disconnect.

## 5. Development loop

- One extension codebase, three jobs: **transport** (bridge client), **adapters** (DOM → signals), **surface** (in-page UI). No policy, no thresholds, no rule knowledge.
- Pin the manifest `key` so the extension ID is stable across reloads and machines. The bridge tests and the pairing record both depend on it.
- Extension-only iteration MUST be possible without the desktop app: run the adapters against a **fake kernel** that replays fixtures from `packages/test-fixtures` and prints the signals it receives. Most adapter work is fixture work. That fake kernel exists: `pnpm --filter @hostile-pet/desktop bridge:mock` runs the real bridge with a mock handler, `--fixtures` prints every message and refusal reason it will accept, and `node scripts/bridge-handshake.cjs` connects a real client to it. It is a development tool (`docs/hackathon.md` §4): a gate it raises is evidence about the protocol and nothing about policy.
- Point the extension at a non-default port through its options page when two builds run side by side.
- Resetting a stale pairing: tray **Unpair** → paste a fresh token. There is no other reset path, and no hidden state.
- Reloading the extension drops its leases by design. If a gate is on screen when you reload, it disappearing is correct behaviour, not a bug.
- Order of work for a new adapter: sanitized DOM fixture → extraction with confidence → signal schema test → wire to the bridge last.
