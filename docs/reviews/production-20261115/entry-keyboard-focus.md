# Entry keyboard focus: bounded accessibility pass

Base main: c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0. Separate draft; no other draft, checkout logic, provider setting, customer record or brand asset changed.

## Verified defect and correction

Input: browser-local built bundle, empty sign-in/signup fields, 390px and 1440px, normal and forced colors. Action: focus email and move forward/backward by keyboard. Expected: visible, unclipped focus indication. Before head f9382c5c00ca414bedadb5699d5c6fd4924b7e12, CI43736616719/job132880517687 reproduced outline-style:none in all eight new cases; 97 other smoke cases passed. Every first attempt failed, not merely a retry. Retained workspace-entry-focus-* captures show the before state.

The existing .clean-field input:focus removed outlines, leaving a box-shadow that forced-colors can suppress. The password input is inside an overflow:hidden wrapper. Remove outline suppression, add a 3px existing entry-blue outline with 2px offset for keyboard-focused inputs, and outline the complete password wrapper while it contains focus. Forced colors uses the system Highlight color; forced-color-adjust remains auto. No new raw colors, layout, label, submit, payment or authorization behavior.

The regression retains normal/forced-colors email and password screenshots, measures solid outlines of at least2px, checks email→password→existing reveal button and reverse Tab order, and page overflow. New cases explicitly use zero retries; existing assertions are retained. It exercises both sign-in and signup without submitting credentials. Exact final-head results must be checked; before-head status is not final-head proof.

## Guidance and coverage limits

- Apple HIG Accessibility: perceivable controls, sufficiently sized targets, larger text and reduced motion. https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple HIG VoiceOver: meaningful labels, ordering and change announcements. https://developer.apple.com/design/human-interface-guidelines/voiceover
- Fluent 2 Accessibility: visible keyboard focus and no clipped content at200% text. https://fluent2.microsoft.design/accessibility

This batch fixes the verified entry focus gap (WCAG2.4.7/1.4.11 concern); it is not a full audit or Apple/Microsoft certification. Other journey surfaces were source-triaged: first-horse drawer already has labeled fields, busy status and persistent alert; setup error recovery belongs to407, mobile email-code form to406, roster controls to409 and pricing/checkout to405. Their individual evidence does not certify integration.

Remaining independent acceptance: actual iPhone/iPad/Android and desktop keyboard, VoiceOver/Narrator spoken output, 200% text and320px reflow across every entry/setup/roster/plan state, forced-colors contrast across all controls, reduced-motion checks across all routes, and hosted signup/checkout/receipts. No screenshot or browser emulation substitutes for actual assistive technology. Local browser startup is already blocked by environment socket/interface permissions; use the canonical CI browser runner and retain first-attempt artifacts.

## Cascade verification

First fix aba77b9bb711ab8286619fd0cc9e2a3b31760d0e still failed all eight cases in43737431417. Source inspection found the global xbarCommandSystem input:focus rule also forces outline:none!important. The existing suppression now excludes only .clean-field inputs; border/shadow declarations and other controls retain their existing behavior. The important declaration is moved, not countered by another important focus rule. All regression assertions remain intact and retries remain zero. The first local full configured test chain passed through the supported Node loader; canonical local npm test reached IPC EPERM. Final exact-head CI remains required.
