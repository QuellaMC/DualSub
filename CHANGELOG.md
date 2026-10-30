# Changelog

All notable changes to DualSub are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Click a word in the subtitles to see what it means, with nothing to set up. The side panel shows the word's line with its translation, the word's own translation, and an entry from Google's dictionary, or from Wiktionary when Google has none. Click more words, in the subtitles or in the panel's copy of the line, to look up a phrase; click a picked word in the panel to take it out.
- Explain with AI, in the panel, asks your AI service how the words are used in their line: what they mean there and how casual or formal they are, plus what you ticked in What to explain: examples and similar ways to say it, the culture behind them, and their history. Without a key, it opens the three steps for adding one in the panel.

### Changed

- The side panel is built around the words you clicked, with DualSub and the language pair at the top, and Help and Settings at the bottom. On a tab that isn't Netflix or Disney+, it says where to open a video.
- Subtitle words are clickable for everyone, and "Look up words when I click them" in Meanings turns that off. Explanations no longer have a switch of their own: a saved OpenAI or Gemini key turns on Explain with AI, so anyone with a key keeps it working after the update.
- The words you click go to Google's dictionary, and to Wiktionary when Google has no entry, whichever translation service you use. The privacy policy says so.
- An AI answer is one explanation of the words in their line, instead of separate cultural, historical, and linguistic analyses, and it explains the meaning even with nothing ticked in What to explain. A failure says whether the key was refused, which reopens the key steps, or the service didn't answer, instead of showing the service's own message.

## [3.2.1] - 2026-10-23

### Fixed

- A settings section opened from the menu starts at its top, instead of scrolled a little past the top bar and the section's first lines.

## [3.2.0] - 2026-10-17

### Changed

- Each line of the show's own translation comes and goes with the original line it belongs with, instead of on its own timing, so the two lines no longer drift apart. If a show's lines go with the wrong original line, Help turns this off in one click, as does a switch in Languages when advanced options are shown. The subtitles on screen follow at once.

### Fixed

- With the show's own translation, a line that stays on screen while the line beside it changes no longer blinks. In the short gap a show leaves between two lines, the line before holds until the next one begins.
- Netflix captions laid out one line per region, as closed captions converted from broadcast are, show as one caption. Its lines are translated together instead of as half-sentences, a caption raised to the top is drawn as one block that no longer overlaps its neighbors' translations, and the show's own translation goes with the whole caption rather than one of its lines.

## [3.1.1] - 2026-10-17

### Fixed

- The two subtitle lines are called Original and Translation. "Top line" named the line in the video's language even after the translation was put on top, and the On top choices say Original or Translation instead of "Video's" and "Mine".

## [3.1.0] - 2026-10-17

### Added

- The popup is a remote control. On a site DualSub works on, it says whether DualSub is working on the video, turns it on or off for that site, picks your language, says which language the top line shows, and moves the text size, timing, and position in steps the video follows at once. A translation service that stopped working is named there, with a link to its settings. Anywhere else, the popup shows what DualSub does and opens the sites.
- A welcome page opens once, right after install. It shows the subtitles you will see in your languages, lets you change the translation language, and walks through pinning DualSub and playing a first video.
- A new settings page holds every setting, the popup's included, in plain words and a typeface drawn for legibility. A menu beside it names each section: Start, Languages, Style, Timing, Translation, Meanings, Sites, and Help. Start says where DualSub is working, shows a sample of your subtitles, and sets your language, the text size, and the translation service; Help fixes common problems in one click. Each change saves at once, and the notice that confirms it can undo it, as can Ctrl+Z (⌘Z). A search box finds a setting by everyday words. The Advanced options switch in the top bar adds the exact timing shift, per-site settings, limits, backup and restore, the stored settings as JSON, the logging level, and a diagnostic report.
- The Style section draws the subtitles on a stage at the video's true proportions, with the overlay's own styling. Click a line to style it, drag the subtitles to move them, or open Full screen to see them at their real size. The pane beside the stage holds size, position, look, translation color, and lines, and search opens the row that holds a setting.
- Timing shows the voice and the subtitles on a timeline that follows each shift.
- Each site can keep its own settings: whether DualSub runs there, hiding the site's own subtitles, the top line's language, official translations, the look, and timing. A site stores only the values it keeps for itself; everything else follows the settings for all sites. The popup edits the value the current site uses, and its on/off switch is the site's own.
- When the translation service you chose stops working (a rejected key, a used-up quota, or a request it refuses), Microsoft Translator covers, then Google Translate, so subtitles keep coming. Your service is tried again after ten minutes or as soon as its settings change. Turning fallback off keeps subtitle text with your chosen service only.
- The top line follows the language spoken in the video. "Automatic" is the default for fresh installs, and it follows the audio track when you switch it in the player; a fixed language is still there for learning one language with every video.
- Subtitle looks: "Like the site" draws both lines in the platform's own player typography: the font, color, edge, and background from your Netflix or Disney+ profile's subtitle appearance settings, without the platform's subtitles on. The ready-made looks (Boxed, Classic, High contrast, and Cinema) start your own, whose font, weight, top-line color, edge, and box you can change. Size stays DualSub's own setting in every look, since the platforms size a single line.
- The translation line's color is a setting of its own and applies to every look.

### Changed

- The subtitle look, line order and layout, official translations, and line spacing are set in the settings page; the popup keeps what you change while watching.
- AI Context is called Word explanations and lives in the settings page's Meanings section; it turns on once an AI service key is in.
- On a fresh install the translation language is the browser's language instead of Chinese (Simplified).
- When the video is already in the translation language, one line shows instead of the same text twice.
- Subtitles are sized from the video's rendered height instead of the window width, so they follow fullscreen and window changes the way the platforms' own subtitles do. The font size slider is a scale factor, and stored values migrate to the matching scale.
- The position slider places the lines relative to the picture, letterbox bars excluded, as the platforms place their own subtitles.

### Fixed

- An API key goes only to the address it was entered for. When the AI translation or word explanations address moves to another host (on this computer, on another one you sync with, or by loading a backup), the key waits for its own address and the settings page asks for a key for the new one.
- Cues the platform raises over on-screen text are drawn at the platform's line instead of the bottom, and cues shown at the same time are all drawn, each in its place. Netflix cues that share a timestamp are no longer merged into one line.

## [3.0.2] - 2026-09-03

### Fixed

- Subtitle slots are drawn only when they have text, so no empty box sits over the video between lines.

## [3.0.1] - 2026-09-02

### Fixed

- The side panel keeps a tab's selected words, running analysis, and answer while you visit other tabs and come back.

## [3.0.0] - 2026-09-02

### Changed

- Rebuilt the extension in TypeScript on WXT with React 19, zod, and Vitest. Every cross-context message is a typed contract, and each video gets one player session whose listeners, timers, and requests end together.
- Netflix subtitle tracks come from the player's own API instead of from intercepted JSON parsing, which Netflix's 2026 player change broke.
- Microsoft Translate uses Edge's tokenless `translatetext` endpoint, since Microsoft retired the free auth endpoint in July 2026. Its settings id is `microsoft_edge`, and it is the default provider again.
- Language changes reload subtitles in place: the current line stays on screen behind a loading placeholder until the new languages arrive.
- AI analysis failures show the provider's own reason in the side panel.

### Added

- Clickable subtitle words with locale-aware segmentation (Chinese and Japanese split into words), selection sync with the side panel, and two-phase removal.
- Seeded upgrade-path, locale parity, and cold-start tests, coverage floors in CI, and a release archive audit.

### Removed

- The v2 JavaScript tree, Jest, the Vite build, and the in-page analysis modal. The last v2 state is on the `v2-maintenance` branch.

### Fixed

- Disney+ native subtitles are hidden again inside the player's shadow tree.
- Provider requests carry only the configured credential, never browser cookies.
- The AI context rate limiter keeps its timestamps across service worker restarts.

## [2.5.0] - 2026-07-19

### Added

- AI context analysis moved from an in-page modal into Chrome's side panel, which stays open beside the video without covering it.

### Fixed

- Removing words in the side panel or switching videos no longer puts the panel out of sync. The content script holds the selection, and the panel no longer updates ahead of it.
- Selected words keep their order in the sentence, even after being removed and picked again.
- `dualsub-word-selected` listeners no longer pile up and send several events for one click.

## [2.4.0] - 2025-10-03

### Changed

- The popup and options pages are React components built with Vite, with the same features and look as before. Settings, UI text, logging, and Chrome messaging are hooks (`useSettings`, `useTranslation`, `useLogger`, `useChromeMessage`), and the options page is split into General, Translation, Providers, AI Context, and About sections.
- New dependencies: `react` and `react-dom` 19.1, `vite` 7.1, and `@vitejs/plugin-react` 5.0.

### Removed

- The vanilla JavaScript popup and options pages and their HTML templates.

### Fixed

- The options page keeps one width across its tabs.
- The AI Context section, including its collapsible advanced settings, has its original layout.
- UI text keys that did not match their messages.

## [2.3.2] - 2025-09-19

### Fixed

- Messages to the background survive the MV3 service worker going to sleep: sending wakes it and retries, with callback- or promise-style `chrome.runtime.sendMessage`. Every platform adapter sends this way.
- AI Context provider metrics count successes and errors correctly.

## [2.3.1] - 2025-08-28

### Fixed

- On Netflix, Next Episode shows the next episode's subtitles: tracks found before the route change are kept and applied right after it.

### Changed

- The content script tells the platform adapter when the URL changes.

## [2.3.0] - 2025-08-23

### Fixed

- On Netflix, moving to the next episode no longer keeps the previous episode's subtitles; subtitles reset for the new video.
- On Disney+, timing follows the redesigned progress bar, read from the aria attributes in its shadow DOM.

## [2.2.0] - 2025-08-14

### Changed

- The documentation is split into English and Chinese pages under `docs/`.
- The AI Context modal's transitions and selection persistence are refined.

## [2.1.0] - 2025-08-04

### Added

- A vertical position control for the subtitles.

## [2.0.0] - 2025-08-04

### Added

- AI Context: select subtitle text for cultural, historical, and linguistic explanations from OpenAI or Google Gemini, with API key settings, caching, and rate limiting.

## [1.4.0] - 2025-07-26

### Added

- Netflix support, with Netflix's official subtitles.
- A choice of translation providers, with bounded retries.
- The interface in six languages.
- An advanced options page.
- A test framework and configurable logging.

### Changed

- The platform code follows the Template Method pattern, and configuration management is reworked.

Versions not listed here, including those before 1.4.0, are on [GitHub Releases](https://github.com/QuellaMC/DualSub/releases).

[Unreleased]: https://github.com/QuellaMC/DualSub/compare/v3.2.1...HEAD
[3.2.1]: https://github.com/QuellaMC/DualSub/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/QuellaMC/DualSub/compare/v3.1.1...v3.2.0
[3.1.1]: https://github.com/QuellaMC/DualSub/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/QuellaMC/DualSub/compare/v3.0.2...v3.1.0
[3.0.2]: https://github.com/QuellaMC/DualSub/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/QuellaMC/DualSub/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/QuellaMC/DualSub/compare/v2.5.0...v3.0.0
[2.5.0]: https://github.com/QuellaMC/DualSub/compare/v2.4.1...v2.5.0
[2.4.0]: https://github.com/QuellaMC/DualSub/compare/v2.3.2...v2.4.0
[2.3.2]: https://github.com/QuellaMC/DualSub/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/QuellaMC/DualSub/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/QuellaMC/DualSub/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/QuellaMC/DualSub/compare/v2.1.5...v2.2.0
[2.1.0]: https://github.com/QuellaMC/DualSub/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/QuellaMC/DualSub/compare/v1.5.0...v2.0.0
[1.4.0]: https://github.com/QuellaMC/DualSub/compare/v1.3.5...v1.4.0
