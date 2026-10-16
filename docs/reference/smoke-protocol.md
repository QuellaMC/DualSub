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
2. Toggle "use official translations" and change both languages from the
   popup: the current line stays up behind the loading placeholder, then
   the new languages take over at the right time. With the top line on
   Automatic (a fresh profile's default), switch the audio track in the
   player: the top line reloads in the new audio language within a few
   seconds; pick audio in the translation language: one line shows.
3. Next episode (autoplay and manual): no duplicated cues, no cue from the
   previous episode, timing correct from the first line.
4. Leave the player, come back, and reload the page: subtitles return
   without a stale line from the earlier session.
5. Seek rapidly and drag the popup sliders while playing: the overlay
   follows the slider live and never goes blank between cues. Switch the
   subtitle style between Match Platform and Custom and resize the
   window: the text restyles live and scales with the video. With the
   platform's own subtitles off, Match Platform still follows the
   profile's subtitle appearance settings, and the popup says so.
6. In the settings page's How subtitles look section, pick each
   ready-made look, then change colors and font (font, bold, text color,
   edge, background) and the translation color: the preview follows each
   edit at once, the overlay follows after a pause, both styles draw the
   translation in the chosen color, and the values are still there after
   the settings page is reloaded.
7. Disney+ only: an ad or recap interstitial shows no subtitle, and the
   time source stays correct across the shadow-DOM player controls.

## Translation

8. Switch the translation service in the settings page (Microsoft,
   Google, a keyed one): translations resume for the current line without
   a page reload. With a keyed service whose key is wrong, translations
   keep coming through Microsoft, the Translation section names the
   failing service and the one covering for it, and after fixing the key
   the keyed service takes over at once.
9. Kill the service worker from chrome://serviceworker-internals while
   playing: translations resume within a few cues.

## Side panel

10. Turn on Word explanations. Click a subtitle word: the panel opens, the
    word is highlighted, and playback pauses when auto-pause is on.
11. Click several words, remove one from the panel: the removal shows only
    after the subtitle highlight drops it.
12. Switch tabs in the same window and back: the panel follows the active
    tab and restores its selection.
13. Kill the service worker with the panel open: the panel reconnects and
    the selection is republished.
14. Analyze: a result renders; turn Word explanations off in the settings
    page while a request is in flight: no result appears afterwards.

## Settings and locale

15. Change the UI language: popup, settings page, and panel switch
    without a reload; the settings page title follows.
16. On a clean profile the settings page opens on Start and says
    DualSub is ready. Change the text size: the notice confirms it,
    stays while pointed at, and Undo (or Ctrl+Z) puts it back. Search
    "twice": Sites opens with focus on the hide switch. Show advanced
    options, pick Netflix in the bar at the top, and change the size:
    it gets a "Netflix only" tag, the Netflix overlay follows, Disney+
    keeps the shared size, and "Use the value for all sites" drops it
    again.
17. Seeded 2.5.0 profile: after the first boot, credentials are gone from
    sync storage, the provider is Microsoft, and every option shows the
    value the old profile had.
