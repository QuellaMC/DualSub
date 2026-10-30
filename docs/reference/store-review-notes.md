# Chrome Web Store review notes

What the reviewer sees in 3.0.0 and why. Keep this in step with
`wxt.config.ts` and `src/build/manifest.golden.json`.

## Purpose

DualSub shows two subtitle languages at once on Netflix and Disney+. It
reads the subtitle track the platform already serves, translates it with
the provider the user chose, and draws both lines over the video. Clicking
a subtitle word opens a side panel with its translation and dictionary
meaning; with the user's own OpenAI or Gemini key, the panel can also
explain the word as it is used in its line.

## Permissions

- `storage`: user settings; provider credentials stay in `chrome.storage.local`
  and never sync. A failing translation service's record (the service, the
  kind of problem, the covering service, and the time; no subtitle text or
  credentials) stays in `chrome.storage.session` until that service works
  again, its settings change, or the browser session ends.
- `activeTab`: the popup reads which site the current tab is on, to edit
  that site's settings and say whether DualSub is serving a video there.
- `sidePanel`: the word panel: the meaning of the subtitle words the user
  clicked, and an AI explanation when asked for. It opens only from the
  user's click on a subtitle word.
- Host permissions: the two platforms, their subtitle CDNs
  (`media.dssott.com`, `dssedge.com`, `nflxvideo.net`), and the translation
  and AI endpoints the extension can be configured with. Subtitle fetches
  go through an allowlist with byte caps; the extension is not a proxy.
  Wiktionary's REST API (`en.wiktionary.org`) needs no host permission: it
  answers any origin (`Access-Control-Allow-Origin: *`), and the request
  carries no credentials.
- Optional host permissions: a user-supplied OpenAI-compatible endpoint is
  requested from an explicit click on the options page and can be revoked
  there.

## Content scripts

- One isolated-world script per platform draws the overlay and manages
  sessions.
- One main-world script per platform, declared statically in the manifest,
  reads the subtitle track list, the language of the audio playing, and the
  profile's subtitle appearance settings from the platform's own player
  object and passes them to the
  isolated world over a `MessageChannel`. It injects no remote code and
  exposes nothing to the page.
- No `web_accessible_resources`.

## Data flows

- Subtitle text goes to the translation provider the user selected. Google
  and Microsoft need no account; DeepL, OpenAI-compatible, and Vertex AI use
  the user's own credentials. When the selected provider fails, Microsoft
  and then Google translate instead, unless the user turned that fallback
  off.
- An API key for an address the user sets (OpenAI-compatible translation,
  OpenAI explanations in the word panel) is stored with the origin it was entered for
  and sent only there. An address changed on another synced device or by
  loading a settings backup leaves the key unused until the user enters
  one for the new address.
- While "Look up words when I click them" is on (the default), the words
  the user clicks go to the selected translation provider, and to Google's
  dictionary (`translate.googleapis.com`, `dt=bd`) whichever provider is
  selected. When Google has no entry, the word goes to Wiktionary, and the
  English definitions it returns go to the translation provider. Nothing
  is sent before a click.
- With an OpenAI or Gemini key saved, "Explain with AI" in the panel sends
  the clicked words, the subtitle line they appear in, the chosen kinds of
  explanation, and the two languages to that endpoint. A saved key is what
  enables it: before every request, and again before an answer is shown,
  the background re-reads the stored key with a strict read and sends or
  shows nothing when the read fails or the key is missing.
- No analytics, no remote configuration, no data sent to the developer.

## Changes since 2.5.0

- The extension was rebuilt in TypeScript; permissions are unchanged except
  for the removal of `api.cognitive.microsofttranslator.com`.
- `web_accessible_resources` were removed entirely.
- The in-page analysis modal was removed; the side panel is the only AI UI.
- Subtitle words are clickable by default and the side panel shows their
  dictionary meaning, which adds Google's dictionary and Wiktionary as data
  recipients (declared above). AI explanations have no switch of their
  own: a saved key enables them.
- On install, and only then, the extension opens its own welcome page
  (`welcome.html`, packaged with the extension) in a new tab. It shows the
  languages DualSub picked and lets the user change the translation
  language; it loads nothing remote.

## How to test

1. Install: the welcome page opens with the browser's language as the
   translation language, or English when DualSub offers none of the
   browser's languages. Nothing else needs setting up.
2. Sign in to Netflix or Disney+ and open any title.
3. Play: two subtitle lines appear (one, for a video already in the
   translation language). In the options page's Languages section, toggle
   "Use the show's own translation" to switch between the
   platform's own translation track and the provider.
4. Click a subtitle word: the side panel opens with the word selected, its
   translation, and a dictionary entry.
5. Optional: press "Explain with AI", paste an OpenAI or Gemini API key in
   the steps it shows, and press "Check and explain": an explanation of the
   word as used in its line appears.
