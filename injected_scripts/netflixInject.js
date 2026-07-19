// injected_scripts/netflixInject.js

(() => {
    const INJECT_EVENT_ID = 'netflix-dualsub-injector-event';
    const INJECT_SCRIPT_TAG_ID = 'netflix-dualsub-injector-script-tag';
    const INJECTOR_STATE_KEY = 'netflixDualSubInjectorLoaded';
    const INJECT_SCRIPT_PATH = '/injected_scripts/netflixInject.js';
    const MAX_INJECT_SCRIPT_SRC_LENGTH = 512;
    const CHANNEL_HASH_PATTERN = /^#dualsub-channel=netflix\.([0-9a-f]{64})$/u;

    let capability;
    try {
        const script = document.getElementById(INJECT_SCRIPT_TAG_ID);
        if (
            !(script instanceof HTMLScriptElement) ||
            script.id !== INJECT_SCRIPT_TAG_ID ||
            script.localName !== 'script'
        ) {
            return;
        }
        const rawSrc = script.getAttribute('src');
        if (
            typeof rawSrc !== 'string' ||
            rawSrc.length === 0 ||
            rawSrc.length > MAX_INJECT_SCRIPT_SRC_LENGTH ||
            rawSrc !== rawSrc.trim() ||
            !rawSrc.startsWith('chrome-extension://')
        ) {
            return;
        }
        const scriptUrl = new URL(rawSrc);
        if (
            scriptUrl.protocol !== 'chrome-extension:' ||
            !scriptUrl.hostname ||
            scriptUrl.username ||
            scriptUrl.password ||
            scriptUrl.port ||
            scriptUrl.search ||
            scriptUrl.pathname !== INJECT_SCRIPT_PATH ||
            rawSrc !==
                `chrome-extension://${scriptUrl.hostname}${INJECT_SCRIPT_PATH}${scriptUrl.hash}`
        ) {
            return;
        }
        const match = CHANNEL_HASH_PATTERN.exec(scriptUrl.hash);
        if (!match) return;
        capability = match[1];
    } catch {
        return;
    }

    const createEventDetail = (type, payload) => {
        const detail = {
            type,
            dualsubChannel: {
                platform: 'netflix',
                capability,
            },
        };
        if (payload !== undefined) detail.payload = payload;
        return detail;
    };

    const announceReady = () => {
        document.dispatchEvent(
            new CustomEvent(INJECT_EVENT_ID, {
                detail: createEventDetail('INJECT_SCRIPT_READY'),
            })
        );
        console.log('Netflix Inject script: Dispatched ready event.');
    };

    try {
        const stateDescriptor = Object.getOwnPropertyDescriptor(
            window,
            INJECTOR_STATE_KEY
        );
        if (stateDescriptor) {
            if (!Object.hasOwn(stateDescriptor, 'value')) return;
            const state = stateDescriptor.value;
            if (
                state?.capability !== capability ||
                typeof state?.announceReady !== 'function'
            ) {
                return;
            }
            state.announceReady();
            return;
        }

        const originalJSONParse = JSON.parse;
        const installedJSONParse = function (text, reviver) {
            const parsedObject = originalJSONParse(text, reviver);

            try {
                if (
                    parsedObject &&
                    parsedObject.result &&
                    parsedObject.result.timedtexttracks &&
                    parsedObject.result.movieId
                ) {
                    document.dispatchEvent(
                        new CustomEvent(INJECT_EVENT_ID, {
                            detail: createEventDetail('SUBTITLE_DATA_FOUND', {
                                movieId: parsedObject.result.movieId,
                                timedtexttracks:
                                    parsedObject.result.timedtexttracks,
                            }),
                        })
                    );
                    console.log(
                        'Netflix Inject script: Dispatched subtitle event.'
                    );
                }
            } catch {
                // JSON parsing must remain transparent when inspection fails.
            }
            return parsedObject;
        };

        const state = Object.freeze({
            announceReady,
            capability,
            installedJSONParse,
        });
        Object.defineProperty(window, INJECTOR_STATE_KEY, {
            configurable: true,
            enumerable: false,
            value: state,
            writable: false,
        });
        JSON.parse = installedJSONParse;
        console.log('Netflix Inject script: JSON interception installed.');
        announceReady();
    } catch {
        console.error('Netflix Inject script: Initialization failed.');
    }
})();
