# Manual smoke protocol

Run on both Netflix and Disney+ before every release build (and after any
change to the content core). Load the unpacked build from `.output/chrome-mv3`
with a clean profile plus one seeded profile (see the upgrade-path tests in
`src/config/upgradePaths.test.ts` for what "2.5.0 → 3" storage looks like).

## Subtitles

1. Open a title. Dual subtitles appear; the platform's own subtitle
   container stays hidden.
2. Toggle "use official translations" and change both languages from the
   popup: the current line stays up behind the loading placeholder, then
   the new languages take over at the right time.
3. Next episode (autoplay and manual): no duplicated cues, no cue from the
   previous episode, timing correct from the first line.
4. Leave the player, come back, and reload the page: subtitles return
   without a stale line from the earlier session.
5. Seek rapidly and drag the popup sliders while playing: the overlay
   follows the slider live and never goes blank between cues.
6. Disney+ only: an ad or recap interstitial shows no subtitle, and the
   time source stays correct across the shadow-DOM player controls.

## Translation

7. Switch providers in the options page (Microsoft, Google, a keyed one):
   translations resume for the current line without a page reload.
8. Kill the service worker from chrome://serviceworker-internals while
   playing: translations resume within a few cues.

## Side panel

9. Enable AI Context. Click a subtitle word: the panel opens, the word is
   highlighted, and playback pauses when auto-pause is on.
10. Click several words, remove one from the panel: the removal shows only
    after the subtitle highlight drops it.
11. Switch tabs in the same window and back: the panel follows the active
    tab and restores its selection.
12. Kill the service worker with the panel open: the panel reconnects and
    the selection is republished.
13. Analyze: a result renders; turn AI Context off in options while a
    request is in flight: no result appears afterwards.

## Settings and locale

14. Change the UI language: popup, options, and panel switch without a
    reload; the options page title follows.
15. Seeded 2.5.0 profile: after the first boot, credentials are gone from
    sync storage, the provider is Microsoft, and every option shows the
    value the old profile had.
