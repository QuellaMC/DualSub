# Privacy Policy for DualSub

**Last updated:** October 29, 2026

DualSub is an open-source Chrome extension that shows translated subtitles on Netflix and Disney+, looks up the subtitle words you click, and, with your own key, explains them with an AI service. DualSub has no server of its own and collects no analytics. This policy describes what the extension stores in Chrome and what it sends directly from your browser to third-party services to provide the features you use.

## What DualSub stores

DualSub uses Chrome's extension storage:

- **`chrome.storage.sync`** holds most preferences, such as languages, subtitle layout, the translation service, and side panel behavior. Chrome may sync them to other browsers signed in to the same Chrome profile.
- **`chrome.storage.local`** holds credentials: the DeepL API key, OpenAI-compatible and OpenAI keys, Gemini keys, and Vertex access tokens. It also holds the address each key was entered for, and a few settings for this device only. DualSub does not sync these. Chrome's local storage is not an encrypted vault, so protect access to your browser profile and remove credentials in the settings page when you no longer need them.
- **`chrome.storage.session`** holds two short-lived records, until the browser session ends:
    - When your translation service fails in a lasting way (a rejected key, a used-up quota, or refused requests): which service, which kind of problem, which service covered for it, and since when. The record holds no subtitle text or credentials, and is cleared as soon as that service works again or its settings change.
    - The times of recent AI explanation requests, to keep to the per-minute limit.
- **Memory**: translation, word lookup, and AI explanation results may stay in bounded, time-limited caches in the extension's service worker to avoid repeating requests. They are not sent to DualSub's developers and disappear when Chrome discards the worker.

A Vertex service-account JSON file is used once, in memory, to get a short-lived access token. Its private key is not stored; upgrading removes the key from storage if an older version saved it.

Uninstalling DualSub or clearing its data removes its settings and credentials. Removal of synced preferences also depends on Chrome Sync.

## What DualSub sends, and to whom

DualSub sends only what the feature you use needs, directly from your browser to the services named here.

### Subtitle files

To show subtitles, DualSub downloads the subtitle files of the video you are watching from the streaming service's own delivery network: `*.nflxvideo.net` for Netflix, and `*.media.dssott.com` and `*.dssedge.com` for Disney+.

### Subtitle translation

The translation service you choose receives the subtitle text and the source and target language codes:

- **Microsoft Translator** and **Google Translate** need no key. They use consumer endpoints that can change without notice, under Microsoft's and Google's own terms and privacy practices.
- **DeepL** (Free or Pro API) receives subtitle text when you set a DeepL API key.
- An **OpenAI-compatible service** receives subtitle text when you set its API key, address, and model.
- **Google Vertex AI** receives subtitle text when you set a Google Cloud project and access token.
- When your service fails (for example, it rejects the key or the quota is used up), Microsoft Translator and then Google Translate receive the subtitle text instead, until your service works again. Turn off **Keep translating if this service fails** in the settings page to keep subtitle text with your chosen service only.

DualSub sends subtitle text to no other translation service.

### Word lookup

Subtitle words can be clicked to look them up. This is on by default; **Look up words when I click them** in the settings page's Meanings section turns it off. Nothing is sent until you click a word. Then:

- your translation service receives the words you picked and their language, as for subtitle text;
- Google's dictionary (`translate.googleapis.com`) receives the same words and language codes, whichever translation service you chose, even with the fallback turned off;
- when Google has no entry or does not answer, Wikimedia's Wiktionary (`en.wiktionary.org`) receives the word and, for a word Wiktionary lists as a form of another, that other word. Its English definitions then go to your translation service to be translated.

### AI explanations

AI explanations need your own OpenAI or Google Gemini key; without one, nothing is sent. Only when you press **Explain with AI** in the side panel, the OpenAI-compatible or Gemini address you set receives:

- the subtitle words you picked and the subtitle line they appear in;
- the kinds of explanation you chose (meaning and use, culture, history);
- the line's language and your translation language.

### Custom addresses

The OpenAI and Gemini hosts are declared in the extension's manifest. Any other OpenAI-compatible HTTPS address needs an optional host permission, which Chrome asks you to grant only when you press **Allow API host**, or test the connection, in the settings page. Plain HTTP is allowed only for `localhost` and `127.0.0.1`. Granting an address lets DualSub talk to that host; read its operator's privacy policy before you grant it.

## Permissions

DualSub requests:

- `storage`, for preferences, credentials kept on this device, and the session records above;
- `activeTab`, to work with the active Netflix or Disney+ tab after you act;
- `sidePanel`, to show the meaning of the words you click, and AI explanations, in Chrome's side panel;
- host access to Netflix and Disney+, their subtitle hosts, and the built-in translation and AI hosts listed in `manifest.json` (Wiktionary needs none: it answers any site, and DualSub sends it no cookies);
- optional host access to a custom address, only after you grant it.

DualSub does not request the `scripting` permission.

## Sharing and retention

DualSub's developers do not receive or sell your subtitle text, settings, credentials, or AI answers. A third-party service processes what it receives, and may keep it, under its own terms, account settings, and privacy policy, which DualSub does not control:

- [Google Privacy Policy](https://policies.google.com/privacy)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
- [DeepL Privacy Policy](https://www.deepl.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Wikimedia Foundation Privacy Policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy)

For a custom OpenAI-compatible address, ask its operator.

## Your controls

You can:

- turn off subtitle translation or word lookup, and remove your AI key to stop AI explanations;
- change translation services at any time;
- remove API keys and tokens in the settings page;
- revoke optional site access in Chrome's extension settings;
- clear DualSub's data or uninstall it.

## Children's privacy

DualSub is a general-purpose subtitle tool and is not directed to children under 13. The project does not knowingly collect children's personal information.

## Changes

Material changes appear in this file and its "Last updated" date.

## Contact and source code

Questions and source code: [github.com/QuellaMC/DualSub](https://github.com/QuellaMC/DualSub)
