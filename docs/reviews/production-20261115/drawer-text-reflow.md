# First-horse drawer: text enlargement and keyboard recovery

Separate main-based draft on c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0. Does not edit405/406/407/409/410 sources, authentication, price terms, save logic, accessible names or assets.

## Reproduction

Synthetic browser-local Cedar Ridge fixture, empty first-horse drawer, computed font and finite line-height doubled from a snapshot at320/390/1440px. The test verifies the control font actually doubles; it does not merely enlarge the root font while px text stays unchanged. This is simulated text-only enlargement, not actual browser text zoom, native Dynamic Type, VoiceOver/Narrator or physical-device evidence. All three cases use zero retries.

First test head4f2fc857cb364ae1caaa907d606909cae142a7f6 had an incorrect expected blank-name message copied from Edit Horse. Actual Add Horse says Enter a name to add the horse; the test now pins that exact existing message. No app copy changed. Captures also showed the footer's justified nonwrapping row spilling left; scrollWidth alone missed overflow toward the left.

Refined before headfd06be6f17be65cc83b09e131482c35be6fdde12, CI43741067924/job132894130655:99 cases pass, only320px fails. Expected action left>=39.203125px (content boundary, with1px tolerance); actual18px.390/1440px complete the keyboard error/correction/retry/save/reopen/Escape/focus-return sequence. Retained screenshot artifact14173015228 and first-attempt trace artifact14172423338.

## Correction

The existing drawer footer now wraps instead of spilling left, retains its height while the body scrolls, and allows enlarged button labels to wrap within max-width100%. On phones its actions share available row space and fill a row when wrapping. Existing tokens, DOM order, labels, submission, error announcement, loading status, persistence and focus behavior stay intact. No styles from earlier independent drafts are replaced.

The regression checks exact double font size, footer and drawer overflow, each action's content boundaries and vertical text fit, keyboard-only field order, empty-name persistent alert, retained form, correction/retry, saved horse identity, keyboard reopen/cancel and opener focus restoration. Baseline and error screenshots use synthetic fixtures only. Final exact-head results remain required.

Guidance: Apple HIG Accessibility https://developer.apple.com/design/human-interface-guidelines/accessibility and Fluent2 Accessibility https://fluent2.microsoft.design/accessibility call for enlarged text without losing content and keyboard usability. This is bounded engineering evidence, not certification. Actual hardware, browser text-zoom settings, VoiceOver/Narrator, hosted auth and checkout remain unverified. Existing local browser interface/socket restrictions prevent a local rendered run; canonical remote browser CI is used.
