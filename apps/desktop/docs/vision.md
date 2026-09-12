# Future product direction

> Owns: deferred opportunities and boundaries worth preserving. Non-normative for this build; `docs/product.md` owns current scope.

HostilePet should support commitments beyond the browser while keeping policy local, consent explicit, and the character independent of any one use case. The current build proves this through declarative rule packs over supported browser signals.

## Deferred opportunities

- A first non-browser sensor, such as manual check-in or app-local activity. Choose it through a product decision; do not add OS observation as infrastructure work.
- A published pack SDK and sharing format, once another person can create a useful pack with the current contract.
- Additional personas and licensed characters, with import validation and clear provenance.
- SQLite when snapshot size, query needs or durability requirements justify replacing the current store (ADR 0003).
- Native messaging if distribution or bridge requirements justify changing transport (ADR 0001).
- Broader automated integration coverage and tone evaluation after the initial release.

Executable plugins, a registry, cloud sync, other operating systems and additional surfaces are not committed roadmap items. Each needs evidence of user value, a scoped proposal and an explicit decision before implementation.

## Boundaries to preserve

- A new rule over an existing signal should be data, not kernel code. A genuinely new sensor still requires an implemented, approved observation capability.
- Every capability is opt-in and explainable. No keystroke content, screenshots, window titles, credentials or private messages.
- New actions retain finite interventions, a visible exit, truthful outcomes and human control over enablement.
- No telemetry or engagement optimization. The product should help users keep commitments, not maximize time spent with the pet.

## Questions for later

1. Which additional commitment do users want enough to justify a new sensor?
2. Can a user create and understand a useful rule pack without developer help?
3. What distribution and compatibility guarantees do shared packs actually need?
