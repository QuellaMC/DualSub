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
- The active background translation contract accepts one text per request for every provider.

## Request Pacing and Worker-Local Guards (subject to change)

- Google (free): bytes-per-window, with mandatory delays
- Microsoft (free): one-minute worker-local character guard with mandatory pacing; it is not a durable Microsoft account quota
- DeepL API: local request pacing only; quota truth comes from DeepL provider responses
- OpenAI Compatible: requests-per-minute with a small mandatory delay
- Vertex AI Gemini: requests-per-minute with a small mandatory delay

See `background/services/translationService.js` for the current provider limits and single-text request path.
