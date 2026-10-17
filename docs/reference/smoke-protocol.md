# Manual smoke protocol

Run on both Netflix and Disney+ before every release build (and after any
change to the content core). Load the unpacked build from `dist/chrome-mv3`
with a clean profile plus one seeded profile (see the upgrade-path tests in
`src/config/upgradePaths.test.ts` for what "2.5.0 → 3" storage looks like).

## Subtitles

1. Open a title. Dual subtitles appear; the platform's own subtitle
   container stays hidden. On a title with on-screen text (Disney+ Marvel
   films open with location cards), the cue the platform raises shows at
   the top with its translation while dialogue stays at the bottom.
2. Change your language from the popup, and the top line and the show's
   own translation in the settings page's Languages section: the current line
   stays up behind the loading placeholder, then the new languages take
   over at the right time. With the top line on
   Automatic (a fresh profile's default), switch the audio track in the
   player: the top line reloads in the new audio language within a few
   seconds, and the popup names it; pick audio in the translation
   language: one line shows.
3. Next episode (autoplay and manual): no duplicated cues, no cue from the
   previous episode, timing correct from the first line.
4. Leave the player, come back, and reload the page: subtitles return
   without a stale line from the earlier session.
5. Seek rapidly and press the popup's text size, timing, and position
   buttons while playing: the overlay follows each press at once and
   never goes blank between cues. In the settings page's Style section,
   switch the Look row between Like the site and a ready-made look and
   resize the window: the text restyles live and scales with the video.
   With the platform's own subtitles off, Like the site still follows
   the profile's subtitle appearance settings.
6. Open the popup on a playing Netflix video: it says DualSub is working
   on it. Turn DualSub off there: Netflix shows its own subtitles while a
   Disney+ tab keeps dual subtitles. On any other page the popup names
   the sites and opens each one.
7. In the settings page's Style section, pick each ready-made look in
   the Look row, then change the font, edge, bold, top line color, and
   box, and the translation color: the stage follows each edit at once,
   the overlay follows after a pause, every look draws the translation in
   the chosen color, and the values are still there after the settings
   page is reloaded. Click each line on the stage: the top line opens
   Look, yours opens Translation color. Drag the subtitles up: the
   Position row opens, a guide marks the usual height, the overlay
   follows once they drop, and Undo puts them back. Open Full screen: the
   text is the size it has on a full-screen video, and Escape closes it
   with focus back on the Full screen button.
8. Disney+ only: an ad or recap interstitial shows no subtitle, and the
   time source stays correct across the shadow-DOM player controls.

## Translation

9. Switch the translation service in the settings page (Microsoft,
   Google, a keyed one): translations resume for the current line without
   a page reload. With a keyed service whose key is wrong, translations
   keep coming through Microsoft, the Translation section names the
   failing service and the one covering for it, and after fixing the key
   the keyed service takes over at once.
10. Kill the service worker from chrome://serviceworker-internals while
    playing: translations resume within a few cues.

## Side panel

11. Turn on Word explanations. Click a subtitle word: the panel opens, the
    word is highlighted, and playback pauses when auto-pause is on.
12. Click several words, remove one from the panel: the removal shows only
    after the subtitle highlight drops it.
13. Switch tabs in the same window and back: the panel follows the active
    tab and restores its selection.
14. Kill the service worker with the panel open: the panel reconnects and
    the selection is republished.
15. Analyze: a result renders; turn Word explanations off in the settings
    page while a request is in flight: no result appears afterwards.

## Settings and locale

16. Change the UI language: popup, settings page, and panel switch
    without a reload; the settings page title follows.
17. On a clean profile the settings page opens on Start and says
    it is working on Netflix and Disney+, the menu's highlight on Start.
    Make the text bigger with A+: the notice confirms it, stays while
    pointed at, and Undo (or Ctrl+Z) puts it back. Search "twice": Sites
    opens with focus on Netflix's hide switch. In Timing, Show earlier
    slides the subtitle bars ahead of the voice on the timeline. Turn on
    Advanced options in the top bar, pick Netflix in the bar at the top,
    and change the size in Style: the Size row gets a dot and a "Netflix
    only" tag, the Netflix overlay follows, Disney+ keeps the shared
    size, and "Use All sites" drops it again. Choose DeepL without a key: Start says it isn't set up yet
    and that Microsoft Translator translates until it is; turn
    fallback off and Start says nothing is translated.
18. Install the build into a clean profile: the welcome page opens once,
    with a two-line sample and, under "What we picked for you", the
    browser's language (English, saying nothing about the browser, when
    DualSub offers none of its languages). Change the language there: the
    sample follows. Reload the extension from chrome://extensions: no
    second welcome page.
19. Seeded 2.5.0 profile: after the first boot, credentials are gone from
    sync storage, the provider is Microsoft, every option shows the value
    the old profile had, and its AI keys still work at their addresses.
20. Set up AI translation with a Google Gemini key, then choose OpenAI:
    the key field empties, Start says AI translation isn't set up yet,
    and no request goes to api.openai.com. Choose Google Gemini again:
    the key is back. With an OpenAI key in Word explanations, save a
    backup, change its `openaiBaseUrl` to another host, and load it: Word
    explanations asks for a key again.
