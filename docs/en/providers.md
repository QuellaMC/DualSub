# Translation Providers

DualSub supports multiple translation providers with provider-aware rate limits.

## Providers

- Google Translate (No key): Best-effort consumer endpoint with broad language coverage
- Microsoft Translate (No key): Best-effort Edge translation endpoint
- DeepL API (Free/Pro): Uses DeepL's supported API; requires an API key
- OpenAI Compatible: Works with user-configured OpenAI-compatible endpoints; requires an API key
- Vertex AI Gemini: Uses a Google Cloud project and short-lived access token

The no-key Google/Microsoft integrations use undocumented consumer/internal endpoints and can change without notice. Use a supported keyed provider when a documented service contract is required.

## Request Handling

- Subtitle cues are translated individually by the content script.
- The background protocol retains an explicit multi-text request for OpenAI-compatible and Vertex providers. Other providers process that protocol one text at a time.

## Internal Rate Limits (subject to change)

- Google (free): bytes-per-window, with mandatory delays
- Microsoft (free): sliding-window character quotas (per-minute and per-hour)
- DeepL API: characters-per-month guard rails
- OpenAI Compatible: requests-per-minute with a small mandatory delay; explicit multi-text requests supported

See `background/services/translationService.js` for the current provider limits and explicit multi-text request path.
