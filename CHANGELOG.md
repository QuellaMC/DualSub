# Changelog

All notable changes to DualSub will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0-beta.1] - 2026-09-02

### Changed

- Rebuilt the extension from the ground up in TypeScript on WXT with React 19, zod, and Vitest. Every cross-context message is a typed contract; each video gets exactly one player session whose listeners, timers, and requests end together.
- Netflix subtitle tracks are resolved through the player's own API instead of intercepting JSON parsing, which Netflix's 2026 player change had broken.
- Microsoft Translate uses Edge's tokenless `translatetext` endpoint; Microsoft retired the free auth endpoint in July 2026. Its settings id is now `microsoft_edge` and it is the default provider again.
- Language changes reload subtitles in place: the current line stays on screen behind a loading placeholder until the new languages arrive.
- AI analysis failures show the provider's own reason in the side panel.

### Added

- Clickable subtitle words with locale-aware segmentation (Chinese and Japanese split into words), selection sync with the side panel, and two-phase removal.
- Seeded upgrade-path, locale parity, and cold-start tests; coverage floors in CI; a release archive audit.

### Removed

- The v2 JavaScript tree, jest, the Vite build, and the in-page analysis modal. The last v2 state lives on the `v2-maintenance` branch.

### Fixed

- Disney+ native subtitles are hidden again inside the player's shadow tree.
- Provider requests carry only the configured credential, never browser cookies.
- The AI context rate limiter keeps its timestamps across service worker restarts.

## [2.5.0] - 2025-11-19

### ✨ Added

- **Unified AI Side Panel**: Migrated the AI Context Analysis modal into the new Side Panel interface. This provides a persistent, non-intrusive workspace for exploring cultural and linguistic context without obstructing the video playback.

### 🐛 Fixed

- **Side Panel Desync Edge Cases**:
    - Fixed an issue where deselecting words in the side panel or switching videos caused synchronization errors.
    - Implemented a "Single Source of Truth" architecture where the content script is the authoritative state holder.
    - Eliminated race conditions by removing optimistic updates from the side panel to the background.
- **Word Selection Order**:
    - Ensured that selected words always maintain their original sentence order (DOM order) in the side panel, even after deselection and re-selection.
- **Duplicate Event Listeners**:
    - Fixed a bug where `dualsub-word-selected` listeners were accumulating, causing multiple events for a single click. Added proper cleanup logic.

## [2.4.0] - 2025-09-30

### 🎉 Major Changes

- **Full React Migration**: Migrated popup and options pages to React
    - Modern component-based architecture
    - Improved maintainability and code organization
    - Better state management with React hooks
    - 100% functional parity with vanilla JavaScript version
    - Identical UI/UX experience

### ✨ Added

- React-based popup interface with custom hooks:
    - `useSettings` for settings management
    - `useTranslation` for i18n support
    - `useLogger` for error tracking
    - `useChromeMessage` for Chrome API integration
- React-based options page with modular sections:
    - `GeneralSection` for general preferences
    - `TranslationSection` for translation provider settings
    - `ProvidersSection` for provider management
    - `AIContextSection` for AI context configuration
    - `AboutSection` for extension information
- Reusable React components:
    - `SettingCard`, `ToggleSwitch`, `SettingToggle`
    - `LanguageSelector`, `SliderSetting`, `StatusMessage`
    - `TestResultDisplay`, `SparkleButton`
    - Provider cards for all translation services
- Custom hooks for advanced features:
    - `useDeepLTest` for DeepL API testing
    - `useOpenAITest` for OpenAI API testing and model fetching
    - `useBackgroundReady` for service worker status
- Vite build system for optimized production bundles

### 🔧 Changed

- Build system upgraded from vanilla JavaScript to Vite + React
- Popup and options pages now use React components
- All UI interactions now use React state management
- Settings updates use React hooks instead of direct DOM manipulation
- Translation loading uses React effects and state

### 🗑️ Removed

- Vanilla JavaScript popup.js and options.js files
- Old HTML templates (replaced by React JSX)
- Manual DOM manipulation code
- jQuery-style event listeners

### 📦 Dependencies

- Added `react` ^19.1.1
- Added `react-dom` ^19.1.1
- Added `vite` ^7.1.7
- Added `@vitejs/plugin-react` ^5.0.4

### 🐛 Fixed

- Container width consistency in options page across different tabs
- AI Context section structure now matches original layout exactly
- All i18n translation keys corrected to match message definitions
- Proper collapsible Advanced Settings in AI Context section

### 📝 Documentation

- Added comprehensive React migration documentation
- Updated README with React-based development information
- Added component architecture documentation
- Updated build and development instructions

### 🔬 Technical Details

- Bundle sizes (gzipped):
    - Popup: 13.47 kB (4.58 kB gzipped)
    - Options: 35.24 kB (8.41 kB gzipped)
    - Shared translations: 218.89 kB (66.52 kB gzipped)
- Build time: ~600ms
- Total React components: 25+
- Custom hooks: 7
- Zero functional differences from vanilla JS version

## [2.3.2] - Previous Version

- All previous features and functionality
- Vanilla JavaScript implementation

---

[2.4.0]: https://github.com/QuellaMC/DualSub/compare/v2.3.2...v2.4.0
