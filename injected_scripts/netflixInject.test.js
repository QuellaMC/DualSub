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
                movieId: 'NETFLIX_MOVIE_ID_CANARY',
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

        const consoleArguments = Object.values(consoleSpies).flatMap((spy) =>
            spy.mock.calls.flat()
        );
        expect(consoleArguments.length).toBeGreaterThan(0);
        for (const argument of consoleArguments) {
            expect(typeof argument).toBe('string');
            expect(argument).not.toContain(response.result.movieId);
            expect(argument).not.toContain(CAPABILITY);
        }
    });

    test('fails closed for a missing tag, wrong channel, or non-extension URL', () => {
        const invalidSetups = [
            () => {},
            () =>
                installTaggedScript(
                    `#dualsub-channel=disneyplus.${CAPABILITY}`
                ),
            () =>
                installTaggedScript('', {
                    src: `https://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${CAPABILITY}`,
                }),
        ];

        for (const setup of invalidSetups) {
            document.head.replaceChildren();
            injectorEvents.length = 0;
            delete window.netflixDualSubInjectorLoaded;
            setup();

            window.eval(injectorSource);

            expect(JSON.parse).toBe(originalJsonParse);
            expect(injectorEvents).toEqual([]);
            expect(window.netflixDualSubInjectorLoaded).toBeUndefined();
        }
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
