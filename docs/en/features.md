# Features

## Core Functionality

- Dual Subtitle Display: Show original and translated subtitles simultaneously
- Multi-Platform Support: Works on Netflix and Disney+ with platform-specific optimizations
- Multiple Translation Providers: Google, Microsoft, DeepL, OpenAI-compatible, and Vertex AI Gemini
- Resilient Translation: Provider-aware rate limits, retries, and caching

## Customization Options

- Flexible Layouts: Vertical (top/bottom) or horizontal (left/right)
- Appearance Control: Adjustable font size, spacing, display order, and a subtitle look that matches the platform's own or your own, edited on a stage at your video's true proportions
- Vertical Positioning: Precise control over subtitle placement on screen
- Platform Placement: Cues the platform raises over on-screen text, or shows at the same time, are drawn where the platform puts them
- Timing Precision: Fine-tune subtitle synchronization with offset controls and a voice-and-subtitles timeline
- Per-Site Settings: Each site can keep its own on/off, languages, look, and timing
- Plain-Language Settings: Every setting on one page, with search, undo, and a sample of your subtitles
- Multi-Language UI: Interface available in 6 languages (EN, ES, JA, KO, ZH-CN, ZH-TW)

## Advanced Features

- Word Meanings: Click a subtitle word to see its translation and dictionary meaning, with nothing to set up; Explain with AI adds how it is used in its line, its culture, and its history, through your own OpenAI or Google Gemini key
- Performance Tuning: Configurable delay between subtitle translation requests
- Advanced Options: Exact values, limits, backup and restore, and a diagnostic report, shown on request
- Logging System: Detailed debugging with configurable log levels
- Official Subtitle Integration: Uses the show's own translation when it has one, each of its lines shown with the original line it belongs with

See also: `docs/en/platforms.md` and `docs/en/providers.md`.
