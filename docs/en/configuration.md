# Configuration

DualSub works on Netflix and Disney+ as soon as it is installed; nothing needs setting up.

## Popup (Quick Access)

On a site DualSub works on, the popup is a remote control:

- Whether DualSub is working on the video, and a switch that turns it on or off for that site only
- I speak: the translation language, which starts as your browser's language
- The top line shows: Automatic, the default, follows the language spoken in the video, including when you switch the audio track in the player; pick a fixed language to learn one language with every video. When the video is already in your translation language, DualSub shows one line.
- Text size, timing, and position, in steps the video follows at once
- A notice when the translation service you chose stops working, with a way to its settings

Anywhere else, the popup shows what DualSub does and opens the sites it works on.

The subtitle style is set in the settings page: Look like the site follows the subtitle appearance settings of your Netflix or Disney+ profile, and My own style starts from a ready-made look. The translation line's color is a setting of its own for both. Text size is a scale over the look's base size, which follows the video's height.

## Settings Page

The settings page holds every setting, the popup's included. Each change saves at once, and the notice that confirms it can undo it, as can Ctrl+Z (⌘Z) outside a text field. The search box finds a setting by everyday words, such as "twice", "late", or "bigger".

- Start: whether DualSub is ready, the languages and translation service it uses, and the text size
- Languages: the language you speak, which the bottom line is translated into, and what the top line shows
- How subtitles look: the style, ready-made looks, colors and font, the translation line's color, size, position, spacing, line order, and arrangement, with a live preview
- Timing: show the subtitles earlier or later in half-second steps
- Translation: the translation service, its setup, and whether a free service covers when it fails
- Word explanations: click a word in the subtitles to have an AI service explain it, through your own OpenAI or Gemini key
- Sites: hiding the sites' own subtitles on every site or for one, and DualSub on or off for each site
- Help: fixes for common problems

"Show advanced options" adds exact values (text size, height, timing shift, and the pause between translation requests), per-site settings, the AI service's address and model, limits for word explanations, subtitle tracks to skip on Disney+, and the Advanced section: backup and restore, the settings as JSON, the logging level, a diagnostic report, and a reset that keeps your keys along with the address, plan, and model each one is used with.

API keys stay on this computer: they don't sync and never go into a backup file. A key goes only to the address it was entered for. When that address moves to another host (on this computer, on another one you sync with, or by loading a backup), DualSub treats the key as missing until you enter one for the new address.

## Per-Site Settings

Netflix and Disney+ can each keep their own value for these settings: dual subtitles on or off, hiding the site's own subtitles, the top line's language, official translations, the subtitle style and custom look, the translation color, size, spacing, position, line order and layout, and timing. A site stores only the values it keeps for itself; everything else follows the settings for all sites. The translation language, the translation service, word explanations, and API keys are the same on every site.

In the settings page, with advanced options shown, pick a site in the bar at the top: what you change then gets a "Netflix only" tag, and "Use the value for all sites" drops the site's own value. The Sites section lists what each site keeps and removes it in one click.

The popup changes the value the current site uses: its own value when it has one, otherwise the shared one. Its on/off switch is always the site's own.

## Examples

For language learning:

- Translation: Microsoft Translator (free, nothing to set up)
- The top line shows: always the language you are learning
- Word explanations: on, explaining meaning, culture, and history

For speed:

- Translation: Google Translate
- Pause between translation requests: 100 ms
- Word explanations: Gemini 3.5 Flash, remembering answers

For technical users:

- Translation: AI translation through an OpenAI-compatible address
- Word explanations: OpenAI GPT-5.6 Luna, at most 60 requests per minute
- Detail in the browser console: Everything (debug)
