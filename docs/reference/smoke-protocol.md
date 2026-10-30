# Manual smoke protocol

Run this checklist on Netflix and Disney+ before every release, and after any change to the content core. Load the unpacked build from `dist/chrome-mv3` into a clean profile and into one seeded with 2.5.0 settings; `src/config/upgradePaths.test.ts` shows what that storage looks like.

Each check is an action followed by what should happen.

## Subtitles

1. Open a title. Dual subtitles appear, and the platform's own subtitle container stays hidden.
    - On a title with on-screen text (Disney+ Marvel films open with location cards), the cue the platform raises shows at the top with its translation, while dialogue stays at the bottom.
    - On a Netflix title whose original line is a closed-caption (CC) track, a two-line caption shows as one block with one translation of the whole sentence, at the top as at the bottom.
2. Change languages.
    - Change your language in the popup, and the original line and the show's own translation in the settings page's Languages section. The current line stays up behind the loading placeholder, then the new languages take over at the right time.
    - With the original line on Automatic (a fresh profile's default), switch the audio track in the player. The original line reloads in the new audio language within a few seconds, and the popup names it. Pick audio in the translation language: one line shows.
    - On a title whose own translation DualSub uses, each translated line comes and goes with its original line. While it plays, press "Fix it for me" under "The translation goes with the wrong line" in Help. From the next frame both lines keep their own timing, with no reload, and Undo pairs them again. Either way, a line that stays up while the line beside it changes does not blink.
3. Go to the next episode, by autoplay and by hand. No cue is duplicated, none is left from the previous episode, and timing is right from the first line.
4. Leave the player, come back, and reload the page. Subtitles return without a stale line from the earlier session.
5. Seek rapidly and press the popup's text size, timing, and position buttons while playing. The overlay follows each press at once and never goes blank between cues.
    - In the settings page's Style section, switch the Look row between Like the site and a ready-made look, and resize the window. The text restyles live and scales with the video.
    - With the platform's own subtitles off, Like the site still follows the profile's subtitle appearance settings.
6. Open the popup on a playing Netflix video. It says DualSub is working on it.
    - Turn DualSub off there. Netflix shows its own subtitles, while a Disney+ tab keeps dual subtitles.
    - On any other page, the popup names the sites and opens each one.
7. In the Style section, pick each ready-made look in the Look row, then change the font, edge, bold, original color, and box, and the translation color. The stage follows each edit at once, the overlay follows after a pause, every look draws the translation in the chosen color, and the values are still there after the settings page is reloaded.
    - Click each line on the stage. The original line opens Look; the translation opens Translation color.
    - In Lines, put the translation on top. The row reads "Translation on top", and the original line keeps its name and color.
    - Drag the subtitles up. The Position row opens, a guide marks the usual height, the overlay follows once they drop, and Undo puts them back.
    - Open Full screen. The text is the size it has on a full-screen video, and Escape closes it with focus back on the Full screen button.
8. Disney+ only: play past an ad or recap interstitial. It shows no subtitle, and the time source stays correct across the shadow-DOM player controls.

## Translation

9. Switch the translation service in the settings page (Microsoft, Google, a keyed one). Translations resume for the current line without a page reload.
    - With a keyed service whose key is wrong, translations keep coming through Microsoft, and the Translation section names the failing service and the one covering for it. After you fix the key, the keyed service takes over at once.
10. Stop the service worker from `chrome://serviceworker-internals` while playing. Translations resume within a few cues.

## Side panel

11. On a clean profile, click a subtitle word. The panel opens with the DualSub header and the language pair, the word is highlighted in the panel's copy of the line, its translation and a dictionary entry show with their source named, and playback pauses when auto-pause is on.
    - Click the video. It plays on.
    - Turn off "Look up words when I click them" in Meanings. Subtitle words stop being clickable at once.
12. Click several words, then in the panel's line click a new word to add it and a picked one to remove it. Each change shows in the panel only after the subtitle highlight follows, and the meaning follows the new words. Remove the last word: the line stays, and a word can be clicked back in.
13. Switch tabs in the same window and back. The panel follows the active tab and restores its words, meaning, and explanation.
    - On a tab that is not Netflix or Disney+, the panel says to open a video there.
    - Set Panel colors to Dark. The panel follows.
14. Stop the service worker with the panel open. The panel reconnects and the selection is republished.
15. Without a key, press "Explain with AI". The key steps open in the panel.
    - Paste a wrong key and press "Check and explain". The panel says the key didn't work.
    - Paste a working one. The explanation shows, with the sections "What to explain" asks for.
    - Remove the key in the settings page while a request is in flight. No answer appears, and the key steps open again.

## Settings and locale

16. Change the UI language. The popup, settings page, and panel switch without a reload, and the settings page title follows.
17. On a clean profile, open the settings page. It opens on Start, says it is working on Netflix and Disney+, and highlights Start in the menu.
    - Make the text bigger with A+. The notice confirms it and stays while pointed at, and Undo (or Ctrl+Z) puts it back.
    - Scroll down and open Languages from the menu. It opens at the top, with the top bar in view.
    - Search "twice". Sites opens with focus on Netflix's hide switch.
    - In Timing, press Show earlier. The subtitle bars slide ahead of the voice on the timeline.
    - Turn on Advanced options in the top bar, pick Netflix in the bar at the top, and change the size in Style. The Size row gets a dot and a "Netflix only" tag, the Netflix overlay follows, Disney+ keeps the shared size, and "Use All sites" drops it again.
    - Choose DeepL without a key. Start says it isn't set up yet and that Microsoft Translator translates until it is. Turn fallback off: Start says nothing is translated.
18. Install the build into a clean profile. The welcome page opens once, with a two-line sample and, under "What we picked for you", the browser's language (or English, saying nothing about the browser, when DualSub offers none of its languages).
    - Change the language there. The sample follows.
    - Reload the extension from `chrome://extensions`. No second welcome page opens.
19. Boot the seeded 2.5.0 profile. Credentials are gone from sync storage, the provider is Microsoft, every option shows the value the old profile had, and its AI keys still work at their addresses.
20. Set up AI translation with a Google Gemini key, then choose OpenAI. The key field empties, Start says AI translation isn't set up yet, and no request goes to `api.openai.com`. Choose Google Gemini again: the key is back.
    - With an OpenAI key under Explain with AI in Meanings, save a backup, change its `openaiBaseUrl` to another host, and load it. Meanings asks for a key again.
