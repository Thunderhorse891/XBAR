# Interaction Audit Checklist

## Every Release

- [ ] Static panels do not appear clickable.
- [ ] Every clickable record has hover, active, focus-visible, and pointer behavior.
- [ ] Enter and Space open focused records.
- [ ] Shift+F10 opens record actions where actions exist.
- [ ] Overflow buttons have record-specific accessible labels.
- [ ] Disabled actions explain why they are unavailable.
- [ ] Right drawer closes with Escape, backdrop click, and route change.
- [ ] Command palette finds modules and current workspace records.
- [ ] Remembered accordions and surfaces restore valid states only.
- [ ] Focus mode leaves one working surface visible and exits with Escape.
- [ ] Loading, empty, and error states are announced appropriately.
- [ ] Touch targets are at least 44 by 44 CSS pixels on mobile.
- [ ] Motion remains understandable with reduced motion enabled.
- [ ] Status meaning is not communicated by color alone.
- [ ] TypeScript, unit tests, build, and browser smoke checks pass.

## Module Coverage

- [x] Command center
- [x] Horse cards and registry rows
- [x] Horse detail timelines
- [x] Documents review rows
- [ ] Sales leads and follow-ups
- [ ] Medical records
- [x] Breeding pipeline
- [ ] Ownership records
- [x] Property, pasture, equipment, and feed
- [x] Expenses
- [x] Reminders and notifications
