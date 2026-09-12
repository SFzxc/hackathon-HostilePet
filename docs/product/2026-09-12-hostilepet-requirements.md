# HostilePet Product Requirements Document

**Status:** Draft for review
**Working name:** HostilePet (alternatives: TamagotchAI, DoomBuster)
**Primary platform:** macOS menu-bar application with a floating desktop pet
**Language:** English

## Product Summary

HostilePet is an opt-in macOS focus companion represented by a floating virtual pet. It observes user-approved productivity signals, changes mood based on an active focus session, and escalates from gentle reminders to reversible focus interventions when the user repeatedly abandons their stated goal.

Its voice is deliberately toxic, adversarial, and confrontational. The pet is a fictional antagonist whose job is to challenge excuses rather than entertain or gently encourage the user. Its copy may be harsh and taunting, but must never be discriminatory, threatening, or impossible to dismiss. The user always controls monitoring and can immediately pause or end every desktop intervention.

The first delivery is a standalone macOS menu-bar app. Chrome sensing and browser-level interventions are specified as Phase 2 so the desktop MVP can be built and demonstrated independently.

## Goals

- Deliver a memorable floating macOS pet controlled from the menu bar.
- Help users notice and recover from distraction during an intentional focus block.
- Provide voice feedback and optional, on-device posture/presence check-ins.
- Keep all core processing local and consent-based.
- Define a clean future path for Chrome doomscrolling and shopping interventions.

## Non-Goals for the macOS MVP

- No Chrome extension, DOM manipulation, checkout blocking, or tab closing.
- No cloud account, payments, social features, or cross-device sync.
- No hidden camera/microphone use, screen recording, or collection of typed text.
- No system-wide lockout, forced microphone recording, or intervention without an immediate exit.

## User and Job to Be Done

**Primary user:** A macOS knowledge worker or student who wants a playful but assertive accountability companion during intentional work blocks.

**Job:** “When I choose to focus, help me notice when I drift and make it easy to return before I lose a large block of time.”

## MVP Surfaces

### Menu-Bar Control

- Displays current mode and pet state.
- Provides **Start Focus**, **End Focus**, **Pause Monitoring**, **Settings**, and **Quit**.
- Lets the user start a 25-, 50-, or 90-minute focus session and choose allowed work apps.

### Floating Pet

- Borderless, always-on-top, movable, and position-persistent between launches.
- Click-through while idle; interactive only for prompts.
- Four expressions: **Calm**, **Concerned**, **Warning**, and **Hostile**.

### Prompt and Overlay

- A concise speech bubble or recovery card appears next to the pet by default.
- Every prompt supports keyboard navigation and visible **Dismiss**, **Pause**, and **End Session** choices.
- The strongest intervention is a reversible dim/desaturate overlay owned by the app; it must not change global display calibration.

### Settings

- Controls Focus/Relax mode, app allow-list, sensitivity, sound, camera check-in, personality intensity, reduced motion, and local-history deletion.

## Modes

| Mode | Purpose | Default behavior |
| --- | --- | --- |
| Relax | Decorative, supportive companion. | Idle animation and optional positive voice only; no scoring or intervention. |
| Focus | Timed attention commitment. | Tracks user-approved signals and applies a progressive, reversible escalation model. |

## Signals, Consent, and Retention

| Signal | Use | Consent and retention |
| --- | --- | --- |
| Active app/window category | Detect sustained use of an unapproved app during Focus. | Accessibility permission; local processing; retain only aggregate counts if history is enabled. |
| Idle time | Avoid penalizing a legitimate break. | Local, current session only. |
| Focus timer | Calculate session progression. | Local; optional local session history. |
| Camera frames | Optional estimate of presence/facing direction/coarse posture. | Off by default; camera permission plus in-app toggle; on-device inference only; never store or transmit frames. |
| Microphone | Future user-initiated spoken check-in. | Not required in MVP; separate permission and visible recording state; no always-on listening. |

The application must not collect passwords, typed text, screenshots, browsing content, camera recordings, or audio recordings. Window titles must be redacted or minimized before storage.

## Focus State Model

Each Focus session begins with a local **discipline score** of 100. The score falls only after the user actively uses an unapproved app beyond the configured grace period. Idle time pauses penalties. Active use of an allowed app gradually restores the score.

| State | Trigger | Pet behavior | Intervention |
| --- | --- | --- | --- |
| Calm | 80–100 | Happy, resting near an edge; occasional heart. | No interruption. |
| Concerned | 60–79 | Frown, tapping, sigh. | One dismissible nudge: “Is this helping you finish the thing?” |
| Warning | 30–59 | Agitated motion. | Optional voice line plus **Return to Focus** and **Take a Break** actions. |
| Hostile | 0–29 or repeated ignored warnings | Monster form with red eyes. | Reversible dim/desaturate overlay and a 10-second check-in with **Return**, **Break**, and **End Session**. |

Escalation must have a two-minute cooldown at a given state so the pet does not repeatedly interrupt the user.

## Core MVP Flows

### Start Focus

1. User opens the menu-bar panel and selects Focus.
2. User chooses a duration and allowed apps.
3. The pet enters Calm; timer and monitoring begin.
4. User can pause or end the session from the menu bar.

### Recover From Distraction

1. The user actively uses an unapproved app after the grace period.
2. The score decreases and the pet moves through Calm, Concerned, Warning, then Hostile.
3. At Hostile, the overlay asks the user to return to focus, take a configured break, or end the session.
4. Every choice restores normal desktop interaction immediately or pauses/stops monitoring.

### Camera Check-In

1. User enables Camera Check-In in Settings and accepts the macOS permission prompt.
2. During Focus, local inference periodically reports only `present`, `away`, or `uncertain`, plus `upright` or `slouched/uncertain`.
3. A confident `away` or `slouched` result may cause one neutral reminder, such as “Quick reset: shoulders up, eyes forward?”
4. Camera inference never triggers a hard intervention or score penalty by itself.

## Voice and Personality

- Use macOS text-to-speech for the MVP; no cloud speech dependency.
- Sound is off by default with volume and mute controls.
- Personality levels: **Gentle**, **Snarky**, and **Brutal**. Brutal is still non-abusive and profanity-free by default.
- Copy is short, fictional, and intentionally toxic: “That excuse is thinner than your self-control.”
- The personality does not need to be funny. Its role is to be a hostile accountability antagonist that questions rationalizations and calls out avoidance.
- The product may not fabricate authority or pressure a user to reveal sensitive information.

## Intervention Safety Requirements

- All monitoring is opt-in and explained before requesting an operating-system permission.
- Every intervention has a keyboard-accessible escape path and visible Pause/End control.
- The app must not obstruct emergency communication, macOS accessibility controls, system settings, or forced quit.
- Voice rationale starts only when a user explicitly chooses to record.
- The user can revoke permissions and delete local history from Settings.

## Phase 2: Chrome Extension

The Chrome extension communicates with the macOS companion through a consented, authenticated local bridge. It supports only explicitly enabled sites and must fail open on unknown layouts.

### Doomscrolling

1. Detect active visible time and repeated scrolling on enabled social sites such as YouTube Shorts, TikTok, Facebook Reels, and Facebook feed.
2. At a user-defined threshold (default: 15 minutes), notify the pet.
3. Each subsequent scroll increases a reversible page overlay blur by 10% and lowers saturation.
4. Present **Return to Focus**, **Take a Break**, and **Disable for this site today**.
5. Auto-close is disabled by default; it can be separately opted into later.

### Shopping Cooling-Off

1. On explicitly enabled commerce sites such as Amazon or Shopee, recognize supported checkout and buy-now controls.
2. Evaluate user-selected risk conditions, such as late-night time, a visible-price threshold, or rapid cart additions.
3. When a risk rule triggers, overlay and intercept the specific checkout control. Replace its label with a hostile status, such as **CONVINCE THE PET FIRST**.
4. The user must answer a sequence of pet questions before a purchase can continue. Required questions include: **What specific problem does this solve today?**, **What do you already own that serves the same purpose?**, and **Why is waiting until tomorrow unacceptable?**
5. The gate evaluates answers against explicit rules: answers must name a concrete use case, distinguish the item from an existing alternative, and give a time-sensitive reason. Empty, evasive, emotional, or copy-pasted answers fail.
6. On a pass, the extension restores the original checkout control for one deliberate purchase attempt. On a fail, it disables/intercepts the buy action, keeps the hostile overlay visible, and starts the configured cooling-off period (10 minutes, 1 hour, or until morning).
7. Clicking Buy during a cooling-off period must cause no checkout action. The extension shows the remaining cooldown and another hostile prompt instead.
8. A future voice explanation starts only when the user presses **Explain by voice**. Voice is an input method for the same gate, not an automatic recording feature.

## Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | The application shall run as a macOS menu-bar app without a required Dock icon. |
| FR-02 | The pet shall be movable and persist its position between launches. |
| FR-03 | The application shall provide Relax and Focus modes. |
| FR-04 | The user shall be able to start, pause, resume, and end a timed Focus session. |
| FR-05 | The user shall select allowed apps for a Focus session. |
| FR-06 | Active-app monitoring shall request Accessibility permission only when enabled. |
| FR-07 | The application shall calculate an explainable session-local discipline score and map it to four pet states. |
| FR-08 | Prompts shall be escalating and cooldown-limited. |
| FR-09 | Text-to-speech shall offer user-controlled mute and volume. |
| FR-10 | Camera Check-In shall be off by default, local-only, and immediately disableable. |
| FR-11 | Every intervention shall provide a visible, keyboard-accessible escape route. |
| FR-12 | Local session history shall be deletable by the user. |
| FR-13 | The Phase 2 browser bridge shall share only necessary event summaries through authenticated local communication. |
| FR-14 | A triggered Phase 2 shopping guard shall intercept checkout until the user passes the pet-question gate or its configured cooling-off period expires. |
| FR-15 | A failed shopping gate shall disable or intercept the targeted buy action so a click causes no checkout action during cooling-off. |
| FR-16 | The pet-question gate shall evaluate concrete-use, existing-alternative, and urgency answers using documented pass/fail rules. |

## Non-Functional Requirements

| Area | Requirement |
| --- | --- |
| Performance | Idle CPU use remains below 2% on Apple Silicon; pet UI remains responsive while active apps change. |
| Privacy | MVP processing is local and requires no network access for core functionality. |
| Reliability | Permission or signal failures disable only the affected feature and present a recoverable status. |
| Accessibility | All prompts support keyboard navigation, VoiceOver labels, reduced motion, and a silent mode. |
| Compatibility | Target macOS 14 Sonoma or later. |

## Technical Direction

Implement the MVP as a native Swift/SwiftUI macOS app, with AppKit where necessary for status-bar and floating-window behavior. Keep these boundaries separate:

- `SessionController`: timer, score, cooldowns, and recovery.
- `ActivityMonitor`: permission-gated active-app and idle-time events.
- `PetPresentation`: animations, pet window, speech bubbles, and overlay.
- `InterventionController`: safe actions, overlay escape behavior, and speech output.
- `ConsentAndSettings`: permissions, preferences, and local-data deletion.
- `AttentionMonitor`: optional on-device camera inference.
- `BrowserBridge`: Phase 2 authenticated local event interface; no Chrome dependency in the MVP.

## MVP Demo Acceptance Criteria

1. The app launches with a menu-bar item and movable floating pet.
2. A user can run a 25-minute Focus session with an allowed-app list, then return to Relax.
3. Off-task app use demonstrates Calm → Concerned → Warning → Hostile without locking the system.
4. Hostile overlay controls work with mouse and keyboard.
5. Voice can be enabled, muted, and volume-controlled.
6. Camera Check-In is off by default, requests permission only after opt-in, and processes locally.
7. Permission revocation leaves the remaining app usable.
8. An interface placeholder exists for the Phase 2 BrowserBridge without requiring Chrome to run.

## Delivery Sequence

1. **MVP Demo:** Menu-bar app, floating pet, Focus/Relax, timer, manual and active-app state changes, safe overlays, and speech.
2. **MVP+ Attention:** Optional local camera check-in.
3. **Phase 2 Chrome Sensor:** Extension, local bridge, and doomscroll detection.
4. **Phase 2 Shopping Guard:** Checkout detection, cooling-off, explicit override, and optional user-initiated voice rationale.
