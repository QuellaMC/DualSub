# DualSub - Dual Language Subtitles for Streaming

<p align="center">
  <img src="assets/images/logo1400x560.png" alt="DualSub" width="600" />
</p>

[中文版 | Chinese Version](README_zh.md)

![Version](https://img.shields.io/github/v/release/QuellaMC/DualSub.svg)
![Last Commit](https://img.shields.io/github/last-commit/QuellaMC/DualSub.svg)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)
![Manifest](https://img.shields.io/badge/Manifest-v3-blue.svg)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/QuellaMC/DualSub)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/lnkcpcbpjbidpjdjnmjdllpkgpocaikj?label=Chrome%20Web%20Store)](https://chrome.google.com/webstore/detail/lnkcpcbpjbidpjdjnmjdllpkgpocaikj)

**DualSub** is a powerful Chrome extension that enhances your streaming experience by displaying dual language subtitles simultaneously. Perfect for language learning, accessibility, or simply enjoying content in multiple languages at once.

## 📚 Documentation

- [Features](docs/en/features.md)
- [Supported Platforms](docs/en/platforms.md)
- [Translation Providers](docs/en/providers.md)
- [AI Context Analysis](docs/en/ai-context.md)
- [Installation](docs/en/installation.md)
- [Configuration](docs/en/configuration.md)

## 📋 Table of Contents

- [Documentation](#-documentation)
- [Highlights](#-highlights)
- [Installation & Quick Start](#-installation--quick-start)
- [Development Setup](#-development-setup)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [Testing](#-testing)
- [License](#-license)
- [Changelog](#-changelog)

## ✨ Highlights

- Dual subtitles on Netflix and Disney+
- Multiple translation providers with rate limiting and caching
- AI Context Analysis (OpenAI, Google Gemini)
- Flexible layouts, appearance controls, and timing offset
- Multi-language UI (EN, ES, JA, KO, ZH-CN, ZH-TW)

See details in: [features.md](docs/en/features.md), [platforms.md](docs/en/platforms.md), [providers.md](docs/en/providers.md).

## 📦 Installation & Quick Start

1. Install from the Chrome Web Store or load unpacked (see [installation.md](docs/en/installation.md)).
2. Open Netflix or Disney+ and enable subtitles.
3. Click the DualSub icon → enable dual subtitles and choose target language.
4. Optional: Configure AI Context (provider, API key, model) in Advanced Settings.

Configuration reference: [configuration.md](docs/en/configuration.md). AI docs: [ai-context.md](docs/en/ai-context.md).

### Configuration Examples

**For Language Learning:**

```
Translation Provider: Microsoft Translate (Free)
Layout: Top/Bottom
Display Order: Original First
Font Size: Large
AI Context: Enabled (OpenAI GPT-5.6 Luna)
Context Types: Cultural, Historical, Linguistic
```

**For Performance:**

```
Request Delay: 100ms
Translation Provider: Google Translate
AI Context: Enabled (Google Gemini Flash)
Context Cache: Enabled
```

**For Advanced Users:**

```
Translation Provider: OpenAI Compatible
AI Context Provider: OpenAI GPT-5.6 Luna
Context Types: All
Rate Limit: 60 requests/minute
Cache TTL: 1 hour
Debug Logging: Enabled
```

## 🛠️ Development Setup

### Prerequisites

- **Node.js** 24 LTS and npm 11+
- **Google Chrome** 116+ with Developer mode enabled
- **Git** for version control

### Setup Instructions

1. **Clone and Install**

    ```bash
    git clone https://github.com/QuellaMC/DualSub.git
    cd DualSub
    npm ci
    ```

2. **Development Commands**

    ```bash
    # Type-check, lint, and verify formatting
    npm run compile
    npm run lint
    npm run format:check

    # Tests: once, in watch mode, or with the enforced coverage floors
    npm test
    npm run test:watch
    npm run test:coverage

    # Production build, release archive, and archive audit
    npm run build
    npm run zip
    npm run verify:release
    ```

3. **Load Extension for Testing**
    - Run `npm run build` (or `npm run dev` to rebuild on every change)
    - Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `.output/chrome-mv3`
    - Reload the extension after each build

### Project Structure

```
DualSub/
├── src/
│   ├── entrypoints/    # Background worker, content scripts, popup, options, side panel
│   ├── background/     # Subtitle pipeline, translation, AI context, side panel authority
│   ├── content/        # Page bridge, player sessions, renderer, selection, platform adapters
│   ├── messaging/      # Cross-context contracts, router, client, sender authentication
│   ├── config/         # Settings schema, storage service, migrations
│   ├── shared/         # Logger, fetch hardening, provider constants
│   ├── ui/             # React popup, options, side panel, shared hooks
│   ├── build/          # Manifest golden snapshot and locale parity tests
│   └── test-utils/     # Test helpers
├── public/             # Locale catalogs and icons
├── scripts/            # Release verification
├── docs/               # User documentation (en, zh) and reference material
└── wxt.config.ts       # Manifest and build configuration (WXT)
```

## 🏗️ Architecture

DualSub 3 is a TypeScript extension built with WXT, React 19, zod, and Vitest.

### Core Architecture

- **One session per video**: the content orchestrator keeps exactly one player session for the video on the current route, and every listener, timer, and request of a session ends with one abort signal
- **Page bridge**: a declaratively registered main-world script reads subtitle tracks from the platform's own player and talks to the isolated world over a message channel
- **Contract-first messaging**: every cross-context message is a zod contract; the router snapshots the payload, authenticates the sender, gates by role, and parses before a typed handler runs
- **Background services**: a subtitle pipeline with a CDN allowlist and byte caps, a translation service with per-provider pacing and caching, a fail-closed AI context service, and a side panel authority that keeps the content script the single source of selection truth

### Key Components

- **Platform adapters** (`src/content/platform/`): Netflix and Disney+ specifics behind one interface
- **Translation providers** (`src/background/translation/providers/`): one error taxonomy and one pacing seam for every provider
- **Configuration service** (`src/config/`): typed settings schema, strict reads, credentials kept device-local, idempotent migrations
- **Side panel** (`src/ui/sidepanel/`, `src/background/sidepanel/`): selection sync with two-phase removal

Reference material: [audit report](docs/reference/pr62-audit-report.html), [smoke protocol](docs/reference/smoke-protocol.md), [store review notes](docs/reference/store-review-notes.md).

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Code Standards

- **ESLint + Prettier**: Code must pass linting and formatting checks
- **TypeScript strict**: no `any`, exact message contracts, typed settings
- **Testing**: All new features require comprehensive tests
- **Documentation**: Update relevant documentation for changes

### Development Workflow

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Write** tests for your changes
4. **Ensure** all tests pass (`npm test`)
5. **Format** code (`npm run format`)
6. **Lint** code (`npm run lint:fix`)
7. **Commit** changes (`git commit -m 'Add amazing feature'`)
8. **Push** to branch (`git push origin feature/amazing-feature`)
9. **Open** a Pull Request

### Adding New Features

#### New Translation Providers

1. Add a provider module under `src/background/translation/providers/` implementing `TranslationProvider`
2. Register it in `providers/index.ts` and add its id to `PROVIDER_IDS` in `src/shared/providers.ts`
3. Add its options card under `src/ui/options/providers/` and its strings to every catalog in `public/_locales/`
4. Add tests next to the module

#### New Streaming Platforms

1. Add a platform under `src/content/platform/` with a descriptor and an adapter
2. Declare its content scripts in `src/entrypoints/`
3. Extend the subtitle policy and parsers in `src/background/subtitle/` for its CDN
4. Update the golden manifest in `src/build/manifest.golden.json` in a commit that explains the change
5. Run the smoke protocol on the platform

### Code Review Process

- All submissions require review
- Tests must pass CI/CD pipeline
- Documentation must be updated
- Breaking changes require discussion

## 🧪 Testing

DualSub includes a comprehensive testing framework:

### Running Tests

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Run one directory or file
npm test -- src/config

# Run tests with coverage
npm run test:coverage
```

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component functionality
- **Mock Infrastructure**: fake-browser for extension APIs, happy-dom for UI
- **Test Utilities**: Shared testing helpers and fixtures

### Testing Guidelines

- **Coverage**: Keep the enforced coverage floors green and add focused regressions for changed behavior
- **Isolation**: Tests should not depend on each other
- **Mocking**: Use provided mocks for Chrome APIs
- **Assertions**: Clear, descriptive test assertions

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)**.

[![CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png)](http://creativecommons.org/licenses/by-nc-sa/4.0/)

### License Summary

- ✅ **Share**: Copy and redistribute the material
- ✅ **Adapt**: Remix, transform, and build upon the material
- ❌ **Commercial Use**: Not permitted
- 📝 **Attribution**: Must give appropriate credit
- 🔄 **ShareAlike**: Must distribute under same license

For full license terms, see [LICENSE](LICENSE) file.

## 📋 Changelog

### Version 3.0.1 (Current)

- 🐛 The side panel keeps a tab's selected words, running analysis, and answer while you visit other tabs and come back

### Version 3.0.0

- 🏗️ **Rebuilt from the ground up** in TypeScript on WXT, with contract-first messaging and one player session per video
- 🎬 **Netflix player API**: subtitle tracks come from the player itself, so DualSub keeps working after Netflix's 2026 player change
- 🌐 **Microsoft Translate** moved to Edge's tokenless endpoint after Microsoft retired the free auth endpoint
- 🤖 **Side panel**: clickable words, selection sync, and AI analysis with the failure reason shown in the panel
- 🔒 Credentials never leave the device, provider requests carry no browser cookies, and the AI rate limiter survives worker restarts

### Version 2.5.0

- 🤖 **Unified AI Experience**: Integrated AI Context Analysis into the Side Panel for a seamless, persistent workspace.
- 🐛 **Stability Improvements**: Fixed desync issues when switching videos or deselecting words in the side panel.
- ✨ **Better UX**: Improved word selection ordering to always match sentence structure.

### Version 2.4.0

- 🎉 **Full React Migration**: Popup and options pages migrated to React with 100% functional parity
- ✨ Modern component-based architecture with custom hooks
- 📦 Vite build system for optimized production bundles
- 🐛 Fixed container width consistency and i18n translation keys
- 📝 Comprehensive migration documentation

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

### Version 2.3.2

- Messaging reliability: Refactored messaging utilities to support both callback- and promise-style chrome.runtime.sendMessage, with wake-up retries for MV3 service worker.
- Unified resilient message sending across platform adapters (BasePlatformAdapter + Netflix), improving background communication stability and test determinism.
- AI Context: Provider metrics now correctly reflect success/error; tests updated to tolerate callback/promise messaging; dynamic chrome access prevents stale mocks between tests.
- Internal refactors and stability improvements.

### Version 2.3.1

- 🧠 Netflix next-episode preload-aware subtitles: buffers subtitle tracks detected before navigation and applies them immediately after SPA route change to the next episode, fixing cases where subtitles did not update on Next Episode.
- 🧩 Universal improvement: content script now notifies the platform on URL changes, laying the groundwork for cross-platform preload handling.

### Version 2.3.0

- 🛠️ Netflix soft navigation fix: Resolves issue where moving to the next episode (SPA navigation) could continue showing previous episode subtitles. Subtitles now reset and rebind to the new video context.
- 🎯 Disney+ progress bar update: Adjusted detection to the updated site UI; timing now reads directly from the progress-bar web component’s shadow DOM via aria attributes for accurate sync.

### Version 2.2.0

- 🧩 Modularized documentation with English and Chinese docs under `docs/`
- 🧭 AI Context UI/UX refinements (modal, transitions, selection persistence)
- 🧹 Internal refactors and minor fixes

### Version 2.1.0

- 📍 Added vertical position control for precise subtitle placement on screen
- 🎨 Enhanced appearance customization with new positioning options
- ⚙️ Improved user interface with vertical position slider control

### Version 2.0.0

- 🤖 **NEW**: AI Context Analysis feature with OpenAI and Google Gemini support
- 🎯 Interactive subtitle text selection with cultural, historical, and linguistic explanations
- 🔑 Comprehensive API key management and provider configuration
- 🧠 Advanced caching and rate limiting for AI context requests

### Version 1.4.0

- ✨ Added Netflix support with official subtitle integration
- 🔄 Implemented multiple selectable translation providers with bounded retries
- 🌐 Added multi-language UI support (6 languages)
- ⚙️ Introduced advanced options page
- 🏗️ Refactored architecture with Template Method pattern
- 🧪 Added comprehensive testing framework
- 📊 Implemented configurable logging system
- 🔧 Enhanced configuration management

### Previous Versions

_For detailed version history, see [GitHub Releases](https://github.com/QuellaMC/DualSub/releases)_

---

## 📞 Support & Community

- **🐛 Bug Reports**: [GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
- **💡 Feature Requests**: [GitHub Discussions](https://github.com/QuellaMC/DualSub/discussions)
- **📖 Documentation**: [Wiki](https://github.com/QuellaMC/DualSub/wiki)

---

**⚠️ Disclaimer**: This extension is not officially affiliated with Netflix, Disney+, or any streaming platform. All trademarks belong to their respective owners.
