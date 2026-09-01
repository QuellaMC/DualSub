# Content-script API reference

This document lists the supported content-script seams. Private helpers and state
are intentionally omitted; use the implementation as the source of truth when
working inside an existing lifecycle.

## `BaseContentScript`

Platform content scripts extend `core/BaseContentScript.js` and implement:

```javascript
getPlatformName();
getPlatformClass();
getInjectScriptConfig();
setupNavigationDetection();
```

`getInjectScriptConfig()` returns the injected-script filename, its DOM tag ID,
the page event ID, and the lifecycle-scoped channel created by
`createInjectionChannel(platform)`.

`setupNavigationDetection()` must delegate to the protected
`_setupNavigationManager(options?)` seam. Base owns manager replacement, URL
dispatch, player-identity invalidation, transition callbacks, and cleanup.

Useful host lifecycle methods:

```javascript
await contentScript.initialize();
contentScript.cleanup();
```

The host also provides shared logging, configuration, platform initialization,
subtitle presentation, AI-context integration, and a closed message route table.
Those internals are not platform extension points.

## Platform classes

- `platforms/NetflixContentScript.js` classifies `/watch/...` routes and supplies
  the Netflix injected script and runtime adapter.
- `platforms/DisneyPlusContentScript.js` classifies Disney+ player routes and
  supplies the Disney+ injected script and runtime adapter.

Both adapters use the shared navigation and injection lifecycle.

## Injection channel

`createInjectionChannel(platform, cryptoSource?)` returns a frozen object with:

```javascript
channel.accept(event); // accepted plain detail or null
channel.createEventDetail(type, fields); // page event detail or null
channel.createScriptUrl(extensionUrl); // URL carrying lifecycle capability or null
channel.revoke();
```

Supported platform identifiers are `netflix` and `disneyplus`. A revoked channel
accepts and creates nothing.

## Runtime messaging

`shared/messaging.js` exports:

```javascript
isProvenMessagingNonDelivery(error);
await sendRuntimeMessageWithRetry(message, options?);
```

Options for `sendRuntimeMessageWithRetry()`:

- `retries` (default `3`): retries after the initial attempt
- `baseDelayMs` (default `100`)
- `backoffFactor` (default `2`)
- `canDispatch`: optional synchronous guard; only exact `true` permits dispatch

The helper requires `message.action` and calls the Promise form of
`chrome.runtime.sendMessage`. It retries only proven non-delivery. Callers must
parse the response with the matching route parser.

## Message protocol

`shared/protocol/messageProtocol.js` exports route-specific builders and parsers
for these message families:

- translation and AI-context analysis
- content-script configuration, logging, pause, and readiness controls
- content-to-side-panel word intent and selection snapshots
- side-panel registration, binding, republish, removal, and tab changes

Do not construct an ad hoc envelope. Add a route by changing the action catalog,
builder/parser pair, sender-role policy, owning router, and behavior tests together.

## Shared utilities

- `shared/subtitleUtilities.js`: subtitle fetching, cue rendering, interactive
  formatting, and lifecycle cleanup
- `shared/interactiveSubtitleFormatter.js`: renders selectable subtitle words and
  publishes private word intents
- `shared/navigationUtils.js`: player-route classification and the shared
  navigation manager
- `shared/subtitleRequestIdentity.js` and
  `background/utils/subtitleRequestPolicy.js`: canonical subtitle request
  identity and background authorization

Internal buffers, interval tracking, handler maps, and lifecycle counters are not
public APIs.
