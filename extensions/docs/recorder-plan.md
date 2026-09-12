# Recorder design and implementation plan — 2026-09-12

User authorized autonomous design and implementation, without review gates. This is a new recorder subsystem in the existing extension. Execute inline in this workspace.

Architecture: isolated content script -> semantic DOM adapters -> JSON event envelope and evidence-based intent -> serialized background storage (last 2000 events) and console sink. No third-party transport. Existing purchase interception is removed from the manifest. Recorder runs automatically on supported sites while the browser is open, with visible status and pause/export controls.

Tasks:
1. Add failing behavior tests for intent, URL redaction, category extraction and repeat-order deduplication; implement pure recorder-core.js.
2. Add a real extension browser test with routed fixture pages; verify failure before implementing recorder.js, recorder-background.js, recorder.html and recorder-panel.js.
3. Track navigation, active dwell, visible products/posts, searches, clicks, cart/checkout intent, scroll milestones, media and live context. Do not collect passwords, private messages, payment fields or raw keystrokes. Inferences have evidence and confidence, never imply a completed purchase from a click.
4. Schedule Shopee history on first Shopee visit and daily while enabled; open a background tab, read rendered order rows, bounded scroll, report partial/blocked coverage, close only extension-owned tab. Never bypass login/CAPTCHA. Preserve order identity; do not equate product links with orders or count repeated snapshots as repeat purchases.
5. Add controls for pause, auto-history, manual sync, JSON/Markdown export and clear. Retain at most 2000 events and 1000 order records locally. Export coverage and limitations.
6. Run unit suite and real Edge extension fixture tests. Generate docs/recorder-sample.json and .md from actual fixture run, explicitly mark synthetic data. Package standalone extension ZIP and document installation and limits.

Validation: test evidence vs inference, privacy, order dedupe, background serialization, real content-script console output, no buy interception, SPA navigation, history extraction, pause and export. Production website DOM remains best effort; fixture tests do not validate authenticated live accounts.

Completed: pure event/intent tests, browser collectors, controls/export, history scheduler, privacy and same-product variant regressions, bounded retention, four Edge fixture scenarios, review artifacts and verified ZIP. No real authenticated account data collected. Installation/reload in the user's normal browser remains the manual check described in README.
