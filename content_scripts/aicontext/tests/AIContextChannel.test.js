import { describe, expect, jest, test } from '@jest/globals';
import {
    AI_CONTEXT_SIGNAL_TYPES,
    createAIContextChannel,
} from '../core/AIContextChannel.js';

const wordIntent = (overrides = {}) => ({
    action: 'toggle',
    renderRevision: 1,
    wordIndex: 0,
    word: 'bonjour',
    sourceLanguage: 'fr',
    targetLanguage: 'en',
    ...overrides,
});

const subtitleChanged = (overrides = {}) => ({
    renderRevision: 1,
    reason: 'render',
    videoId: 'video-1',
    text: 'bonjour',
    ...overrides,
});

const selectionSnapshot = (overrides = {}) => ({
    selectionRevision: 1,
    renderRevision: 1,
    reason: 'toggle',
    entries: [{ wordIndex: 0, word: 'bonjour' }],
    ...overrides,
});

const analysisRequest = (overrides = {}) => ({
    requestId: 1,
    selectionRevision: 1,
    cause: 'user',
    retryOf: null,
    contextTypes: ['cultural'],
    ...overrides,
});

const analysisCancel = (overrides = {}) => ({
    requestId: 1,
    reason: 'user',
    ...overrides,
});

const analysisSettled = (overrides = {}) => ({
    requestId: 1,
    outcome: 'succeeded',
    ...overrides,
});

const validPayloadFor = (type) =>
    ({
        WORD_INTENT: wordIntent,
        SUBTITLE_CHANGED: subtitleChanged,
        SELECTION_SNAPSHOT: selectionSnapshot,
        ANALYSIS_REQUEST: analysisRequest,
        ANALYSIS_CANCEL: analysisCancel,
        ANALYSIS_SETTLED: analysisSettled,
    })[type]();

const publishOnce = (type, payload) => {
    const channel = createAIContextChannel({ lifecycleGeneration: 99 });
    channel.subscribe(type, () => {});
    return channel.publish(type, payload);
};

describe('AIContextChannel', () => {
    test('exports one exact frozen signal catalog for integrations', () => {
        expect(AI_CONTEXT_SIGNAL_TYPES).toEqual({
            WORD_INTENT: 'WORD_INTENT',
            SUBTITLE_CHANGED: 'SUBTITLE_CHANGED',
            SELECTION_SNAPSHOT: 'SELECTION_SNAPSHOT',
            ANALYSIS_REQUEST: 'ANALYSIS_REQUEST',
            ANALYSIS_CANCEL: 'ANALYSIS_CANCEL',
            ANALYSIS_SETTLED: 'ANALYSIS_SETTLED',
        });
        expect(Object.isFrozen(AI_CONTEXT_SIGNAL_TYPES)).toBe(true);
        expect(Reflect.ownKeys(AI_CONTEXT_SIGNAL_TYPES)).toHaveLength(6);
    });

    test('creates the exact minimal channel surface for a valid generation', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 0 });

        expect(Reflect.ownKeys(channel).sort()).toEqual([
            'destroy',
            'publish',
            'subscribe',
        ]);
        expect(Object.isFrozen(channel)).toBe(true);
        expect(channel.publish).toEqual(expect.any(Function));
        expect(channel.subscribe).toEqual(expect.any(Function));
        expect(channel.destroy).toEqual(expect.any(Function));
    });

    test('rejects invalid lifecycle generations without invoking accessors', () => {
        const invalidGenerations = [
            -1,
            1.5,
            Number.MAX_SAFE_INTEGER + 1,
            Infinity,
            '1',
            null,
            undefined,
        ];

        for (const lifecycleGeneration of invalidGenerations) {
            expect(() =>
                createAIContextChannel({ lifecycleGeneration })
            ).toThrow(TypeError);
        }

        let getterCalls = 0;
        const accessorOptions = {};
        Object.defineProperty(accessorOptions, 'lifecycleGeneration', {
            get() {
                getterCalls += 1;
                return 1;
            },
        });

        expect(() => createAIContextChannel(accessorOptions)).toThrow(
            TypeError
        );
        expect(getterCalls).toBe(0);
    });

    test('publishes an authenticated envelope to subscribers of an allowed type', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        const received = [];
        channel.subscribe('WORD_INTENT', (envelope) => {
            received.push(envelope);
        });

        expect(channel.publish('WORD_INTENT', wordIntent())).toBe(1);
        expect(received).toEqual([
            {
                type: 'WORD_INTENT',
                lifecycleGeneration: 7,
                payload: wordIntent(),
            },
        ]);
    });

    test('rejects an incomplete word intent before delivery', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        const listener = jest.fn();
        channel.subscribe('WORD_INTENT', listener);

        expect(channel.publish('WORD_INTENT', { word: 'bonjour' })).toBe(0);
        expect(listener).not.toHaveBeenCalled();
    });

    test('enforces the subtitle change reason contract', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        const listener = jest.fn();
        channel.subscribe('SUBTITLE_CHANGED', listener);

        expect(channel.publish('SUBTITLE_CHANGED', subtitleChanged())).toBe(1);
        expect(
            channel.publish(
                'SUBTITLE_CHANGED',
                subtitleChanged({ reason: 'unknown' })
            )
        ).toBe(0);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('accepts duplicate selected words at distinct ascending indices', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        channel.subscribe('SELECTION_SNAPSHOT', () => {});
        const duplicateOccurrences = selectionSnapshot({
            entries: [
                { wordIndex: 1, word: 'echo' },
                { wordIndex: 3, word: 'echo' },
            ],
        });
        const descendingOccurrences = selectionSnapshot({
            entries: [
                { wordIndex: 3, word: 'echo' },
                { wordIndex: 1, word: 'echo' },
            ],
        });
        const equalIndexOccurrences = selectionSnapshot({
            entries: [
                { wordIndex: 1, word: 'echo' },
                { wordIndex: 1, word: 'echo' },
            ],
        });

        expect(
            channel.publish('SELECTION_SNAPSHOT', duplicateOccurrences)
        ).toBe(1);
        expect(
            channel.publish('SELECTION_SNAPSHOT', descendingOccurrences)
        ).toBe(0);
        expect(
            channel.publish('SELECTION_SNAPSHOT', equalIndexOccurrences)
        ).toBe(0);
    });

    test('requires canonical analysis context order and retry correlation', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        channel.subscribe('ANALYSIS_REQUEST', () => {});

        expect(
            channel.publish(
                'ANALYSIS_REQUEST',
                analysisRequest({
                    contextTypes: ['cultural', 'linguistic'],
                })
            )
        ).toBe(1);
        expect(
            channel.publish(
                'ANALYSIS_REQUEST',
                analysisRequest({
                    contextTypes: ['linguistic', 'cultural'],
                })
            )
        ).toBe(0);
        expect(
            channel.publish(
                'ANALYSIS_REQUEST',
                analysisRequest({ cause: 'retry', retryOf: null })
            )
        ).toBe(0);
    });

    test('accepts only the exact analysis cancellation reasons', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        channel.subscribe('ANALYSIS_CANCEL', () => {});

        for (const reason of [
            'user',
            'superseded',
            'modal-closed',
            'selection-invalidated',
        ]) {
            expect(
                channel.publish('ANALYSIS_CANCEL', analysisCancel({ reason }))
            ).toBe(1);
        }
        expect(
            channel.publish(
                'ANALYSIS_CANCEL',
                analysisCancel({ reason: 'unknown' })
            )
        ).toBe(0);
    });

    test('enforces the discriminated analysis settled union', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        channel.subscribe('ANALYSIS_SETTLED', () => {});

        expect(channel.publish('ANALYSIS_SETTLED', analysisSettled())).toBe(1);
        expect(
            channel.publish('ANALYSIS_SETTLED', {
                requestId: 1,
                outcome: 'failed',
                code: 'network',
                retryable: true,
            })
        ).toBe(1);
        expect(
            channel.publish('ANALYSIS_SETTLED', {
                requestId: 1,
                outcome: 'cancelled',
                reason: 'superseded',
            })
        ).toBe(1);
        expect(
            channel.publish('ANALYSIS_SETTLED', {
                requestId: 1,
                outcome: 'succeeded',
                code: 'network',
            })
        ).toBe(0);
    });

    test('requires exact enumerable own-data records for every signal', () => {
        for (const type of Object.values(AI_CONTEXT_SIGNAL_TYPES)) {
            expect(publishOnce(type, validPayloadFor(type))).toBe(1);

            const missingRequired = validPayloadFor(type);
            delete missingRequired[Object.keys(missingRequired)[0]];
            expect(publishOnce(type, missingRequired)).toBe(0);

            const extraField = { ...validPayloadFor(type), extra: true };
            expect(publishOnce(type, extraField)).toBe(0);

            const symbolField = validPayloadFor(type);
            symbolField[Symbol('extra')] = true;
            expect(publishOnce(type, symbolField)).toBe(0);

            const nonenumerableField = validPayloadFor(type);
            Object.defineProperty(nonenumerableField, 'extra', {
                value: true,
            });
            expect(publishOnce(type, nonenumerableField)).toBe(0);

            let getterCalls = 0;
            const accessorField = validPayloadFor(type);
            const accessorKey = Object.keys(accessorField)[0];
            Object.defineProperty(accessorField, accessorKey, {
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return 'leaked';
                },
            });
            expect(publishOnce(type, accessorField)).toBe(0);
            expect(getterCalls).toBe(0);

            const exoticRecord = validPayloadFor(type);
            Object.setPrototypeOf(exoticRecord, { exotic: true });
            expect(publishOnce(type, exoticRecord)).toBe(0);
        }
    });

    test('enforces reason, cause, outcome, and failure-code enums', () => {
        expect(
            publishOnce('WORD_INTENT', wordIntent({ action: 'unknown' }))
        ).toBe(0);

        const validSubtitleReasons = [
            subtitleChanged({ reason: 'render' }),
            subtitleChanged({ reason: 'refresh' }),
            subtitleChanged({ reason: 'expired', text: '' }),
            subtitleChanged({ reason: 'clear', text: '', videoId: null }),
        ];
        for (const payload of validSubtitleReasons) {
            expect(publishOnce('SUBTITLE_CHANGED', payload)).toBe(1);
        }
        for (const payload of [
            subtitleChanged({ reason: 'unknown' }),
            subtitleChanged({ reason: 'render', text: '' }),
            subtitleChanged({ reason: 'expired', text: 'still present' }),
            subtitleChanged({ reason: 'clear', videoId: 'video-1', text: '' }),
        ]) {
            expect(publishOnce('SUBTITLE_CHANGED', payload)).toBe(0);
        }

        for (const reason of ['toggle', 'remove']) {
            expect(
                publishOnce('SELECTION_SNAPSHOT', selectionSnapshot({ reason }))
            ).toBe(1);
            expect(
                publishOnce(
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({ reason, entries: [] })
                )
            ).toBe(1);
        }
        for (const reason of ['add', 'restore']) {
            expect(
                publishOnce('SELECTION_SNAPSHOT', selectionSnapshot({ reason }))
            ).toBe(1);
            expect(
                publishOnce(
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({ reason, entries: [] })
                )
            ).toBe(0);
        }
        for (const reason of ['clear', 'subtitle-change']) {
            expect(
                publishOnce(
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({ reason, entries: [] })
                )
            ).toBe(1);
            expect(
                publishOnce('SELECTION_SNAPSHOT', selectionSnapshot({ reason }))
            ).toBe(0);
        }
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({ reason: 'unknown' })
            )
        ).toBe(0);
        expect(publishOnce('ANALYSIS_REQUEST', analysisRequest())).toBe(1);
        expect(
            publishOnce(
                'ANALYSIS_REQUEST',
                analysisRequest({ cause: 'retry', retryOf: 1 })
            )
        ).toBe(1);
        expect(
            publishOnce(
                'ANALYSIS_REQUEST',
                analysisRequest({ cause: 'user', retryOf: 1 })
            )
        ).toBe(0);
        expect(
            publishOnce(
                'ANALYSIS_REQUEST',
                analysisRequest({ cause: 'unknown' })
            )
        ).toBe(0);

        for (const reason of [
            'user',
            'superseded',
            'modal-closed',
            'selection-invalidated',
        ]) {
            expect(
                publishOnce('ANALYSIS_CANCEL', analysisCancel({ reason }))
            ).toBe(1);
            expect(
                publishOnce('ANALYSIS_SETTLED', {
                    requestId: 1,
                    outcome: 'cancelled',
                    reason,
                })
            ).toBe(1);
        }

        for (const code of [
            'busy',
            'stale-selection',
            'disabled',
            'configuration',
            'rate-limited',
            'timeout',
            'network',
            'provider-unavailable',
            'invalid-response',
            'provider-error',
            'internal',
        ]) {
            expect(
                publishOnce('ANALYSIS_SETTLED', {
                    requestId: 1,
                    outcome: 'failed',
                    code,
                    retryable: false,
                })
            ).toBe(1);
        }
        for (const payload of [
            { requestId: 1, outcome: 'unknown' },
            {
                requestId: 1,
                outcome: 'failed',
                code: 'unknown',
                retryable: false,
            },
            {
                requestId: 1,
                outcome: 'failed',
                code: 'network',
                retryable: 1,
            },
            {
                requestId: 1,
                outcome: 'failed',
                code: 'network',
                retryable: false,
                extra: true,
            },
            {
                requestId: 1,
                outcome: 'cancelled',
                reason: 'unknown',
            },
            {
                requestId: 1,
                outcome: 'cancelled',
                reason: 'user',
                extra: true,
            },
        ]) {
            expect(publishOnce('ANALYSIS_SETTLED', payload)).toBe(0);
        }
    });

    test('requires safe integer revisions, indices, and request identifiers', () => {
        const invalidCases = [
            ['WORD_INTENT', wordIntent({ renderRevision: 0 })],
            ['WORD_INTENT', wordIntent({ renderRevision: 1.5 })],
            [
                'WORD_INTENT',
                wordIntent({ renderRevision: Number.MAX_SAFE_INTEGER + 1 }),
            ],
            ['WORD_INTENT', wordIntent({ wordIndex: -1 })],
            ['WORD_INTENT', wordIntent({ wordIndex: 1.5 })],
            [
                'WORD_INTENT',
                wordIntent({ wordIndex: Number.MAX_SAFE_INTEGER + 1 }),
            ],
            ['SUBTITLE_CHANGED', subtitleChanged({ renderRevision: 0 })],
            ['SELECTION_SNAPSHOT', selectionSnapshot({ selectionRevision: 0 })],
            ['SELECTION_SNAPSHOT', selectionSnapshot({ renderRevision: 0 })],
            [
                'SELECTION_SNAPSHOT',
                selectionSnapshot({
                    entries: [{ wordIndex: -1, word: 'bonjour' }],
                }),
            ],
            ['ANALYSIS_REQUEST', analysisRequest({ requestId: 0 })],
            ['ANALYSIS_REQUEST', analysisRequest({ selectionRevision: 0 })],
            [
                'ANALYSIS_REQUEST',
                analysisRequest({ cause: 'retry', retryOf: 0 }),
            ],
            ['ANALYSIS_CANCEL', analysisCancel({ requestId: 0 })],
            ['ANALYSIS_SETTLED', analysisSettled({ requestId: 0 })],
        ];

        for (const [type, payload] of invalidCases) {
            expect(publishOnce(type, payload)).toBe(0);
        }
        expect(
            publishOnce(
                'WORD_INTENT',
                wordIntent({
                    renderRevision: Number.MAX_SAFE_INTEGER,
                    wordIndex: Number.MAX_SAFE_INTEGER,
                })
            )
        ).toBe(1);
    });

    test('enforces string, UTF-8, array, and joined-selection boundaries', () => {
        for (const word of [
            'a'.repeat(256),
            'é'.repeat(128),
            '😀'.repeat(64),
        ]) {
            expect(publishOnce('WORD_INTENT', wordIntent({ word }))).toBe(1);
            expect(
                publishOnce(
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({
                        entries: [{ wordIndex: 0, word }],
                    })
                )
            ).toBe(1);
        }
        for (const word of [
            'a'.repeat(257),
            'é'.repeat(129),
            '😀'.repeat(65),
        ]) {
            expect(publishOnce('WORD_INTENT', wordIntent({ word }))).toBe(0);
            expect(
                publishOnce(
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({
                        entries: [{ wordIndex: 0, word }],
                    })
                )
            ).toBe(0);
        }

        for (const languageField of ['sourceLanguage', 'targetLanguage']) {
            for (const language of [
                'a'.repeat(64),
                'é'.repeat(32),
                '😀'.repeat(16),
            ]) {
                expect(
                    publishOnce(
                        'WORD_INTENT',
                        wordIntent({ [languageField]: language })
                    )
                ).toBe(1);
            }
            for (const language of [
                'a'.repeat(65),
                'é'.repeat(33),
                '😀'.repeat(17),
            ]) {
                expect(
                    publishOnce(
                        'WORD_INTENT',
                        wordIntent({ [languageField]: language })
                    )
                ).toBe(0);
            }
        }

        for (const text of [
            'a'.repeat(4096),
            'é'.repeat(2048),
            '😀'.repeat(1024),
        ]) {
            expect(
                publishOnce('SUBTITLE_CHANGED', subtitleChanged({ text }))
            ).toBe(1);
        }
        for (const text of [
            'a'.repeat(4097),
            'é'.repeat(2049),
            '😀'.repeat(1025),
        ]) {
            expect(
                publishOnce('SUBTITLE_CHANGED', subtitleChanged({ text }))
            ).toBe(0);
        }
        for (const videoId of [
            'a'.repeat(256),
            'é'.repeat(128),
            '😀'.repeat(64),
        ]) {
            expect(
                publishOnce('SUBTITLE_CHANGED', subtitleChanged({ videoId }))
            ).toBe(1);
        }
        for (const videoId of [
            'a'.repeat(257),
            'é'.repeat(129),
            '😀'.repeat(65),
        ]) {
            expect(
                publishOnce('SUBTITLE_CHANGED', subtitleChanged({ videoId }))
            ).toBe(0);
        }

        const sixtyFourEntries = Array.from({ length: 64 }, (_, wordIndex) => ({
            wordIndex,
            word: 'a',
        }));
        const sixtyFiveEntries = Array.from({ length: 65 }, (_, wordIndex) => ({
            wordIndex,
            word: 'a',
        }));
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({ entries: sixtyFourEntries })
            )
        ).toBe(1);
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({ entries: sixtyFiveEntries })
            )
        ).toBe(0);

        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({
                    entries: [
                        { wordIndex: 0, word: 'a'.repeat(250) },
                        { wordIndex: 1, word: 'b'.repeat(249) },
                    ],
                })
            )
        ).toBe(1);
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({
                    entries: [
                        { wordIndex: 0, word: 'a'.repeat(250) },
                        { wordIndex: 1, word: 'b'.repeat(250) },
                    ],
                })
            )
        ).toBe(0);
    });

    test('requires dense arrays, exact entries, and canonical context subsets', () => {
        for (const contextTypes of [
            ['cultural'],
            ['historical'],
            ['linguistic'],
            ['cultural', 'historical'],
            ['cultural', 'linguistic'],
            ['historical', 'linguistic'],
            ['cultural', 'historical', 'linguistic'],
        ]) {
            expect(
                publishOnce(
                    'ANALYSIS_REQUEST',
                    analysisRequest({ contextTypes })
                )
            ).toBe(1);
        }
        for (const contextTypes of [
            [],
            ['cultural', 'cultural'],
            ['historical', 'cultural'],
            ['cultural', 'historical', 'linguistic', 'cultural'],
        ]) {
            expect(
                publishOnce(
                    'ANALYSIS_REQUEST',
                    analysisRequest({ contextTypes })
                )
            ).toBe(0);
        }

        const sparseContextTypes = [];
        sparseContextTypes.length = 1;
        expect(
            publishOnce(
                'ANALYSIS_REQUEST',
                analysisRequest({ contextTypes: sparseContextTypes })
            )
        ).toBe(0);

        const sparseEntries = [];
        sparseEntries.length = 1;
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({ entries: sparseEntries })
            )
        ).toBe(0);

        const nonenumerableContextTypes = ['cultural'];
        Object.defineProperty(nonenumerableContextTypes, 0, {
            configurable: true,
            enumerable: false,
            value: 'cultural',
            writable: true,
        });
        expect(
            publishOnce(
                'ANALYSIS_REQUEST',
                analysisRequest({ contextTypes: nonenumerableContextTypes })
            )
        ).toBe(0);

        const entryWithExtra = { wordIndex: 0, word: 'bonjour', extra: true };
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({ entries: [entryWithExtra] })
            )
        ).toBe(0);
        expect(
            publishOnce(
                'SELECTION_SNAPSHOT',
                selectionSnapshot({
                    entries: [
                        { wordIndex: 1, word: 'echo' },
                        { wordIndex: 1, word: 'echo' },
                    ],
                })
            )
        ).toBe(0);
    });

    test('rejects malformed Unicode without normalizing caller strings', () => {
        for (const malformed of ['\ud800', '\udc00', '\ud800A']) {
            const invalidCases = [
                ['WORD_INTENT', wordIntent({ word: malformed })],
                ['WORD_INTENT', wordIntent({ sourceLanguage: malformed })],
                ['WORD_INTENT', wordIntent({ targetLanguage: malformed })],
                ['SUBTITLE_CHANGED', subtitleChanged({ videoId: malformed })],
                ['SUBTITLE_CHANGED', subtitleChanged({ text: malformed })],
                [
                    'SELECTION_SNAPSHOT',
                    selectionSnapshot({
                        entries: [{ wordIndex: 0, word: malformed }],
                    }),
                ],
            ];

            for (const [type, payload] of invalidCases) {
                expect(publishOnce(type, payload)).toBe(0);
            }
        }
        expect(
            publishOnce('WORD_INTENT', wordIntent({ word: '  bonjour  ' }))
        ).toBe(0);
    });

    test('validates the detached snapshot without re-walking caller traps', () => {
        const target = wordIntent();
        let ownKeysCalls = 0;
        let descriptorCalls = 0;
        const payload = new Proxy(target, {
            ownKeys() {
                ownKeysCalls += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(_target, key) {
                descriptorCalls += 1;
                const descriptor = Object.getOwnPropertyDescriptor(target, key);
                if (key === 'targetLanguage') {
                    target.word = ' invalid after snapshot ';
                }
                return descriptor;
            },
        });
        let delivered;
        const channel = createAIContextChannel({ lifecycleGeneration: 99 });
        channel.subscribe('WORD_INTENT', (envelope) => {
            delivered = envelope.payload;
        });

        expect(channel.publish('WORD_INTENT', payload)).toBe(1);
        expect(ownKeysCalls).toBe(1);
        expect(descriptorCalls).toBe(6);
        expect(target.word).toBe(' invalid after snapshot ');
        expect(delivered.word).toBe('bonjour');
    });

    test('detaches and deeply freezes payload data before delivery', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 11 });
        const source = selectionSnapshot({
            selectionRevision: 999,
            entries: [
                { wordIndex: 0, word: 'bonjour' },
                { wordIndex: 1, word: 'monde' },
            ],
        });
        let delivered;
        channel.subscribe('SELECTION_SNAPSHOT', (envelope) => {
            delivered = envelope;
        });

        expect(channel.publish('SELECTION_SNAPSHOT', source)).toBe(1);
        source.selectionRevision = 1;
        source.entries[0].word = 'mutated';
        source.entries.push({ wordIndex: 2, word: 'later' });

        expect(delivered.lifecycleGeneration).toBe(11);
        expect(delivered.payload).not.toBe(source);
        expect(delivered.payload.entries).not.toBe(source.entries);
        expect(delivered.payload.entries[0]).not.toBe(source.entries[0]);
        expect(delivered.payload).toEqual(
            selectionSnapshot({
                selectionRevision: 999,
                entries: [
                    { wordIndex: 0, word: 'bonjour' },
                    { wordIndex: 1, word: 'monde' },
                ],
            })
        );
        expect(Object.isFrozen(delivered)).toBe(true);
        expect(Object.isFrozen(delivered.payload)).toBe(true);
        expect(Object.isFrozen(delivered.payload.entries)).toBe(true);
        expect(Object.isFrozen(delivered.payload.entries[0])).toBe(true);
    });

    test('rejects non-plain and executable payload shapes without invoking hooks', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 1 });
        const delivered = [];
        channel.subscribe('ANALYSIS_REQUEST', (envelope) => {
            delivered.push(envelope);
        });

        let getterCalls = 0;
        let coercionCalls = 0;
        let iteratorGetterCalls = 0;
        const accessorRecord = {};
        Object.defineProperty(accessorRecord, 'secret', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'leaked';
            },
        });
        const coercibleRecord = {
            [Symbol.toPrimitive]() {
                coercionCalls += 1;
                return 'coerced';
            },
        };
        const iterableRecord = {};
        Object.defineProperty(iterableRecord, Symbol.iterator, {
            get() {
                iteratorGetterCalls += 1;
                return function* iteratorCanary() {
                    yield 'leaked';
                };
            },
        });
        const sparseArray = [];
        sparseArray.length = 2;
        sparseArray[1] = 'present';
        const symbolRecord = { safe: true };
        symbolRecord[Symbol('hidden')] = 'value';
        const cycle = {};
        cycle.self = cycle;
        const dangerousRecord = Object.create(null);
        Object.defineProperty(dangerousRecord, '__proto__', {
            enumerable: true,
            value: { polluted: true },
        });

        const rejectedPayloads = [
            undefined,
            () => {},
            1n,
            Symbol('payload'),
            NaN,
            Infinity,
            new Date(),
            new Event('hostile'),
            document.createRange(),
            accessorRecord,
            coercibleRecord,
            iterableRecord,
            sparseArray,
            symbolRecord,
            cycle,
            dangerousRecord,
            { constructor: 'blocked' },
            { prototype: 'blocked' },
        ];

        for (const payload of rejectedPayloads) {
            expect(channel.publish('ANALYSIS_REQUEST', payload)).toBe(0);
        }

        expect(delivered).toEqual([]);
        expect(getterCalls).toBe(0);
        expect(coercionCalls).toBe(0);
        expect(iteratorGetterCalls).toBe(0);
    });

    test('enforces snapshot depth, entry, string, and total-size bounds', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 2 });
        const delivered = [];
        channel.subscribe('SUBTITLE_CHANGED', (envelope) => {
            delivered.push(envelope.payload);
        });

        expect(
            channel.publish(
                'SUBTITLE_CHANGED',
                subtitleChanged({ text: 'a'.repeat(4096) })
            )
        ).toBe(1);

        let tooDeep = 'leaf';
        for (let index = 0; index < 10; index += 1) {
            tooDeep = { next: tooDeep };
        }

        expect(
            channel.publish(
                'SUBTITLE_CHANGED',
                subtitleChanged({ text: 'a'.repeat(4097) })
            )
        ).toBe(0);
        expect(channel.publish('SUBTITLE_CHANGED', Array(257).fill(1))).toBe(0);
        expect(channel.publish('SUBTITLE_CHANGED', tooDeep)).toBe(0);
        expect(
            channel.publish('SUBTITLE_CHANGED', [
                'a'.repeat(4096),
                'b'.repeat(4096),
                'c'.repeat(4096),
                'd'.repeat(4096),
            ])
        ).toBe(0);
        expect(delivered).toHaveLength(1);
    });

    test('stops payload traversal at the shared snapshot defaults', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 2 });
        let lateTraversalCalls = 0;
        const lateValue = new Proxy(
            {},
            {
                getPrototypeOf(target) {
                    lateTraversalCalls += 1;
                    return Reflect.getPrototypeOf(target);
                },
            }
        );

        expect(
            channel.publish('SUBTITLE_CHANGED', {
                oversized: 'a'.repeat(4097),
                lateValue,
            })
        ).toBe(0);
        expect(lateTraversalCalls).toBe(0);
    });

    test('enforces the descriptor fan-out cap at N and N plus one', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 2 });
        let boundaryDescriptorTrapCalls = 0;
        const boundaryProxy = new Proxy(
            {},
            {
                ownKeys() {
                    return Array.from(
                        { length: 256 },
                        (_, index) => `key${index}`
                    );
                },
                getOwnPropertyDescriptor() {
                    boundaryDescriptorTrapCalls += 1;
                    return {
                        configurable: true,
                        enumerable: true,
                        value: 1,
                        writable: true,
                    };
                },
            }
        );
        let descriptorTrapCalls = 0;
        const oversizedProxy = new Proxy(
            {},
            {
                ownKeys() {
                    return Array.from(
                        { length: 257 },
                        (_, index) => `key${index}`
                    );
                },
                getOwnPropertyDescriptor() {
                    descriptorTrapCalls += 1;
                    return {
                        configurable: true,
                        enumerable: true,
                        value: 1,
                        writable: true,
                    };
                },
            }
        );

        expect(channel.publish('SUBTITLE_CHANGED', boundaryProxy)).toBe(0);
        expect(boundaryDescriptorTrapCalls).toBe(256);
        expect(channel.publish('SUBTITLE_CHANGED', oversizedProxy)).toBe(0);
        expect(descriptorTrapCalls).toBe(0);
    });

    test('rejects Proxy trap failures and never attempts payload coercion', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 3 });
        let coercionCalls = 0;
        let delivered = 0;
        channel.subscribe('ANALYSIS_CANCEL', () => {
            delivered += 1;
        });

        const coercionCanary = {
            toJSON() {
                coercionCalls += 1;
                return {};
            },
            valueOf() {
                coercionCalls += 1;
                return 1;
            },
        };
        const throwingProxy = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error('proxy canary');
                },
            }
        );

        expect(channel.publish('ANALYSIS_CANCEL', coercionCanary)).toBe(0);
        expect(channel.publish('ANALYSIS_CANCEL', throwingProxy)).toBe(0);
        expect(delivered).toBe(0);
        expect(coercionCalls).toBe(0);
    });

    test('keeps every allowlisted signal private and rejects unknown types without coercion', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 4 });
        const allowedTypes = Object.values(AI_CONTEXT_SIGNAL_TYPES);
        const channelTypes = [];
        let documentEvents = 0;
        let windowEvents = 0;

        const observeDocument = () => {
            documentEvents += 1;
        };
        const observeWindow = () => {
            windowEvents += 1;
        };
        for (const type of allowedTypes) {
            document.addEventListener(type, observeDocument);
            window.addEventListener(type, observeWindow);
            channel.subscribe(type, (envelope) => {
                channelTypes.push(envelope.type);
            });
        }

        try {
            for (const type of allowedTypes) {
                expect(channel.publish(type, validPayloadFor(type))).toBe(1);
            }

            let coercionCalls = 0;
            const hostileType = {
                toString() {
                    coercionCalls += 1;
                    return 'WORD_INTENT';
                },
                [Symbol.toPrimitive]() {
                    coercionCalls += 1;
                    return 'WORD_INTENT';
                },
            };
            const unknownUnsubscribe = channel.subscribe('MODAL_SHOW', () => {
                channelTypes.push('unexpected');
            });
            let unknownPayloadTrapCalls = 0;
            const unknownPayload = new Proxy(
                {},
                {
                    ownKeys() {
                        unknownPayloadTrapCalls += 1;
                        return [];
                    },
                }
            );

            expect(channel.publish('MODAL_SHOW', unknownPayload)).toBe(0);
            expect(channel.publish(hostileType, null)).toBe(0);
            expect(() => unknownUnsubscribe()).not.toThrow();
            expect(coercionCalls).toBe(0);
            expect(unknownPayloadTrapCalls).toBe(0);
        } finally {
            for (const type of allowedTypes) {
                document.removeEventListener(type, observeDocument);
                window.removeEventListener(type, observeWindow);
            }
        }

        expect(channelTypes).toEqual(allowedTypes);
        expect(documentEvents).toBe(0);
        expect(windowEvents).toBe(0);
    });

    test('isolates sync throws, async rejections, and payload mutation between listeners', async () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 5 });
        const received = [];
        let asyncCalls = 0;
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const consoleWarn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        channel.subscribe('ANALYSIS_SETTLED', (envelope) => {
            envelope.payload.outcome = 'failed';
        });
        channel.subscribe('ANALYSIS_SETTLED', async () => {
            asyncCalls += 1;
            throw new Error('async secret canary');
        });
        channel.subscribe('ANALYSIS_SETTLED', (envelope) => {
            received.push(envelope.payload.outcome);
        });

        expect(channel.publish('ANALYSIS_SETTLED', analysisSettled())).toBe(3);
        await Promise.resolve();
        expect(
            channel.publish(
                'ANALYSIS_SETTLED',
                analysisSettled({ requestId: 2 })
            )
        ).toBe(3);
        await Promise.resolve();

        expect(received).toEqual(['succeeded', 'succeeded']);
        expect(asyncCalls).toBe(2);
        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleWarn).not.toHaveBeenCalled();
    });

    test('uses an intrinsic rejection handler when a returned Promise poisons catch', async () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 5 });
        const rejection = Promise.reject(
            new Error('poisoned-catch rejection canary')
        );
        Object.defineProperty(rejection, 'catch', {
            configurable: true,
            value: null,
        });
        let calls = 0;
        channel.subscribe('ANALYSIS_SETTLED', () => {
            calls += 1;
            return rejection;
        });

        expect(channel.publish('ANALYSIS_SETTLED', analysisSettled())).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
            channel.publish(
                'ANALYSIS_SETTLED',
                analysisSettled({ requestId: 2 })
            )
        ).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls).toBe(2);
    });

    test('snapshots subscriptions so add and remove operations affect the next publish', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 6 });
        const calls = [];
        let lateAdded = false;
        let unsubscribeFirst;
        let unsubscribeSecond;

        const lateListener = () => {
            calls.push('late');
        };
        unsubscribeFirst = channel.subscribe('WORD_INTENT', () => {
            calls.push('first');
            unsubscribeFirst();
            unsubscribeSecond();
            if (!lateAdded) {
                lateAdded = true;
                channel.subscribe('WORD_INTENT', lateListener);
            }
        });
        unsubscribeSecond = channel.subscribe('WORD_INTENT', () => {
            calls.push('second');
        });
        channel.subscribe('WORD_INTENT', () => {
            calls.push('third');
        });

        expect(channel.publish('WORD_INTENT', wordIntent())).toBe(3);
        expect(calls).toEqual(['first', 'second', 'third']);

        calls.length = 0;
        expect(channel.publish('WORD_INTENT', wordIntent())).toBe(2);
        expect(calls).toEqual(['third', 'late']);
    });

    test('snapshots subscriptions before caller-controlled payload reflection', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 6 });
        const calls = [];
        const unsubscribeExisting = channel.subscribe(
            'SELECTION_SNAPSHOT',
            () => {
                calls.push('existing');
            }
        );
        const reflectiveTarget = selectionSnapshot();
        const reflectivePayload = new Proxy(reflectiveTarget, {
            ownKeys() {
                unsubscribeExisting();
                channel.subscribe('SELECTION_SNAPSHOT', () => {
                    calls.push('late');
                });
                return Reflect.ownKeys(reflectiveTarget);
            },
        });

        expect(channel.publish('SELECTION_SNAPSHOT', reflectivePayload)).toBe(
            1
        );
        expect(calls).toEqual(['existing']);

        calls.length = 0;
        expect(channel.publish('SELECTION_SNAPSHOT', selectionSnapshot())).toBe(
            1
        );
        expect(calls).toEqual(['late']);
    });

    test('fails closed when payload reflection destroys the channel', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 6 });
        let calls = 0;
        channel.subscribe('SELECTION_SNAPSHOT', () => {
            calls += 1;
        });
        const destroyingTarget = selectionSnapshot();
        const destroyingPayload = new Proxy(destroyingTarget, {
            ownKeys() {
                channel.destroy();
                return Reflect.ownKeys(destroyingTarget);
            },
        });

        expect(channel.publish('SELECTION_SNAPSHOT', destroyingPayload)).toBe(
            0
        );
        expect(calls).toBe(0);
        expect(channel.publish('SELECTION_SNAPSHOT', selectionSnapshot())).toBe(
            0
        );
    });

    test('destroy immediately revokes authority during an active publish', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 6 });
        const calls = [];
        channel.subscribe('ANALYSIS_CANCEL', () => {
            calls.push('destroying-listener');
            channel.destroy();
        });
        channel.subscribe('ANALYSIS_CANCEL', () => {
            calls.push('must-not-run');
        });

        expect(channel.publish('ANALYSIS_CANCEL', analysisCancel())).toBe(1);
        expect(calls).toEqual(['destroying-listener']);
        expect(channel.publish('ANALYSIS_CANCEL', analysisCancel())).toBe(0);
    });

    test('unsubscribe is exact to one type-listener subscription and idempotent', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        const calls = [];
        const sharedListener = (envelope) => {
            calls.push(envelope.type);
        };

        const unsubscribeWordOne = channel.subscribe(
            'WORD_INTENT',
            sharedListener
        );
        const unsubscribeWordTwo = channel.subscribe(
            'WORD_INTENT',
            sharedListener
        );
        const unsubscribeCancel = channel.subscribe(
            'ANALYSIS_CANCEL',
            sharedListener
        );

        unsubscribeWordOne();
        unsubscribeWordOne();
        expect(channel.publish('WORD_INTENT', wordIntent())).toBe(1);
        expect(channel.publish('ANALYSIS_CANCEL', analysisCancel())).toBe(1);
        expect(calls).toEqual(['WORD_INTENT', 'ANALYSIS_CANCEL']);

        unsubscribeWordTwo();
        expect(channel.publish('WORD_INTENT', wordIntent())).toBe(0);
        expect(channel.publish('ANALYSIS_CANCEL', analysisCancel())).toBe(1);
        unsubscribeCancel();
        unsubscribeCancel();
    });

    test('destroy is idempotent, inert, and isolates old and new generations', () => {
        const oldChannel = createAIContextChannel({ lifecycleGeneration: 8 });
        const newChannel = createAIContextChannel({ lifecycleGeneration: 9 });
        const generations = [];
        oldChannel.subscribe('SUBTITLE_CHANGED', (envelope) => {
            generations.push(envelope.lifecycleGeneration);
        });
        newChannel.subscribe('SUBTITLE_CHANGED', (envelope) => {
            generations.push(envelope.lifecycleGeneration);
        });

        expect(oldChannel.publish('SUBTITLE_CHANGED', subtitleChanged())).toBe(
            1
        );
        expect(newChannel.publish('SUBTITLE_CHANGED', subtitleChanged())).toBe(
            1
        );
        expect(generations).toEqual([8, 9]);

        let proxyTrapCalls = 0;
        const hostileAfterDestroy = new Proxy(
            {},
            {
                ownKeys() {
                    proxyTrapCalls += 1;
                    throw new Error('must stay inert');
                },
            }
        );
        oldChannel.destroy();
        oldChannel.destroy();
        const unsubscribeAfterDestroy = oldChannel.subscribe(
            'SUBTITLE_CHANGED',
            () => {
                generations.push(1000);
            }
        );

        expect(
            oldChannel.publish('SUBTITLE_CHANGED', hostileAfterDestroy)
        ).toBe(0);
        expect(() => unsubscribeAfterDestroy()).not.toThrow();
        expect(proxyTrapCalls).toBe(0);
        expect(newChannel.publish('SUBTITLE_CHANGED', subtitleChanged())).toBe(
            1
        );
        expect(generations).toEqual([8, 9, 9]);
    });

    test('accepts exact null-prototype records and rejects nonenumerable schema fields', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 10 });
        const delivered = [];
        channel.subscribe('SELECTION_SNAPSHOT', (envelope) => {
            delivered.push(envelope.payload);
        });

        for (const primitive of [null, false, true, '', 'text', -1, 0, 1.5]) {
            expect(channel.publish('SELECTION_SNAPSHOT', primitive)).toBe(0);
        }

        const nullPrototypeRecord = Object.assign(
            Object.create(null),
            selectionSnapshot()
        );

        expect(channel.publish('SELECTION_SNAPSHOT', nullPrototypeRecord)).toBe(
            1
        );

        const snapshot = delivered.at(-1);
        expect(Object.getPrototypeOf(snapshot)).toBeNull();
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.entries)).toBe(true);

        const nonenumerableRecord = selectionSnapshot();
        Object.defineProperty(nonenumerableRecord, 'renderRevision', {
            enumerable: false,
            value: 1,
        });
        expect(channel.publish('SELECTION_SNAPSHOT', nonenumerableRecord)).toBe(
            0
        );
    });
});
