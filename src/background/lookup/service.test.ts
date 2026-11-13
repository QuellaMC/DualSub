import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock,
} from 'vitest';
import { createLogger } from '@/shared/logger';
import { TranslationProviderError } from '../translation/providerError';
import { LookupService, wordTypeOf, type LookupServiceDeps } from './service';

let fetchMock: Mock<(url: string) => Promise<Response>>;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

/** Answers each request by its URL, as Google and Wiktionary would. */
function serve(routes: Record<string, () => Response>): void {
    fetchMock.mockImplementation((url: string) => {
        const route = Object.entries(routes).find(([part]) =>
            url.includes(part)
        );
        return Promise.resolve(route ? route[1]() : json({}, 404));
    });
}

function harness(
    translate: LookupServiceDeps['translation']['translate'] = (text) =>
        Promise.resolve({ translatedText: `[${text}]`, cached: false })
) {
    const translation = {
        translate: vi.fn(translate),
        paced: vi.fn(
            (
                _provider: string,
                _text: string,
                request: () => Promise<unknown>
            ) => request()
        ) as unknown as LookupServiceDeps['translation']['paced'],
    };
    const service = new LookupService({
        translation,
        logger: createLogger('test'),
    });
    return { service, translation };
}

const salirForm = (partOfSpeech: string, base: string) => ({
    partOfSpeech,
    definitions: [
        {
            definition: `form of <span class="form-of-definition-link"><a href="/wiki/${base}" title="${base}">${base}</a></span>`,
        },
    ],
});

beforeEach(() => {
    fetchMock = vi.fn<(url: string) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('LookupService', () => {
    it('translates the pick and lists Google entries under their listed word', async () => {
        serve({
            'translate.googleapis.com': () =>
                json({
                    dict: [
                        {
                            pos: 'verb',
                            terms: ['leave', 'get out', 'go out', 'go', 'exit'],
                            base_form: 'salir',
                        },
                    ],
                }),
        });
        const { service, translation } = harness();
        await expect(service.lookup(' salgas ', 'es', 'en')).resolves.toEqual({
            translation: '[salgas]',
            entries: [
                {
                    term: 'salir',
                    from: 'salgas',
                    type: 'verb',
                    senses: ['leave, get out, go out, go'],
                },
            ],
            source: 'google',
        });
        expect(translation.translate).toHaveBeenCalledWith(
            'salgas',
            'es',
            'en'
        );
        expect(translation.paced).toHaveBeenCalledWith(
            'google',
            'salgas',
            expect.any(Function)
        );
    });

    it('falls back to Wiktionary, following a form to its word, in the target language', async () => {
        serve({
            'translate.googleapis.com': () => json({ sentences: [] }),
            '/definition/salgas': () =>
                json({ es: [salirForm('Verb', 'salir')] }),
            '/definition/salir': () =>
                json({
                    es: [
                        {
                            partOfSpeech: 'Verb',
                            definitions: [
                                { definition: 'to go out' },
                                { definition: 'to leave' },
                            ],
                        },
                    ],
                }),
        });
        const { service, translation } = harness((text, source) =>
            Promise.resolve({
                translatedText:
                    source === 'en'
                        ? text
                              .split('\n')
                              .map((line) => `«${line}»`)
                              .join('\n')
                        : '出去',
                cached: false,
            })
        );
        await expect(service.lookup('salgas', 'es', 'zh-CN')).resolves.toEqual({
            translation: '出去',
            entries: [
                {
                    term: 'salir',
                    from: 'salgas',
                    type: 'verb',
                    senses: ['«to go out»', '«to leave»'],
                },
            ],
            source: 'wiktionary',
        });
        expect(translation.translate).toHaveBeenLastCalledWith(
            'to go out\nto leave',
            'en',
            'zh-CN'
        );
    });

    it('tries a word as written, then in lowercase, and keeps English for English viewers', async () => {
        serve({
            'translate.googleapis.com': () => {
                throw new TranslationProviderError('google', 'blocked', {
                    code: 'RATE_LIMIT_EXCEEDED',
                });
            },
            '/definition/est%C3%A1': () =>
                json({
                    es: [
                        {
                            partOfSpeech: 'Verb',
                            definitions: [{ definition: 'is (estar)' }],
                        },
                    ],
                }),
        });
        const { service } = harness();
        const result = await service.lookup('Está', 'es', 'en');
        expect(result.entries).toEqual([
            { term: 'está', from: null, type: 'verb', senses: ['is (estar)'] },
        ]);
        expect(result.source).toBe('wiktionary');
        expect(
            fetchMock.mock.calls
                .map(([url]) => url)
                .filter((url) => url.includes('/definition/'))
                .map((url) => url.split('/definition/')[1])
        ).toEqual(['Est%C3%A1', 'est%C3%A1']);
    });

    it('keeps a spelling whose case tells it from another word', async () => {
        const page = (definition: string) => () =>
            json({
                en: [
                    {
                        partOfSpeech: 'Adjective',
                        definitions: [{ definition }],
                    },
                ],
            });
        serve({
            'translate.googleapis.com': () => json({}),
            '/definition/Polish': page('Of or from Poland.'),
            '/definition/polish': page('Shiny.'),
        });
        const { service } = harness();
        expect((await service.lookup('Polish', 'en', 'en')).entries).toEqual([
            {
                term: 'Polish',
                from: null,
                type: 'adjective',
                senses: ['Of or from Poland.'],
            },
        ]);
        expect(
            fetchMock.mock.calls.some(([url]) =>
                url.includes('/definition/polish')
            )
        ).toBe(false);
    });

    it('finds nothing without a language for Wiktionary, or for a sentence', async () => {
        serve({ 'translate.googleapis.com': () => json({}) });
        const { service, translation } = harness();
        await expect(service.lookup('hola', null, 'en')).resolves.toEqual({
            translation: '[hola]',
            entries: [],
            source: null,
        });
        expect(translation.translate).toHaveBeenCalledWith(
            'hola',
            'auto',
            'en'
        );
        const sentence = 'word '.repeat(20).trim();
        await service.lookup(sentence, 'es', 'en');
        expect(translation.paced).toHaveBeenCalledTimes(1);
    });

    it('keeps entries found for a while, but asks again for translations and for nothing found', async () => {
        serve({
            'q=amigo': () =>
                json({
                    dict: [
                        { pos: 'noun', terms: ['friend'], base_form: 'amigo' },
                    ],
                }),
            'translate.googleapis.com': () => json({}),
        });
        const { service, translation } = harness();
        for (const word of ['amigo', 'amigo', 'zzz', 'zzz']) {
            await service.lookup(word, 'es', 'en');
        }
        expect(translation.paced).toHaveBeenCalledTimes(3);
        expect(translation.translate).toHaveBeenCalledTimes(4);
        expect((await service.lookup('amigo', 'es', 'en')).entries).toEqual([
            { term: 'amigo', from: null, type: 'noun', senses: ['friend'] },
        ]);
    });
});

describe('wordTypeOf', () => {
    it('names word types the same for every dictionary', () => {
        expect(wordTypeOf('Noun')).toBe('noun');
        expect(wordTypeOf('proper noun')).toBe('noun');
        expect(wordTypeOf('phrase')).toBe('saying');
        expect(wordTypeOf('Idiom')).toBe('saying');
        expect(wordTypeOf('Numeral')).toBe('other');
    });
});
