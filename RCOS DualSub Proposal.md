# RCOS DualSub Proposal

**By Jialin Fang, Jiaying Wang | September 8, 2026**

## Overview

DualSub is a Chrome extension that displays two subtitle tracks at the same time on streaming video, so that a viewer can read the original dialogue alongside a translation in their own language. It was built for language learners, but it is equally useful for accessibility and for households that watch in more than one language. The extension supports Netflix and Disney+, works with five translation providers, and includes an AI Context feature that explains cultural and idiomatic references in a selected line. DualSub 3 is written in TypeScript, built with WXT and React on Chrome's Manifest V3 platform, tested with Vitest, and published on the Chrome Web Store.

This semester focuses on translation quality, platform reliability, and making user documentation easier to find. The [README](README.md) already provides installation and quick-start instructions and links to guides for features, platforms, providers, AI Context, and configuration in [English](docs/en/) and [Chinese](docs/zh/). The documentation gap is a standalone hosted website that presents these maintained guides to non-technical users. When an official target-language track is unavailable or disabled, automatic translation still processes one subtitle cue at a time without surrounding dialogue. The separate AI Context feature explains selected text; it does not provide context to automatic subtitle translation.

Netflix and Disney+ already implement the shared `PlatformAdapter` contract in [src/content/platform/types.ts](src/content/platform/types.ts). Each adapter's `interpretSubtitleEvent` method returns a `SubtitleSource`, which [PlayerSession](src/content/orchestrator/PlayerSession.ts) uses to request subtitles through the background subtitle pipeline. Background services also handle translation, provider pacing, and caching. Both platforms can use official target-language tracks when enabled and available, and the shared translation scheduler skips cues that use those tracks. This existing architecture is the foundation for the semester's work.

## Semester Goals

We will build on the existing subtitle pipeline by testing official-track selection, timing, language changes, and fallback to automatic translation on Netflix and Disney+. Any gaps reproduced in those checks will be fixed within the shared pipeline or the relevant platform adapter. For automatic translation, we will add surrounding-dialogue context to the model-backed providers while preserving the existing path for providers that do not support it, provider pacing, and the preference for official tracks.

By the end of the semester we will have validated subtitle behavior on Netflix and Disney+, added regression coverage for the issues found, and evaluated context-aware translation against a baseline recorded in September. We will also have a public website covering installation, setup, and troubleshooting, reusing or migrating the existing English and Chinese guides so each guide has one maintained source. YouTube may be added as a third platform if time permits after the core goals are complete. Browser ports beyond Chrome, mobile support, and paid backend work are out of scope.

We will evaluate whether surrounding dialogue improves pronoun references, idioms, and consistency across subtitle cues. The September benchmark will define the clips, language pairs, and scoring criteria before implementation. We will compare the current and context-aware translation paths on the same examples with the same provider and model, report translation quality and latency, and record regressions as well as improvements.

## Milestones

- **End of September.** Set up development environments and review the existing shared subtitle pipeline. Use the [smoke protocol](docs/reference/smoke-protocol.md) to check Netflix and Disney+ track selection, timing, language changes, and translation fallback; record reproducible gaps. Define and record the translation benchmark, design the context-aware translation changes, and publish an initial GitHub Pages site using the existing installation guide.

- **Middle of October.** Fix the subtitle issues identified in September and add regression coverage with the existing Vitest suite passing. Implement context-aware translation for the model-backed providers and run the first benchmark comparison. Publish the landing page, installation guide, and platform setup pages from the maintained documentation sources.

- **Middle of November.** Complete the Netflix and Disney+ checks, including verification that official target tracks bypass automatic translation and unavailable target tracks fall back correctly. Publish translation quality and latency results against the September baseline and address regressions. If time permits after the core goals are complete, add YouTube through the existing platform contract and subtitle pipeline, including auto-generated captions.

- **End of Semester.** Test Netflix and Disney+, plus YouTube if delivered, fix regressions, and publish a release to the Chrome Web Store. Finish site localization using the maintained English and Chinese guides, link the site from the extension, and document remaining work for a future team.
