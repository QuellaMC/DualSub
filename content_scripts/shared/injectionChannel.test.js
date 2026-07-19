import { describe, expect, jest, test } from '@jest/globals';
import { runInNewContext } from 'node:vm';

import {
    acceptInjectedEvent,
    createInjectedScriptUrl,
    createInjectionChannelRegistry,
    extendAcceptedInjectedEvent,
    revokeInjectionChannel,
} from './injectionChannel.js';

const PLATFORM = 'disneyplus';
const SCRIPT_URL =
    'chrome-extension://dualsub-test/injected_scripts/disneyPlusInject.js';

function createDeterministicCrypto(seed = 1) {
    let request = 0;
    return {
        getRandomValues: jest.fn((bytes) => {
            for (let index = 0; index < bytes.length; index += 1) {
                bytes[index] = (seed + request + index) & 0xff;
            }
            request += 1;
            return bytes;
        }),
    };
}

function extractCapability(scriptUrl) {
    const value = new URL(scriptUrl).hash;
    return value.slice(value.lastIndexOf('.') + 1);
}

function createEvent(type, capability, overrides = {}) {
    return {
        detail: {
            type,
            payload: { value: 1 },
            dualsubChannel: {
                platform: PLATFORM,
                capability,
            },
            ...overrides,
        },
    };
}

describe('shared page injection channel', () => {
    test('mints one stable 256-bit canonical capability per document platform', () => {
        const crypto = createDeterministicCrypto();
        const registry = createInjectionChannelRegistry(() => crypto);
        const first = registry.createChannel(PLATFORM);
        const second = registry.createChannel(PLATFORM);
        const netflix = registry.createChannel('netflix');

        const firstUrl = first.createScriptUrl(SCRIPT_URL);
        const secondUrl = second.createScriptUrl(SCRIPT_URL);
        const netflixUrl = netflix.createScriptUrl(
            'chrome-extension://dualsub-test/injected_scripts/netflixInject.js'
        );

        expect(extractCapability(firstUrl)).toMatch(/^[0-9a-f]{64}$/u);
        expect(extractCapability(secondUrl)).toBe(extractCapability(firstUrl));
        expect(extractCapability(netflixUrl)).not.toBe(
            extractCapability(firstUrl)
        );
        first.revoke();
        expect(
            extractCapability(
                registry.createChannel(PLATFORM).createScriptUrl(SCRIPT_URL)
            )
        ).toBe(extractCapability(secondUrl));
        expect(crypto.getRandomValues).toHaveBeenCalledTimes(2);
    });

    test.each([
        undefined,
        null,
        {},
        { getRandomValues: () => new Uint8Array(32) },
        {
            getRandomValues: (bytes) => {
                bytes.fill(0);
                return bytes;
            },
        },
        {
            getRandomValues: () => {
                throw new Error('rng unavailable');
            },
        },
    ])('fails closed when secure RNG is unavailable or invalid', (crypto) => {
        const registry = createInjectionChannelRegistry(() => crypto);
        expect(registry.createChannel(PLATFORM)).toBeNull();
    });

    test('accepts a valid exact authority envelope and strips it', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );

        const accepted = channel.accept(
            createEvent('SUBTITLE_URL_FOUND', capability)
        );

        expect(accepted).toEqual({
            type: 'SUBTITLE_URL_FOUND',
            payload: { value: 1 },
        });
        expect(accepted).not.toHaveProperty('dualsubChannel');
        expect(Object.isFrozen(accepted)).toBe(true);
        expect(channel.accept({ detail: accepted })).toBe(accepted);
    });

    test('accepts a plain exact event created in a foreign page realm', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );
        const detail = runInNewContext(
            `({
                type: 'SUBTITLE_URL_FOUND',
                dualsubChannel: {
                    platform: 'disneyplus',
                    capability: '${capability}'
                }
            })`
        );

        expect(channel.accept({ detail })).toEqual({
            type: 'SUBTITLE_URL_FOUND',
        });
    });

    test.each([
        ['missing', (event) => delete event.detail.dualsubChannel],
        [
            'wrong platform',
            (event) => (event.detail.dualsubChannel.platform = 'netflix'),
        ],
        [
            'wrong capability',
            (event) =>
                (event.detail.dualsubChannel.capability = 'f'.repeat(64)),
        ],
        [
            'noncanonical capability',
            (event) =>
                (event.detail.dualsubChannel.capability = 'A'.repeat(64)),
        ],
        [
            'extra authority key',
            (event) => (event.detail.dualsubChannel.extra = true),
        ],
        [
            'inherited authority',
            (event) => {
                const authority = event.detail.dualsubChannel;
                delete event.detail.dualsubChannel;
                Object.setPrototypeOf(event.detail, {
                    dualsubChannel: authority,
                });
            },
        ],
        [
            'exotic authority',
            (event) =>
                Object.setPrototypeOf(event.detail.dualsubChannel, {
                    inherited: true,
                }),
        ],
    ])('rejects %s', (_label, mutate) => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );
        const event = createEvent('SUBTITLE_URL_FOUND', capability);
        mutate(event);
        expect(channel.accept(event)).toBeNull();
    });

    test('rejects accessors without invoking hostile getters', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const getter = jest.fn(() => ({
            platform: PLATFORM,
            capability: '0'.repeat(64),
        }));
        const detail = { type: 'SUBTITLE_URL_FOUND' };
        Object.defineProperty(detail, 'dualsubChannel', {
            enumerable: true,
            get: getter,
        });

        expect(channel.accept({ detail })).toBeNull();
        expect(getter).not.toHaveBeenCalled();
    });

    test('fails closed on revoked and trap-throwing proxies', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();

        expect(channel.accept({ detail: proxy })).toBeNull();
        expect(
            channel.accept({
                detail: new Proxy(
                    {},
                    {
                        ownKeys() {
                            throw new Error('hostile');
                        },
                    }
                ),
            })
        ).toBeNull();
    });

    test('revocation makes saved listeners and event builders terminal', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );
        const event = createEvent('SUBTITLE_URL_FOUND', capability);
        expect(channel.accept(event)).not.toBeNull();

        channel.revoke();

        expect(channel.accept(event)).toBeNull();
        expect(channel.createEventDetail('PLAYBACK_BRIDGE_PAUSE')).toBeNull();
        expect(channel.createScriptUrl(SCRIPT_URL)).toBeNull();
    });

    test('generic Base seam reads only an own channel data property', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );
        const event = createEvent('SUBTITLE_URL_FOUND', capability);

        expect(acceptInjectedEvent({ channel }, event)).not.toBeNull();
        expect(
            acceptInjectedEvent(Object.create({ channel }), event)
        ).toBeNull();

        const getter = jest.fn(() => channel);
        const config = {};
        Object.defineProperty(config, 'channel', { get: getter });
        expect(acceptInjectedEvent(config, event)).toBeNull();
        expect(getter).not.toHaveBeenCalled();
    });

    test('generic Base seam decorates and terminally revokes the configured channel', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const config = { channel };

        expect(createInjectedScriptUrl(config, SCRIPT_URL)).toMatch(
            /^chrome-extension:\/\/dualsub-test\/injected_scripts\/disneyPlusInject\.js#dualsub-channel=disneyplus\.[0-9a-f]{64}$/u
        );
        expect(revokeInjectionChannel(config)).toBe(true);
        expect(createInjectedScriptUrl(config, SCRIPT_URL)).toBeNull();
        expect(revokeInjectionChannel(Object.create({ channel }))).toBe(false);
    });

    test('extends one accepted event for the early buffer without restoring authority', () => {
        const registry = createInjectionChannelRegistry(() =>
            createDeterministicCrypto()
        );
        const channel = registry.createChannel(PLATFORM);
        const capability = extractCapability(
            channel.createScriptUrl(SCRIPT_URL)
        );
        const accepted = channel.accept(
            createEvent('SUBTITLE_URL_FOUND', capability)
        );
        const extended = extendAcceptedInjectedEvent(accepted, {
            timestamp: 123,
            pageUrl: 'https://www.disneyplus.com/play/episode-123',
        });

        expect(extended).toEqual({
            type: 'SUBTITLE_URL_FOUND',
            payload: { value: 1 },
            timestamp: 123,
            pageUrl: 'https://www.disneyplus.com/play/episode-123',
        });
        expect(extended).not.toHaveProperty('dualsubChannel');
        expect(channel.accept({ detail: extended })).toBe(extended);
    });
});
