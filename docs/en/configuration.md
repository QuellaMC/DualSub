# Configuration

## Popup (Quick Access)

- Enable/Disable dual subtitles
- Languages: the translation language starts as your browser's language. The top line starts on Automatic and follows the language spoken in the video, including when you switch the audio track in the player; pick a fixed language to learn one language with every video. When the video is already in your translation language, DualSub shows one line.
- Layout (Top/Bottom, Left/Right), appearance, and timing offset
- Subtitle style: Match Platform, which follows the subtitle appearance settings of your Netflix or Disney+ profile, or Custom, which starts as DualSub's own look and is edited in the options page. The translation line's color is a setting of its own for both. Font size is a scale over the look's base size, which follows the video's height.

## Per-Site Settings

Netflix and Disney+ can each keep their own value for these settings: dual subtitles on or off, hiding the site's own subtitles, the top line's language, official translations, the subtitle style and custom look, the translation color, size, spacing, position, line order and layout, and timing. A site stores only what differs from the settings for all sites; everything else follows them. The translation language, the translation service, word explanations, and API keys are the same on every site.

The popup changes the value the current site uses: its own value when it has one, otherwise the shared one.

## Advanced Options

- UI Language (EN, ES, JA, KO, ZH-CN, ZH-TW)
- Hide official subtitles
- Logging level
- Provider API keys and request-delay tuning
- AI Context settings (provider, model, caching, rate limits, timeout)

## Examples

For Language Learning:

- Provider: Microsoft Translate (Free)
- Layout: Top/Bottom, Original First
- AI Context: OpenAI GPT-5.6 Luna (Cultural, Historical, Linguistic)

For Performance:

- Request Delay: 100ms
- Provider: Google Translate
- AI Context: Gemini 3.5 Flash; Context Cache: Enabled

For Advanced Users:

- Provider: OpenAI Compatible
- AI Context: OpenAI GPT-5.6 Luna
- Rate Limit: 60 rpm; Cache TTL: 1 hour; Debug Logging: Enabled
