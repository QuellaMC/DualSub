import fs from 'node:fs';

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';

const injectorSource = fs.readFileSync(
    new URL('./netflixInject.js', import.meta.url),
    'utf8'
);
const EVENT_ID = 'netflix-dualsub-injector-event';
const SCRIPT_ID = 'netflix-dualsub-injector-script-tag';
const CAPABILITY = 'a1'.repeat(32);
const OTHER_CAPABILITY = 'b2'.repeat(32);
const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];

function installTaggedScript(
    channelHash,
    {
        id = SCRIPT_ID,
        src = `chrome-extension://dualsub-test/injected_scripts/netflixInject.js${channelHash}`,
        tagName = 'script',
    } = {}
) {
    const script = document.createElement(tagName);
    script.id = id;
    if (script instanceof HTMLScriptElement) {
        script.type = 'application/json';
    }
    script.setAttribute('src', src);
    document.head.appendChild(script);
    return script;
}

function expectExactChannel(detail, capability = CAPABILITY) {
    const descriptor = Object.getOwnPropertyDescriptor(
        detail,
        'dualsubChannel'
    );
    expect(descriptor).toEqual(
        expect.objectContaining({
            enumerable: true,
            value: expect.any(Object),
        })
    );
    expect(Object.keys(descriptor.value).sort()).toEqual([
        'capability',
        'platform',
    ]);
    expect(descriptor.value).toEqual({
        platform: 'netflix',
        capability,
    });
}

describe('Netflix page injector capability lifecycle', () => {
    let originalJsonParse;
    let injectorEvents;
    let eventHandler;
    let consoleSpies;

    beforeEach(() => {
        originalJsonParse = JSON.parse;
        document.head.replaceChildren();
        injectorEvents = [];
        eventHandler = (event) => injectorEvents.push(event.detail);
        document.addEventListener(EVENT_ID, eventHandler);
        delete window.netflixDualSubInjectorLoaded;
        consoleSpies = Object.fromEntries(
            consoleMethods.map((method) => [
                method,
                jest.spyOn(console, method).mockImplementation(() => {}),
            ])
        );
    });

    afterEach(() => {
        JSON.parse = originalJsonParse;
        delete window.netflixDualSubInjectorLoaded;
        document.removeEventListener(EVENT_ID, eventHandler);
        document.head.replaceChildren();
        Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    });

    test('installs only from the exact tagged URL and brands every event', () => {
        installTaggedScript(`#dualsub-channel=netflix.${CAPABILITY}`);

        window.eval(injectorSource);

        expect(JSON.parse).not.toBe(originalJsonParse);
        expect(injectorEvents).toHaveLength(1);
        expect(injectorEvents[0].type).toBe('INJECT_SCRIPT_READY');
        expect(Object.keys(injectorEvents[0]).sort()).toEqual([
            'dualsubChannel',
            'type',
        ]);
        expectExactChannel(injectorEvents[0]);

        const response = {
            result: {
                movieId: '12345',
                timedtexttracks: [{ language: 'en' }],
            },
        };
        expect(JSON.parse(JSON.stringify(response))).toEqual(response);

        expect(injectorEvents).toHaveLength(2);
        expect(injectorEvents[1]).toEqual({
            type: 'SUBTITLE_DATA_FOUND',
            dualsubChannel: {
                platform: 'netflix',
                capability: CAPABILITY,
            },
            payload: response.result,
        });
        expectExactChannel(injectorEvents[1]);

        const serializedLogs = JSON.stringify(
            Object.values(consoleSpies).flatMap((spy) => spy.mock.calls)
        );
        expect(serializedLogs).not.toContain(CAPABILITY);
    });

    test.each([
        ['no hash', ''],
        ['wrong platform', `#dualsub-channel=disneyplus.${CAPABILITY}`],
        [
            'uppercase capability',
            `#dualsub-channel=netflix.${CAPABILITY.toUpperCase()}`,
        ],
        ['short capability', '#dualsub-channel=netflix.a1'],
        ['extra hash data', `#dualsub-channel=netflix.${CAPABILITY}&extra=1`],
    ])('fails closed for %s', (_label, hash) => {
        installTaggedScript(hash);

        window.eval(injectorSource);

        expect(JSON.parse).toBe(originalJsonParse);
        expect(injectorEvents).toEqual([]);
        expect(window.netflixDualSubInjectorLoaded).toBeUndefined();
    });

    test.each([
        [
            'wrong scheme',
            `https://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'script',
        ],
        [
            'wrong path',
            `chrome-extension://dualsub-test/injected_scripts/not-netflix.js#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'script',
        ],
        [
            'query data',
            `chrome-extension://dualsub-test/injected_scripts/netflixInject.js?extra=1#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'script',
        ],
        [
            'credentials',
            `chrome-extension://user:password@dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'script',
        ],
        [
            'port',
            `chrome-extension://dualsub-test:8443/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'script',
        ],
        [
            'extra fragment data',
            `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}&extra=1`,
            SCRIPT_ID,
            'script',
        ],
        [
            'wrong element id',
            `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
            'wrong-netflix-injector-id',
            'script',
        ],
        [
            'wrong element tag',
            `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
            SCRIPT_ID,
            'div',
        ],
    ])('rejects %s before installing', (_label, src, id, tagName) => {
        installTaggedScript('', { id, src, tagName });

        window.eval(injectorSource);

        expect(JSON.parse).toBe(originalJsonParse);
        expect(injectorEvents).toEqual([]);
        expect(window.netflixDualSubInjectorLoaded).toBeUndefined();
    });

    test('rejects an unbounded raw script URL', () => {
        installTaggedScript('', {
            src: `chrome-extension://${'a'.repeat(513)}/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
        });

        window.eval(injectorSource);

        expect(JSON.parse).toBe(originalJsonParse);
        expect(injectorEvents).toEqual([]);
    });

    test('does nothing when the exact script tag is absent', () => {
        const unrelated = document.createElement('script');
        unrelated.src = `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`;
        document.head.appendChild(unrelated);

        window.eval(injectorSource);

        expect(JSON.parse).toBe(originalJsonParse);
        expect(injectorEvents).toEqual([]);
    });

    test('reannounces without duplicate JSON interception or subtitle events', () => {
        installTaggedScript(`#dualsub-channel=netflix.${CAPABILITY}`);
        window.eval(injectorSource);
        const installedParser = JSON.parse;
        injectorEvents.length = 0;

        window.eval(injectorSource);

        expect(JSON.parse).toBe(installedParser);
        expect(
            injectorEvents.filter(
                (detail) => detail.type === 'INJECT_SCRIPT_READY'
            )
        ).toHaveLength(1);

        JSON.parse(
            JSON.stringify({
                result: {
                    movieId: '12345',
                    timedtexttracks: [{ language: 'en' }],
                },
            })
        );
        expect(
            injectorEvents.filter(
                (detail) => detail.type === 'SUBTITLE_DATA_FOUND'
            )
        ).toHaveLength(1);
    });

    test('rejects a reinjection carrying a different document capability', () => {
        const script = installTaggedScript(
            `#dualsub-channel=netflix.${CAPABILITY}`
        );
        window.eval(injectorSource);
        const installedParser = JSON.parse;
        injectorEvents.length = 0;
        script.src = `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${OTHER_CAPABILITY}`;

        window.eval(injectorSource);

        expect(JSON.parse).toBe(installedParser);
        expect(injectorEvents).toEqual([]);
    });
});
