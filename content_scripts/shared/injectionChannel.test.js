import { describe, expect, jest, test } from '@jest/globals';
import { runInNewContext } from 'node:vm';

import { createInjectionChannel } from './injectionChannel.js';

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

function extractCapability(channel) {
    const scriptUrl = channel.createScriptUrl(SCRIPT_URL);
    return new URL(scriptUrl).hash.slice('#dualsub-channel=disneyplus.'.length);
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
    test('mints one fresh 256-bit capability for each content-script owner', () => {
        const crypto = createDeterministicCrypto();
        const first = createInjectionChannel(PLATFORM, crypto);
        const second = createInjectionChannel(PLATFORM, crypto);

        expect(extractCapability(first)).toMatch(/^[0-9a-f]{64}$/u);
        expect(extractCapability(second)).not.toBe(extractCapability(first));
        expect(crypto.getRandomValues).toHaveBeenCalledTimes(2);
    });

    test.each([
        ['unsupported platform', 'other', createDeterministicCrypto()],
        ['missing crypto', PLATFORM, null],
        ['missing RNG', PLATFORM, {}],
        [
            'wrong RNG result',
            PLATFORM,
            { getRandomValues: () => new Uint8Array(32) },
        ],
        [
            'throwing RNG',
            PLATFORM,
            {
                getRandomValues: () => {
                    throw new Error('rng unavailable');
                },
            },
        ],
    ])('fails closed for %s', (_label, platform, crypto) => {
        expect(createInjectionChannel(platform, crypto)).toBeNull();
    });

    test('validates and strips the authority once at page-event ingress', () => {
        const channel = createInjectionChannel(
            PLATFORM,
            createDeterministicCrypto()
        );
        const capability = extractCapability(channel);

        const accepted = channel.accept(
            createEvent('SUBTITLE_URL_FOUND', capability)
        );

        expect(accepted).toEqual({
            type: 'SUBTITLE_URL_FOUND',
            payload: { value: 1 },
        });
        expect(accepted).not.toHaveProperty('dualsubChannel');
        expect(Object.isFrozen(accepted)).toBe(true);
        expect(channel.accept({ detail: accepted })).toBeNull();
    });

    test('accepts event data created in the page realm', () => {
        const channel = createInjectionChannel(
            PLATFORM,
            createDeterministicCrypto()
        );
        const capability = extractCapability(channel);
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
        ['missing authority', (event) => delete event.detail.dualsubChannel],
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
            'inherited authority',
            (event) => {
                const authority = event.detail.dualsubChannel;
                delete event.detail.dualsubChannel;
                Object.setPrototypeOf(event.detail, {
                    dualsubChannel: authority,
                });
            },
        ],
    ])('rejects %s', (_label, mutate) => {
        const channel = createInjectionChannel(
            PLATFORM,
            createDeterministicCrypto()
        );
        const capability = extractCapability(channel);
        const event = createEvent('SUBTITLE_URL_FOUND', capability);
        mutate(event);

        expect(channel.accept(event)).toBeNull();
    });

    test('creates page controls and script URLs until revoked', () => {
        const channel = createInjectionChannel(
            PLATFORM,
            createDeterministicCrypto()
        );
        const capability = extractCapability(channel);

        expect(
            channel.createEventDetail('REQUEST_PLAYBACK_TIMELINE', {
                sequence: 1,
            })
        ).toEqual({
            type: 'REQUEST_PLAYBACK_TIMELINE',
            sequence: 1,
            dualsubChannel: { platform: PLATFORM, capability },
        });
        expect(channel.createScriptUrl(SCRIPT_URL)).toMatch(
            /^chrome-extension:\/\/dualsub-test\/injected_scripts\/disneyPlusInject\.js#dualsub-channel=disneyplus\.[0-9a-f]{64}$/u
        );

        channel.revoke();

        expect(channel.accept(createEvent('READY', capability))).toBeNull();
        expect(channel.createEventDetail('READY')).toBeNull();
        expect(channel.createScriptUrl(SCRIPT_URL)).toBeNull();
    });
});
