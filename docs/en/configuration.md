# Configuration

DualSub works on Netflix and Disney+ as soon as it is installed; nothing needs setting up.

## Popup (Quick Access)

On a site DualSub works on, the popup is a remote control:

- Whether DualSub is working on the video, and a switch that turns it on or off for that site only
- I speak: the translation language, which starts as your browser's language
- Original line: the language the original line shows. Automatic, the default, follows the language spoken in the video, including when you switch the audio track in the player; the settings page's Languages section can fix one language instead, to learn it with every video. When the video is already in your translation language, DualSub shows one line.
- Text size, timing, and position, in steps the video follows at once
- A notice when the translation service you chose stops working, with a way to its settings

Anywhere else, the popup shows what DualSub does and opens the sites it works on.

The subtitle look is set in the settings page's Style section: Like the site follows the subtitle appearance settings of your Netflix or Disney+ profile, and the ready-made looks (Boxed, Classic, High contrast, and Cinema) start your own, whose font, edge, colors, and box you can then change. The translation line's color is a setting of its own for every look. Text size is a scale over the look's base size, which follows the video's height.

## Settings Page

The settings page holds every setting, the popup's included, with a menu of its sections beside it. Each change saves at once, and the notice that confirms it can undo it, as can Ctrl+Z (⌘Z) outside a text field. The search box finds a setting by everyday words, such as "twice", "late", or "bigger".

- Start: where DualSub is working, a sample of your subtitles, and the language you speak, the text size, and the translation service
- Languages: the language you speak, which the original line is translated into, what the original line shows, and the show's own translation, each line of which comes and goes with the original line it belongs with, with a sample over a Korean drama or an English film
- Style: the subtitles on a stage at your video's true proportions, at night or by day. Click a line to style it, drag the subtitles to move them, or open Full screen to see them at their real size. The pane beside the stage holds the size, position, look, translation color, and lines (which goes on top, stacked or side by side, and the spacing), each with exact values. Position also has a switch: lines the show raises over on-screen text appear where the show puts them, or, turned off, at your position with the rest.
- Timing: a timeline of the voice and the subtitles; show the subtitles earlier or later in half-second steps
- Translation: the translation service, its setup, and whether a free service covers when it fails
- Meanings: Word explanations; click a word in the subtitles to have an AI service explain it, through your own OpenAI or Gemini key
- Sites: DualSub on or off for each site, and hiding each site's own subtitles
- Help: fixes for common problems, such as hiding the sites' own subtitles everywhere, or letting the show's own translation keep its own timing when its lines go with the wrong original line

The Advanced options switch in the top bar adds the exact timing shift, the switch that shows the show's own translation with the original line it belongs with, the pause between translation requests, per-site settings, the AI service's address and model, limits for word explanations, subtitle tracks to skip on Disney+, and the Advanced section: backup and restore, the settings as JSON, the logging level, a diagnostic report, and a reset that keeps your keys along with the address, plan, and model each one is used with.

API keys stay on this computer: they don't sync and never go into a backup file. A key goes only to the address it was entered for. When that address moves to another host (on this computer, on another one you sync with, or by loading a backup), DualSub treats the key as missing until you enter one for the new address.

## Per-Site Settings

Netflix and Disney+ can each keep their own value for these settings: dual subtitles on or off, hiding the site's own subtitles, the original line's language, official translations, the subtitle style and custom look, the translation color, size, spacing, position, whether lines go where the show puts them, line order and layout, and timing. A site stores only the values it keeps for itself; everything else follows the settings for all sites. The translation language, the translation service, word explanations, and API keys are the same on every site.

In the settings page, with advanced options shown, pick a site in the bar at the top: what you change then gets a "Netflix only" tag (in Style, a dot on the row), and "Use All sites" drops the site's own value. The Sites section lists what each site keeps and removes it in one click.

The popup changes the value the current site uses: its own value when it has one, otherwise the shared one. Its on/off switch is always the site's own.

## Examples

For language learning:

- Translation: Microsoft Translator (free, nothing to set up)
- Original line: always one language, the one you are learning
- Word explanations: on, explaining meaning, culture, and history

For speed:

- Translation: Google Translate
- Pause between translation requests: 100 ms
- Word explanations: Gemini 3.5 Flash, remembering answers

For technical users:

- Translation: AI translation through an OpenAI-compatible address
- Word explanations: OpenAI GPT-5.6 Luna, at most 60 requests per minute
- Detail in the browser console: Everything (debug)
