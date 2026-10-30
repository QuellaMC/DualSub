# Settings

DualSub works on Netflix and Disney+ as soon as it is installed. This page covers the popup, the settings page, per-site settings, and how DualSub keeps your keys.

## Popup

The DualSub button in Chrome's toolbar opens the popup. On a site DualSub works on, it is a remote control:

- Whether DualSub is working on the video, and a switch that turns it on or off for that site only.
- **I speak**: the language the subtitles are translated into. It starts as your browser's language.
- **Original line**: the language the original line shows. **Automatic**, the default, follows the language spoken in the video, including when you switch the audio track. The settings page's Languages section can fix one language instead. A video already in your language shows one line.
- Text size, timing, and position, in steps the video follows at once.
- A notice when your translation service stops working, with a link to its settings.

Anywhere else, the popup shows what DualSub does and opens the sites it works on.

## Settings page

The settings page holds every setting, the popup's included. Each change saves at once; the notice that confirms it can undo it, and so can Ctrl+Z (⌘Z) outside a text field. The search box finds a setting by everyday words, such as "twice", "late", or "bigger".

- **Start**: where DualSub is working, a sample of your subtitles, your language, the text size, and the translation service.
- **Languages**: your language, what the original line shows, and the show's own translation, with a sample over a Korean drama or an English film. Each line of the show's own translation comes and goes with the original line it belongs with.
- **Style**: the subtitles on a stage at your video's proportions, by night or by day. Click a line to style it, drag the subtitles to move them, or open **Full screen** to see them at their real size. The pane beside the stage holds the size, position, look, translation color, and lines (which goes on top, stacked or side by side, and the spacing).
- **Timing**: a timeline of the voice and the subtitles. Show the subtitles earlier or later in half-second steps.
- **Translation**: the [translation service](providers.md), its setup, and whether a free service covers when it fails.
- **Meanings**: [word lookup and Explain with AI](ai-context.md).
- **Sites**: DualSub on or off for each site, and hiding each site's own subtitles.
- **Help**: one-click fixes for common problems, such as subtitles that show twice or a show's own translation that goes with the wrong line.

In the Style section's **Look** row, **Like the site** draws the subtitles the way your Netflix or Disney+ profile's subtitle appearance settings say. The ready-made looks (Boxed, Classic, High contrast, and Cinema) start a look of your own, whose font, edge, colors, and box you can change. **Translation color** applies to every look. Text size scales the look's base size, which follows the video's height.

### Advanced options

The **Advanced options** switch in the top bar adds:

- the exact timing shift
- **Show it with the original line**, which pairs the show's own translation with the original line
- **Pause between translation requests**
- per-site settings
- the AI service's address, model, and limits
- **Subtitle tracks to skip** on Disney+
- the **Advanced** section: backup and restore, the settings as JSON, **Detail in the browser console**, the diagnostic report, and a reset that keeps your keys along with the address, plan, and model each one is used with

## Per-site settings

Netflix and Disney+ can each keep their own value for these settings: DualSub on or off, hiding the site's own subtitles, the original line's language, using the show's own translation, the look and your own look, the translation color, size, spacing, position, line order and layout, and timing. A site stores only the values it keeps for itself; everything else follows **All sites**. Your language, the translation service, word lookup, AI explanations, and keys are the same on every site.

With advanced options shown, pick a site in the bar at the top of the settings page. What you change then gets a "Netflix only" tag (in Style, a dot on the row), and **Use All sites** drops the site's own value. The Sites section lists what each site keeps and removes it in one click.

The popup changes the value the current site uses: its own value when it has one, otherwise the shared one. Its on/off switch is always the site's own.

## API keys

API keys stay on this computer: they don't sync, and they never go into a backup file. A key goes only to the address it was entered for. When that address moves to another host, on this computer, on another one you sync with, or by loading a backup, DualSub treats the key as missing until you enter one for the new address.
