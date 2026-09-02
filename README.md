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
Translation Provider: Google Translate (Free)
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
- **Google Chrome** with Developer mode enabled
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
    # Verify formatting without changing files
    npm run format:check

    # Linting
    npm run lint

    # Testing
    npm test
    npm run test:watch

    # Production build and extension-package validation
    npm run build
    npm run verify:build
    ```

3. **Load Extension for Testing**
    - Follow manual installation steps above
    - Reload extension after making changes

### Project Structure

```
DualSub/
├── content_scripts/     # Platform-specific content scripts
├── translation_providers/ # Translation service implementations
├── services/           # Core services (config, logging)
├── popup/             # Extension popup interface
├── options/           # Advanced settings page
├── sidepanel/         # AI analysis side panel
├── utils/             # Shared utilities
├── test-utils/        # Testing infrastructure
├── _locales/          # Internationalization files
└── icons/             # Extension icons
```

## 🏗️ Architecture

DualSub uses a modern, modular architecture built on several key design patterns:

### Core Architecture

- **📐 Template Method Pattern**: `BaseContentScript` provides common functionality with platform-specific implementations
- **🔌 Dependency Injection**: Dynamic module loading for better testability and loose coupling
- **📡 Event-Driven Design**: Extensible message handling with action-based routing
- **🧹 Resource Management**: Comprehensive cleanup system preventing memory leaks

### Key Components

- **Content Scripts**: Platform-specific implementations extending `BaseContentScript`
- **Translation Providers**: Modular translation services with explicit retry and provider selection
- **Configuration Service**: Centralized settings management with validation
- **Logging System**: Cross-context logging with configurable levels

For detailed technical documentation, see:

- [Architecture Overview](content_scripts/ARCHITECTURE.md)
- [API Reference](content_scripts/API_REFERENCE.md)
- [Platform Implementation Guide](content_scripts/PLATFORM_IMPLEMENTATION_GUIDE.md)

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Code Standards

- **ESLint + Prettier**: Code must pass linting and formatting checks
- **ES Modules**: Use modern JavaScript module syntax
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

1. Create provider in `translation_providers/` directory
2. Implement `async function translate(text, sourceLang, targetLang)`
3. Register it in `background/services/translationService.js` and the shared provider constants
4. Update the React popup/options section or provider card that exposes it
5. Add comprehensive tests

#### New Streaming Platforms

1. Extend `BaseContentScript` class
2. Implement required abstract methods
3. Create platform-specific configuration
4. Update `manifest.json` content scripts
5. Add platform tests

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

# Run specific test file
npm test -- background.test.js

# Run tests with coverage
npm run test:coverage
```

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component functionality
- **Mock Infrastructure**: Chrome API and DOM mocking
- **Test Utilities**: Shared testing helpers and fixtures

### Testing Guidelines

- **Coverage**: Keep the enforced coverage ratchet green and add focused regressions for changed behavior
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

### Version 2.5.0 (Current)

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
