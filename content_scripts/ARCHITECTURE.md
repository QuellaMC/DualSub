# Content-script architecture

## Ownership

`BaseContentScript` is the content-script host. It owns the shared lifecycle and
delegates only platform differences to `NetflixContentScript` and
`DisneyPlusContentScript`.

```text
manifest entry point
  -> platform content-script class
     -> BaseContentScript lifecycle
        -> platform runtime adapter
        -> subtitle utilities
        -> AI-context manager and side-panel integration
```

The platform class supplies:

- `getPlatformName()`
- `getPlatformClass()`
- `getInjectScriptConfig()`
- `setupNavigationDetection()`, delegating to `_setupNavigationManager()`
- `_isPlayerPath(pathname)` and page-transition behavior

Everything else stays in the shared host unless the streaming site genuinely
requires different behavior.

## Initialization and cleanup

`initialize()` loads the shared modules, reads configuration, attaches the closed
runtime route table, initializes the current platform when appropriate, starts
the shared navigation manager, and enables configured AI-context features.

Navigation changes carry a generation. Leaving or replacing a player invalidates
older platform work before cleanup, so a late initialization or subtitle result
cannot become current again. `cleanup()` revokes the injection channel, cancels
pending lifecycle work, detaches listeners and observers, destroys AI-context and
side-panel state, and cleans the active platform.

`BaseContentScript` owns `NavigationDetectionManager`. A platform adapter calls
`_setupNavigationManager()` and supplies route classification; it does not install
a second set of History API listeners or polling timers.

## Page-world boundary

The injected page script and content script communicate through
`shared/injectionChannel.js`.

1. The content script creates a random capability for its lifecycle.
2. The capability is attached to the injected script URL.
3. The page script includes the platform and capability in each event.
4. The content script accepts only events for the current channel, then applies
   the normal subtitle identity and request-policy checks.
5. Cleanup revokes the channel.

The capability identifies the current injection lifecycle; it does not make host
page data trusted by itself.

Subtitle events that arrive before platform initialization may be buffered briefly
and are revalidated when processed. The buffer is an internal handoff mechanism,
not a public diagnostics or maintenance API.

## Extension-message boundary

`shared/protocol/messageProtocol.js` is the single contract catalog for messages
between extension contexts. Builders create outbound messages; parsers validate
inbound messages and bind responses to the corresponding request.

`BaseContentScript` exposes a closed runtime route table for its active controls.
Unknown actions, unauthorized sender roles, malformed fields, and extra fields are
rejected. Platform adapters do not register fallback routes.

`shared/messaging.js` uses Chrome's Promise-based `runtime.sendMessage`. It retries
only known no-receiver/no-service-worker failures. Channel closure and unknown
errors are terminal because a receiver may already have accepted the request.

## Subtitle and AI-context ownership

Platform runtime adapters discover subtitle tracks and player state. Shared
subtitle utilities fetch, parse, render, and update cues. Interactive subtitle
words publish private intents into the active AI-context lifecycle; DOM event
payloads are not an analysis authority.

The AI-context manager owns selection state and the modal or side-panel UX. A new
generation revokes the previous analysis authority, subscriptions, and outstanding
work before the replacement can commit UI state.

## Configuration

The content-script host reads normalized configuration from `ConfigService` and
reacts to validated configuration-change messages. Sensitive provider credentials
remain background/options concerns and are not part of ordinary content-script
configuration snapshots.

## Extension rules

- Reuse the shared lifecycle and protocol before adding a new helper or route.
- Keep validation at the ingress that owns the data; do not duplicate it in every
  downstream consumer.
- Keep platform classes limited to site-specific behavior.
- Cancel or generation-guard asynchronous work before it can update current state.
- Add behavior tests at the owning boundary; avoid tests that inspect source text
  or private implementation layout.

See [API_REFERENCE.md](./API_REFERENCE.md) for the supported seams and
[PLATFORM_IMPLEMENTATION_GUIDE.md](./PLATFORM_IMPLEMENTATION_GUIDE.md) for a new
platform checklist.
