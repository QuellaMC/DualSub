# Adding a streaming platform

Add a platform only when its player exposes a stable subtitle source and the
extension can identify player-page transitions. Start from the existing Netflix
or Disney+ adapter and keep the new code limited to site-specific behavior.

## 1. Define route classification

Add a pure player-path classifier to `shared/navigationUtils.js`. Cover positive
and negative routes with behavior tests. The platform class should call that
classifier from `_isPlayerPath(pathname)`.

Do not install platform-owned History API hooks or polling. Implement
`setupNavigationDetection()` by delegating to Base:

```javascript
setupNavigationDetection() {
    this._setupNavigationManager();
}
```

## 2. Add the injected page script

The page-world script observes the site's player APIs and emits only the data the
content script needs. It must use a lifecycle capability from the injected script
URL and include the matching channel detail on each event.

Treat every page event as untrusted. Keep platform/video identity checks in the
content-script ingress and subtitle request policy.

Add the injected script to `web_accessible_resources` in `manifest.json`.

## 3. Add the platform runtime adapter

The runtime adapter belongs under `platforms/` and owns site-specific player and
subtitle-track behavior. Reuse shared subtitle fetching, parsing, rendering,
translation, logging, and cleanup.

It should not create a second runtime-message protocol or duplicate request
validation already owned by the content-script ingress.

## 4. Add the content-script class

Extend `BaseContentScript` and implement the required seams:

```javascript
import { BaseContentScript } from '../core/BaseContentScript.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';

export class ExampleContentScript extends BaseContentScript {
    constructor() {
        super('ExampleContent');
        this.injectConfig = {
            filename: 'injected_scripts/exampleInject.js',
            tagId: 'example-dualsub-injector-script-tag',
            eventId: 'example-dualsub-injector-event',
            channel: createInjectionChannel('example'),
        };
    }

    getPlatformName() {
        return 'example';
    }

    getPlatformClass() {
        return 'ExamplePlatform';
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    setupNavigationDetection() {
        this._setupNavigationManager();
    }
}
```

`createInjectionChannel()` currently has an explicit supported-platform allowlist;
extend that allowlist with the platform and cover the new channel in tests.

## 5. Add the entry point and manifest match

The entry point should instantiate the platform content-script class once and call
`initialize()`. Add its site match and bundled entry point to `manifest.json`.
Request only the host permissions needed for the player and subtitle endpoints.

## 6. Test behavior at boundaries

Cover the smallest set of observable contracts:

- player and non-player route classification
- accepted current-lifecycle page event and rejected stale/forged event
- subtitle identity changes and duplicate cue handling
- enter/leave/re-enter cleanup and generation cancellation
- Promise-based runtime messaging and protocol parsing
- configuration changes that enable, disable, or reconfigure subtitles

Use runtime fixtures and public behavior. Do not test source strings, comment text,
private field counts, or duplicated matrices of JavaScript object tricks.

## 7. Verify the extension

```bash
npm test
npm run lint
npm run format:check
npm run build
npm run verify:build
```

Finally, exercise the real player: enter a title, enable subtitles, change episode
or route, leave the player, and re-enter. Confirm that cues do not duplicate and
that the old player cannot update the new lifecycle.
