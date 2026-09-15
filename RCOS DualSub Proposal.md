# RCOS DualSub Proposal

**By Jialin Fang, Jiaying Wang | September 8, 2026**

## Overview

DualSub is a Chrome extension that displays two subtitle tracks at the same time on streaming video, so that a viewer can read the original dialogue alongside a translation in their own language. It was built for language learners, but it is equally useful for accessibility and for households that watch in more than one language. The extension supports Netflix and Disney+, works with five translation providers, and includes an AI Context feature that explains cultural and idiomatic references in a selected line. It is written in JavaScript on Chrome's Manifest V3 platform and is published on the Chrome Web Store.

The core idea works, so this semester is about quality and reach rather than proving the concept. A new user today has nowhere to go except a developer-facing README, subtitles are translated one line at a time with no surrounding context, and each supported service is written as its own separate integration.

The code is organized around a BaseContentScript class that each supported service extends, with translation dispatched through a background service worker and a Jest suite covering the shared pieces. That structure is sound, but the subtitle-fetching logic still sits inside each platform adapter rather than behind a common interface, which is the root of the third problem above.

## Semester Goals

We scoped the semester around the change that unblocks the most future work: treating the streaming service's own subtitle track as the source of truth wherever one exists. Native tracks are already professionally translated and correctly timed, and Netflix support does a version of this today, but the logic is not shared. Pulling it into a common subtitle source interface improves quality and turns adding a platform into writing a thin adapter rather than a new integration.

By the end of the semester we will have that interface in place with Netflix and Disney+ moved onto it, if we have time, YouTube may added as a third platform, and context-aware translation replacing the current line-by-line approach, measured against a baseline we record in September. We will also have a public website that a non-technical user can be pointed to, covering installation, setup, and troubleshooting. Browser ports beyond Chrome, mobile support, and paid backend work are out of scope.

Our confidence in the translation work comes from existing results rather than intuition. Context-aware models have been shown to improve pronoun and anaphora handling specifically on subtitle data, which is the failure our users report most often. Related work also argues that sentence-level evaluation hides errors that only surface across a whole document, which is why we are recording a baseline in September instead of judging our own output by eye

## Milestones

- **End of September.** Set up development environments, review the existing platform adapters, and write the design for the shared subtitle source interface. Record baseline translation quality on a small benchmark set and get an empty site publishing to GitHub Pages.

- **Middle of October.** Netflix and Disney+ both running on the shared interface with existing tests passing. Context-aware translation implemented, and the landing page, install guide, and platform setup pages live.

- **Middle of November.** If we still have time, YouTube added on the shared interface, including auto-generated captions. Native track mode working so that translation is skipped when the service already offers both languages, with benchmark results compared against the September baseline.

- **End of Semester.** Test across all three platforms, fix regressions, and publish a release to the Chrome Web Store. Finish site localization, link it from the extension, and document what a future team should pick up.