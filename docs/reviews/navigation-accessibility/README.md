# Canonical navigation and modal keyboard behavior

Baseline: GitHub main `c20f601d2d15c5f064c91087e3422388e9986fcb`, tree
`f48284223b974e061e1d2f391634213c726702c2`. The isolated local source snapshot
was verified against this complete tree before modification.

## Contract and scope

Health, Breeding, and Equipment search entries now enter the same overview as the
sidebar, using the existing canonical route registry. Record editors remain
separate detail workflows; the related domain changes connect each overview to
its record editor and preserve selected context. No old editor route is removed.
The new command-search regression fails on the baseline's `/medical` entry and
passes after correction.

`SlideOverDrawer` keeps its existing markup classes and visual design while using
the already installed Radix Dialog primitive (also used by the existing Sheet).
It supplies an accessible title/description, initial focus, modal focus trapping,
background interaction blocking, Escape/outside dismissal and return focus.
Quick-create selection focuses the surviving trigger before unmounting the menu
item, so a drawer never captures a disappearing menu item as its return target.

Browser tests exercise direct and quick-create openers, autofocus, both tab
boundaries, attempted background focus, background accessibility hiding, Escape,
Cancel, Close and repeated opening. These are synthetic local-workspace tests;
they do not write real customer data.

## Verification limits

Local TypeScript and focused command/route tests pass. Full configured Node test
steps are run using the existing import-loader adapter where the canonical `tsx`
CLI reaches this executor's Unix-socket restriction. Final full check outcomes
and exact-head CI/review must be read before merge.

Local Playwright execution could not launch Chromium because the sandbox denies
its socket. The escalated runner failed its environment mount before executing
the command. The existing cloud browser also blocked the local URL with
`net::ERR_BLOCKED_BY_CLIENT`. Therefore no rendered local accessibility pass or
screenshot evidence is claimed. CI must pass the added browser tests before
release. Table-row keyboard controls belong to the coordinated Health/Breeding
workstreams; this change alone does not close all of audit 33.
