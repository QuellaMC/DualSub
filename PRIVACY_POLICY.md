# Privacy Policy for DualSub

**Last Updated:** 2025-08-04

## Overview

DualSub is a browser extension that displays dual-language subtitles on streaming platforms like Disney+ and Netflix. This privacy policy explains how we collect, use, and protect your information when you use our extension.

## Information We Collect

### Data Stored Locally in Your Browser Only

**Important:** All data listed below is stored only on your device in your browser's local storage. We do not collect, access, or transmit any of this information to our servers.

- **Your Extension Settings:**
    - Language preferences (which languages you want to translate to/from)
    - Subtitle display preferences (font size, position on screen, layout style)
    - Which translation service you prefer to use

- **Your Personal API Keys (If You Choose to Use Them):**
    - API keys for DeepL, OpenAI, or Google Gemini that YOU provide
    - These keys remain on YOUR device only - we never see or collect them
    - You can remove these keys at any time through the extension settings

- **Extension Configuration:**
    - Your choices for batch translation settings
    - Request delay preferences
    - AI context analysis options (if you enable this feature)

- **Temporary Performance Data:**
    - Recently translated subtitle text (cached temporarily to avoid re-translating the same content)
    - This cache is automatically cleared by your browser and improves extension speed

### Data Sent to Third-Party Services

When you use translation features, the following data may be sent to external services:

#### Translation Services

- **Subtitle Text:** Original subtitle content is sent to your selected translation provider (Google Translate, Microsoft Translator, DeepL, or OpenAI-compatible services)
- **Language Codes:** Source and target language information

#### AI Context Analysis (Optional)

- **Selected Text:** When you use the AI context feature, selected subtitle text is sent to AI providers (OpenAI or Google Gemini)
- **Context Requests:** Requests for cultural, historical, or linguistic analysis

## How We Use Your Information

### What Stays on Your Device

**We do not collect any personal information.** Here's what happens with your data:

- **Your Settings:** Stored only in your browser to remember your preferences
- **Translation Cache:** Temporarily saved on your device to make the extension faster
- **Your API Keys:** Remain on your device only - we never access or collect them
- **Extension Configuration:** Saved locally so your settings persist when you restart your browser

### Third-Party Service Integration

- Send subtitle text to translation services to provide dual-language functionality
- Send selected text to AI providers for context analysis (only when explicitly requested)
- All external API usage requires your explicit configuration and consent

## Data Sharing and Third Parties

### Translation Service Providers

We integrate with the following translation services:

- **Google Translate:** Free translation service
- **Microsoft Translator:** Free translation service via Microsoft Edge
- **DeepL:** Both free and API-based translation services
- **OpenAI-Compatible Services:** For advanced translation and AI context analysis

### AI Context Providers

- **OpenAI:** For AI-powered context analysis
- **Google Gemini:** For AI-powered context analysis

**Important:** We do not control the privacy practices of these third-party services. Please review their respective privacy policies:

- [Google Privacy Policy](https://policies.google.com/privacy)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
- [DeepL Privacy Policy](https://www.deepl.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)

## Data Storage and Security

### Your Data Security

- **Everything stays on your device:** All your settings, preferences, and API keys are stored only in your browser
- **We don't have servers collecting your data:** DualSub doesn't send your personal information, settings, or API keys to us
- **Your API keys are yours alone:** Any API keys you enter remain on your device and are never transmitted to DualSub developers

### Data Retention

- Translation cache is automatically cleared based on browser storage limits
- User settings persist until you uninstall the extension or clear browser data
- No data is retained on external servers by DualSub

## User Control and Consent

### Required Permissions

The extension requires the following permissions:

- **activeTab:** To access streaming platform content for subtitle processing
- **storage:** To save your preferences and cache translations
- **scripting:** To inject subtitle functionality into streaming platforms
- **Host permissions:** To access streaming platforms and translation APIs

### Optional Features

- **AI Context Analysis:** Requires explicit user consent and configuration
- **External API Usage:** All third-party API usage requires user-provided API keys and explicit setup

### User Rights

You can:

- Disable any feature at any time through the extension settings
- Clear cached data through browser settings
- Remove API keys from the extension settings
- Uninstall the extension to remove all local data

## Children's Privacy

DualSub does not knowingly collect personal information from children under 13. The extension is designed for general use and does not target children specifically.

## Changes to This Privacy Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this policy. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Data Processing Legal Basis

For users in the European Union, our legal basis for processing data is:

- **Consent:** For optional AI context analysis features
- **Legitimate Interest:** For core subtitle translation functionality
- **Contract Performance:** To provide the extension services you've requested

## Contact Information

If you have questions about this privacy policy or our data practices, please contact us at:

- **GitHub:** https://github.com/QuellaMC/DualSub

## Open Source

DualSub is open source software. You can review our code and data handling practices at our GitHub repository: https://github.com/QuellaMC/DualSub

---

**Note:** This extension processes subtitle data locally and only sends data to third-party services that you explicitly configure. We are committed to transparency and user privacy in all our data handling practices.
