# Translation Providers

DualSub supports multiple providers with automatic fallback and intelligent batching.

## Providers

- DeepL Free: High quality, no setup; internal guard rails to avoid request spikes
- Google Translate (Free): Fast and broad language coverage
- Microsoft Translate (Free): Reliable performance via Edge-auth endpoint
- DeepL API (Paid): Highest quality; requires API key
- OpenAI Compatible (Paid): Works with OpenAI and Gemini-compatible endpoints; requires API key

## Fallback and Batching

- Automatic Fallback: If a provider fails, the system falls back to another configured provider
- Universal Batch Processor: Reduces API calls by grouping subtitle segments when possible

## Internal Rate Limits (subject to change)

- Google (free): bytes-per-window, with mandatory delays
- Microsoft (free): sliding-window character quotas (per-minute and per-hour)
- DeepL API: characters-per-month guard rails
- DeepL Free: requests-per-hour with mandatory delay between requests
- OpenAI Compatible: requests-per-minute with small mandatory delay; native batch supported

Provider-specific batch configurations and delays are dynamically tuned. See `background/services/translationService.js` and `background/services/universalBatchProcessor.js` for current values.
