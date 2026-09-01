# Test patterns

Tests should protect observable extension behavior at the boundary that owns it.
Prefer a few representative success, rejection, cancellation, and cleanup cases
over a matrix of equivalent object shapes or private implementation details.

## Shared fixtures

- `chrome-api-mock.js`: Chrome storage, runtime, and tab mocks
- `location-mock.js`: restorable JSDOM location state
- `logger-mock.js`: logger spies
- `test-fixtures.js`: representative Netflix, Disney+, and Chrome payloads
- `subtitle-fetch-fixtures.js`: subtitle response fixtures
- `test-helpers.js`: shared environment setup and cleanup
- `flush-promises.js`: drains queued Promise work when the public operation has
  no completion Promise

Use only the helpers that make the behavior clearer. Local fixtures are preferable
when a shared generator hides the input that matters to the assertion.

## Isolation

Create fresh state per test and restore all browser globals, listeners, timers,
spies, and DOM nodes in `afterEach`.

```javascript
let helpers;
let env;

beforeEach(() => {
    helpers = new TestHelpers();
    env = helpers.setupTestEnvironment({ platform: 'netflix' });
});

afterEach(() => {
    env.cleanup();
    helpers.resetAllMocks();
    jest.useRealTimers();
});
```

Use `LocationMock` instead of assigning `window.location`; JSDOM treats direct
navigation as an unsupported browser operation.

## Runtime messaging

Production runtime sends use Chrome's Promise API. A direct mock should resolve or
reject a Promise:

```javascript
chrome.runtime.sendMessage.mockResolvedValue({ success: true });

await expect(sendOperation()).resolves.toEqual(expectedResult);
expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expectedRequest);
```

Use the route-specific protocol builder for `expectedRequest` and parse the mock
response through the matching parser when testing a caller end to end. Mock
`sendRuntimeMessageWithRetry` only when the caller's response handling, rather than
messaging delivery, is the behavior under test.

For retry tests, distinguish proven non-delivery from terminal failures. Do not
expect retries for ambiguous channel closure or unknown errors.

## Lifecycle tests

For platform, subtitle, modal, or side-panel lifecycles, cover the state changes a
user can observe:

- current work commits normally
- stale work cannot commit after navigation, replacement, disable, or cleanup
- cleanup detaches the actual listener/subscription once
- re-entry starts one fresh lifecycle without duplicate cues or handlers

Prefer deferred Promises to source inspection or private-field assertions:

```javascript
const pending = Promise.withResolvers();
dependency.mockReturnValueOnce(pending.promise);

const first = subject.start();
subject.replace();
pending.resolve(staleResult);
await first;

expect(render).not.toHaveBeenCalledWith(staleResult);
```

## Fake timers

Use fake timers only for behavior controlled by a real debounce, deadline, retry,
or pacing interval. Advance to the public boundary and then await Promise work.
Restore real timers in cleanup.

## What not to test

- source strings, comments, or exact private helper names
- generated documentation examples
- every permutation of getters, proxies, descriptors, and frozen objects when one
  ordinary malformed payload proves the same public rejection
- platform behavior already covered by the shared host
- legacy runtime-messaging forms for Promise-only production callers
- arbitrary coverage targets without an unprotected behavior

Run a focused suite while editing, then use `npm run test:ci` before handoff.
