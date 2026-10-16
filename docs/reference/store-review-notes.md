# Chrome Web Store review notes

What the reviewer sees in 3.0.0 and why. Keep this in step with
`wxt.config.ts` and `src/build/manifest.golden.json`.

## Purpose

DualSub shows two subtitle languages at once on Netflix and Disney+. It
reads the subtitle track the platform already serves, translates it with
the provider the user chose, and draws both lines over the video. An
optional side panel explains selected words through the user's own AI
provider account.

## Permissions

- `storage`: user settings; provider credentials stay in `chrome.storage.local`
  and never sync. A failing translation service's record (the service, the
  kind of problem, the covering service, and the time; no subtitle text or
  credentials) stays in `chrome.storage.session` until that service works
  again, its settings change, or the browser session ends.
- `activeTab`: the popup reads which site the current tab is on, to edit
  that site's settings and say whether DualSub is serving a video there.
- `sidePanel`: the AI analysis panel. It opens only from the user's click on
  a subtitle word.
- Host permissions: the two platforms, their subtitle CDNs
  (`media.dssott.com`, `dssedge.com`, `nflxvideo.net`), and the translation
  and AI endpoints the extension can be configured with. Subtitle fetches
  go through an allowlist with byte caps; the extension is not a proxy.
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
  OpenAI word explanations) is stored with the origin it was entered for
  and sent only there. An address changed on another synced device or by
  loading a settings backup leaves the key unused until the user enters
  one for the new address.
- With Word explanations (AI context) enabled, the words the user clicked (and the target
  language) go to the user's configured OpenAI or Gemini endpoint. The
  feature is off by default and re-checks its stored enablement before
  every request.
- No analytics, no remote configuration, no data sent to the developer.

## Changes since 2.5.0

- The extension was rebuilt in TypeScript; permissions are unchanged except
  for the removal of `api.cognitive.microsofttranslator.com`.
- `web_accessible_resources` were removed entirely.
- The in-page analysis modal was removed; the side panel is the only AI UI.
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
   "Use the show's own translation when it has one" to switch between the
   platform's own translation track and the provider.
4. Optional: in the options page's Word explanations section, paste an
   OpenAI or Gemini API key and turn the feature on, then click a subtitle
   word; the side panel opens with the word selected and "Analyze" returns
   a structured explanation.
