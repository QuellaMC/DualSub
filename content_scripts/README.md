# Content scripts

DualSub has one shared content-script host and two small platform adapters:

- `core/BaseContentScript.js` owns configuration, platform lifecycle, navigation,
  subtitle presentation, AI-context integration, runtime routes, and cleanup.
- `platforms/NetflixContentScript.js` and
  `platforms/DisneyPlusContentScript.js` provide platform identity, player-route
  classification, injection settings, and page-transition behavior.
- `platforms/netflixContent.js` and `platforms/disneyPlusContent.js` are the
  manifest entry points.
- `shared/` contains cross-platform messaging, protocol, navigation, injection,
  subtitle, and logging utilities.

## Boundaries

- Page-world subtitle events enter through a lifecycle-scoped injection channel.
  The content script validates the event before passing it to a platform adapter.
- Extension messages use route-specific builders and parsers from
  `shared/protocol/messageProtocol.js`. A new action requires an explicit sender
  role and an exact request/response contract.
- Runtime sends use the Promise-only `sendRuntimeMessageWithRetry()` helper. It
  retries only when Chrome proves that no receiver accepted the message.
- `BaseContentScript` owns navigation and cleanup. Platform adapters must not add
  parallel History API hooks, navigation polling, or runtime-message routers.

## Adding a platform

Start with [PLATFORM_IMPLEMENTATION_GUIDE.md](./PLATFORM_IMPLEMENTATION_GUIDE.md).
Keep platform code limited to the real differences in URL classification,
injection, and page transitions.

## Development

```bash
npm test
npm run lint
npm run format:check
npm run build
npm run verify:build
```

More detail:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [API_REFERENCE.md](./API_REFERENCE.md)
- [PLATFORM_IMPLEMENTATION_GUIDE.md](./PLATFORM_IMPLEMENTATION_GUIDE.md)
