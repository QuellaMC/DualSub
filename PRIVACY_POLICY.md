# Privacy Policy for DualSub

**Last updated:** July 11, 2026

## Overview

DualSub is an open-source Chrome extension that displays translated subtitles on Netflix and Disney+ and, when enabled, can analyze selected subtitle text with an AI provider. DualSub does not operate a developer-owned analytics or data-collection server. This policy describes what Chrome stores and what the extension sends directly to third-party providers to deliver the features you request.

## Data stored by the extension

DualSub uses the Chrome extension storage APIs:

- Most non-sensitive preferences, such as languages, subtitle layout, provider choice, and side-panel behavior, use `chrome.storage.sync`. Chrome may synchronize these preferences to other Chrome browsers signed in to the same profile.
- Provider credentials (`deeplApiKey`, OpenAI-compatible and AI-context API keys, Gemini API keys, and Vertex access tokens) use `chrome.storage.local`, so DualSub does not sync them between devices. Chrome extension local storage is not an encrypted secret vault; protect access to your browser profile and remove credentials in Options when no longer needed.
- A Vertex service-account JSON file is used once in memory to obtain a short-lived access token. The service-account private key is not persisted. Upgrades remove the legacy stored-key value if an older version created one.
- Translation and AI-context results may be held temporarily in the extension service worker's in-memory caches to reduce repeated requests. These bounded, time-limited caches are not sent to DualSub's developers and disappear when the worker/browser state is discarded.

Uninstalling the extension or clearing its extension data removes its stored settings and credentials. Synced preference removal is also subject to Chrome Sync behavior.

## Data sent to third-party providers

DualSub sends only the content needed for the selected feature directly from your browser to the provider you choose.

To display subtitles, the extension downloads subtitle manifests and files from the streaming services' delivery networks. Netflix currently serves these files from `*.nflxvideo.net`, and Disney+ currently serves them from `*.media.dssott.com`. These requests retrieve the subtitle data already associated with the video you are watching; they are not sent to DualSub's developers.

### Subtitle translation

The selected provider receives subtitle text plus source/target language codes:

- Google Translate and Microsoft Edge translation are best-effort, no-key integrations that use consumer/internal endpoints. They may change without notice and are governed by the providers' terms and privacy practices.
- DeepL API Free or Pro receives subtitle text when you configure a DeepL API key.
- OpenAI-compatible services receive subtitle text when you configure an API key, endpoint, and model.
- Vertex AI receives subtitle text when you configure a Google Cloud project and short-lived access token.

The removed unofficial DeepL scraping/MyMemory fallback is not part of the extension.

### AI context analysis

AI context is disabled by default. When you enable it and request analysis, the configured OpenAI or Google Gemini endpoint receives:

- the subtitle words or phrase you selected;
- the context types you selected (cultural, historical, and/or linguistic);
- language information and limited surrounding subtitle context used to interpret the selection.

DualSub does not send AI-context requests until you enable the feature, configure the provider, and select subtitle text.

### Custom endpoints

The built-in OpenAI and Gemini hosts are declared in the extension manifest. A custom OpenAI-compatible HTTPS endpoint requires an optional host permission that Chrome asks you to grant from an explicit Options action. Loopback HTTP is allowed only for `localhost` or `127.0.0.1` development endpoints. Granting an endpoint allows the extension to communicate with that host; review the endpoint operator's privacy policy before granting access.

## Permissions

The current Manifest V3 extension requests:

- `storage` to save preferences and device-local credentials;
- `activeTab` to interact with the active supported streaming tab after a user action;
- `sidePanel` to show AI analysis in Chrome's side panel;
- host access for Netflix and Disney+ pages, their narrow subtitle-delivery hosts, and the built-in translation/AI API hosts listed in `manifest.json`;
- optional host access for a custom provider only after the user grants that origin.

DualSub does not request the `scripting` permission.

## Sharing, retention, and provider policies

DualSub's developers do not receive or sell your subtitle text, settings, credentials, or AI responses. Data sent to a third-party provider is processed and may be retained under that provider's own terms, account settings, and privacy policy. DualSub does not control those practices:

- [Google Privacy Policy](https://policies.google.com/privacy)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
- [DeepL Privacy Policy](https://www.deepl.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)

For a custom OpenAI-compatible endpoint, consult the endpoint operator directly.

## Your controls

You can:

- disable subtitle translation or AI context analysis;
- change providers at any time;
- remove API keys and tokens in Options;
- revoke optional site access in Chrome's extension settings;
- clear extension data or uninstall DualSub.

## Children's privacy

DualSub is a general-purpose subtitle tool and is not directed to children under 13. The project does not knowingly collect children's personal information.

## Policy changes

Material changes will be reflected in this file and its “Last updated” date.

## Contact and source code

Questions and source-code review: [github.com/QuellaMC/DualSub](https://github.com/QuellaMC/DualSub)
