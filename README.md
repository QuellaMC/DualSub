# DualSub - Dual Language Subtitles for Streaming

[中文版 | Chinese Version](README_zh.md)

![Version](https://img.shields.io/github/v/release/QuellaMC/DualSub.svg)
![Last Commit](https://img.shields.io/github/last-commit/QuellaMC/DualSub.svg)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)
![Manifest](https://img.shields.io/badge/Manifest-v3-blue.svg)

**DualSub** is a powerful Chrome extension that enhances your streaming experience by displaying dual language subtitles simultaneously. Perfect for language learning, accessibility, or simply enjoying content in multiple languages at once.

## 📋 Table of Contents

- [Features](#-features)
- [Supported Platforms](#-supported-platforms)
- [Translation Providers](#-translation-providers)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Development Setup](#-development-setup)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [Testing](#-testing)
- [License](#-license)
- [Changelog](#-changelog)

## ✨ Features

### Core Functionality

- **🎬 Dual Subtitle Display**: Show original and translated subtitles simultaneously
- **🌐 Multi-Platform Support**: Works on Netflix and Disney+ with platform-specific optimizations
- **🔄 Multiple Translation Providers**: Choose from Google, Microsoft, DeepL, and OpenAI-compatible services
- **🎯 Smart Translation**: Automatic fallback between providers and intelligent batching

### Customization Options

- **📐 Flexible Layouts**: Vertical (top/bottom) or horizontal (left/right) subtitle arrangements
- **🎨 Appearance Control**: Adjustable font sizes, spacing, and display order
- **⏱️ Timing Precision**: Fine-tune subtitle synchronization with offset controls
- **🌍 Multi-Language UI**: Interface available in 6 languages (EN, ES, JA, KO, ZH-CN, ZH-TW)

### Advanced Features

- **⚙️ Performance Tuning**: Configurable batch sizes and request delays for optimal performance
- **🔧 Advanced Options**: Comprehensive settings page with provider-specific configurations
- **📊 Logging System**: Detailed debugging with configurable log levels
- **🔄 Official Subtitle Integration**: Use platform's native subtitles when available (Netflix)

## 🎯 Supported Platforms

| Platform    | Status          | Features                                                |
| ----------- | --------------- | ------------------------------------------------------- |
| **Netflix** | ✅ Full Support | Official subtitle integration, SPA navigation detection |
| **Disney+** | ✅ Full Support | M3U8 playlist parsing, video detection                  |

### Platform-Specific Features

- **Netflix**: Enhanced SPA navigation detection, official translation support
- **Disney+**: Advanced M3U8 subtitle extraction, multiple URL pattern support

## 🔄 Translation Providers

| Provider                | Type | Quality    | Setup Required | Notes                             |
| ----------------------- | ---- | ---------- | -------------- | --------------------------------- |
| **DeepL Free**          | Free | ⭐⭐⭐⭐⭐ | None           | Recommended default, high quality |
| **Google Translate**    | Free | ⭐⭐⭐⭐   | None           | Fast, wide language support       |
| **Microsoft Translate** | Free | ⭐⭐⭐⭐   | None           | Good performance, reliable        |
| **DeepL API**           | Paid | ⭐⭐⭐⭐⭐ | API Key        | Highest quality, usage limits     |
| **OpenAI Compatible**   | Paid | ⭐⭐⭐⭐⭐ | API Key        | Supports Gemini models            |

### Provider Features

- **Automatic Fallback**: Seamlessly switches between providers if one fails
- **Rate Limiting**: Intelligent request management to avoid API limits
- **Batch Processing**: Optimized translation of multiple subtitle segments

## 📦 Installation

### Option 1: Manual Installation (Recommended for Development)

1. **Download the Extension**

    ```bash
    git clone https://github.com/QuellaMC/DualSub.git
    cd DualSub
    ```

2. **Install Dependencies** (for development)

    ```bash
    npm install
    ```

3. **Load in Chrome**
    - Open Chrome and navigate to `chrome://extensions`
    - Enable "Developer mode" (toggle in top-right corner)
    - Click "Load unpacked"
    - Select the `DualSub` directory

4. **Verify Installation**
    - The DualSub icon should appear in your Chrome toolbar
    - Visit Netflix or Disney+ to test functionality

### Option 2: Chrome Web Store (Coming Soon)

_The extension will be available on the Chrome Web Store in a future release._

## 🚀 Quick Start

1. **Install the Extension** following the instructions above
2. **Visit a Supported Platform** (Netflix or Disney+)
3. **Start Playing a Video** with subtitles enabled
4. **Click the DualSub Icon** in your toolbar to open settings
5. **Enable Dual Subtitles** and select your target language
6. **Enjoy!** Original and translated subtitles will appear simultaneously

### First-Time Setup Tips

- Start with **DeepL Free** provider (default) for best quality
- Use **Top/Bottom layout** for easier reading
- Adjust **font size** and **gap** for optimal viewing
- Enable **hide official subtitles** to avoid overlap

## ⚙️ Configuration

### Popup Settings (Quick Access)

Click the DualSub icon in your toolbar to access:

- **🔄 Enable/Disable**: Toggle dual subtitle functionality
- **🌐 Translation Provider**: Choose your preferred translation service
- **🎯 Target Language**: Select translation language from 50+ options
- **📐 Layout Options**: Top/Bottom or Left/Right arrangement
- **🎨 Appearance**: Font size, spacing, and display order
- **⏱️ Timing**: Subtitle offset adjustment (±10 seconds)

### Advanced Options Page

Access via popup → "Advanced Settings" for:

#### General Settings

- **🌍 UI Language**: Choose interface language (EN, ES, JA, KO, ZH-CN, ZH-TW)
- **👁️ Hide Official Subtitles**: Remove platform's native subtitles
- **📊 Logging Level**: Control debug information (Off/Error/Warn/Info/Debug)

#### Translation Settings

- **🔧 Provider Configuration**: API keys for premium services
- **⚡ Performance Tuning**: Batch size (1-10) and request delay (50-1000ms)
- **🔄 Provider Testing**: Test API connections before use

#### Provider-Specific Settings

- **DeepL API**: API key and plan selection (Free/Pro)
- **OpenAI Compatible**: API key, base URL, and model configuration

### Configuration Examples

**For Language Learning:**

```
Provider: DeepL Free
Layout: Top/Bottom
Display Order: Original First
Font Size: Large
```

**For Performance:**

```
Batch Size: 5
Request Delay: 100ms
Provider: Google Translate
```

## 🛠️ Development Setup

### Prerequisites

- **Node.js** 18+ and npm
- **Google Chrome** with Developer mode enabled
- **Git** for version control

### Setup Instructions

1. **Clone and Install**

    ```bash
    git clone https://github.com/QuellaMC/DualSub.git
    cd DualSub
    npm install
    ```

2. **Development Commands**

    ```bash
    # Code formatting
    npm run format

    # Linting
    npm run lint
    npm run lint:fix

    # Testing
    npm test
    npm run test:watch
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
- **Translation Providers**: Modular translation services with automatic fallback
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
3. Add to `background.js` providers object
4. Update `popup/popup.js` and `options/options.js`
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
npm test -- --coverage
```

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component functionality
- **Mock Infrastructure**: Chrome API and DOM mocking
- **Test Utilities**: Shared testing helpers and fixtures

### Testing Guidelines

- **Coverage**: Aim for >80% code coverage
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

### Version 1.5.0 (Current)

- 🚀 Implemented universal batch translation system for improved performance
- ⚡ Added provider-specific batch size optimization (80-90% reduction in API calls)
- 🔧 Enhanced translation efficiency with intelligent batching and delimiter approach
- 📊 Improved subtitle processing with configurable batch sizes and concurrent processing

### Version 1.4.0

- ✨ Added Netflix support with official subtitle integration
- 🔄 Implemented multiple translation providers with fallback
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
