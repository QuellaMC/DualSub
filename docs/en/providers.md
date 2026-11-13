# Translation services

DualSub translates subtitles with the service you choose in the settings page's **Translation** section.

| Service                        | What it needs                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Microsoft Translator (default) | Nothing                                                                                                    |
| Google Translate               | Nothing                                                                                                    |
| DeepL                          | A DeepL API key, on the Free or Pro plan                                                                   |
| AI translation                 | The API key, address, and model of an OpenAI-compatible service                                            |
| Google Vertex AI               | A Google Cloud project, region, and model, and an access token, pasted or made from a service-account file |

Microsoft Translator and Google Translate use undocumented endpoints that can change without notice. Use a service with a key when you need a documented service contract.

DualSub translates each subtitle line on its own, without the lines around it. When the show has its own translation in your language, DualSub shows that instead; **Use the show's own translation** in the Languages section turns this off.

## When a service fails

When the service you chose stops working for good (it refuses the key, the quota is used up, or it rejects the request), Microsoft Translator covers for it, then Google Translate, so subtitles keep coming. DualSub tries your service again after ten minutes, or as soon as you change its settings. A passing outage is covered for that one request only.

To keep subtitle text with your chosen service alone, turn off **Keep translating if this service fails**.

## Request pacing

Each service has a minimum pause between requests, and some also limit how much they send in a time window:

- Microsoft Translator: characters per minute
- Google Translate: bytes per few seconds
- DeepL: the pause only; DeepL's responses report the quota
- AI translation and Google Vertex AI: requests per minute

These limits live in the extension's service worker and start over when it restarts; they are not your account's quota. With advanced options shown, **Pause between translation requests** lengthens the pause for every service.

## Problems

- **Translations stop or come from another service**: the Translation section and the popup name the failing service, the problem, and the service covering for it. Check its key, plan, or address, or choose another service.
- **The service complains about too many requests**: raise **Pause between translation requests**.
