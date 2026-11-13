import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plainText, wiktionaryEntries, wiktionaryLanguage } from './wiktionary';

/** Recorded from rest_v1/page/definition/salgas (2026-10-29), trimmed. */
const SALGAS = {
    es: [
        {
            partOfSpeech: 'Noun',
            language: 'Spanish',
            definitions: [
                {
                    definition:
                        '<span class="form-of-definition use-with-mention"><a rel="mw:WikiLink" href="/wiki/Appendix:Glossary#plural_number" title="Appendix:Glossary">plural</a> of <span class="form-of-definition-link"><i class="Latn mention" lang="es"><a rel="mw:WikiLink" href="/wiki/salga#Spanish" title="salga">salga</a></i></span></span>',
                },
            ],
        },
        {
            partOfSpeech: 'Verb',
            language: 'Spanish',
            definitions: [
                {
                    definition:
                        '<span class="form-of-definition use-with-mention"><a rel="mw:WikiLink" href="/wiki/Appendix:Glossary#second_person" title="Appendix:Glossary">second-person</a> singular present subjunctive of <span class="form-of-definition-link"><i class="Latn mention" lang="es"><a rel="mw:WikiLink" href="/wiki/salir#Spanish" title="salir">salir</a></i></span></span>',
                },
            ],
        },
    ],
    pt: [
        {
            partOfSpeech: 'Verb',
            language: 'Portuguese',
            definitions: [{ definition: 'inflection of salgar' }],
        },
    ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

describe('plainText', () => {
    it('keeps the text a definition shows', () => {
        expect(
            plainText(
                '<a href="/wiki/jug" title="jug">jug</a>, &lt;jar&gt; &amp; &#x61;mphora&#39;s&nbsp;&#8230;'
            )
        ).toBe("jug, <jar> & amphora's …");
        expect(plainText('  <link rel="x">; ate\n  ')).toBe('; ate');
        expect(plainText('&bogus; &#0;')).toBe('&bogus; &#0;');
    });
});

describe('wiktionaryEntries', () => {
    it('reads the entries of the language as plain text, with their base word', async () => {
        fetchMock.mockResolvedValueOnce(json(SALGAS));
        await expect(wiktionaryEntries('salgas', 'es')).resolves.toEqual([
            {
                partOfSpeech: 'Noun',
                definitions: ['plural of salga'],
                formOf: 'salga',
            },
            {
                partOfSpeech: 'Verb',
                definitions: [
                    'second-person singular present subjunctive of salir',
                ],
                formOf: 'salir',
            },
        ]);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(
            'https://en.wiktionary.org/api/rest_v1/page/definition/salgas'
        );
        expect(init.credentials).toBe('omit');
    });

    it('asks for a saying by its page title', async () => {
        fetchMock.mockResolvedValueOnce(json({}));
        await expect(
            wiktionaryEntries('llover a cántaros', 'es')
        ).resolves.toEqual([]);
        expect(fetchMock.mock.calls[0]![0]).toBe(
            'https://en.wiktionary.org/api/rest_v1/page/definition/llover_a_c%C3%A1ntaros'
        );
    });

    it('answers null for a missing page, a failed request, or a malformed one', async () => {
        fetchMock.mockResolvedValueOnce(json({ title: 'Not found' }, 404));
        await expect(wiktionaryEntries('x', 'es')).resolves.toBeNull();
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(wiktionaryEntries('x', 'es')).resolves.toBeNull();
        fetchMock.mockResolvedValueOnce(new Response('<html>'));
        await expect(wiktionaryEntries('x', 'es')).resolves.toBeNull();
        fetchMock.mockResolvedValueOnce(json({ es: 'nope' }));
        await expect(wiktionaryEntries('x', 'es')).resolves.toBeNull();
    });
});

describe('wiktionaryLanguage', () => {
    it('files Chinese under one code and the rest under their base tag', () => {
        expect(wiktionaryLanguage('zh-TW')).toBe('zh');
        expect(wiktionaryLanguage('es-419')).toBe('es');
        expect(wiktionaryLanguage('ja')).toBe('ja');
    });
});
