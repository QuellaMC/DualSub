import { z } from 'zod';
import {
    cancelResponseBodySafely,
    fetchWithTimeout,
    readResponseTextWithLimit,
} from '@/shared/fetchWithTimeout';

const ENDPOINT = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const MAX_RESPONSE_BYTES = 1024 * 1024;
/** A viewer is waiting with the video paused. */
const TIMEOUT_MS = 8_000;

/** One part of speech of one word, as plain text. `formOf` is the word it
 *  is a form of, when Wiktionary defines it as one. */
export interface WiktionaryEntry {
    readonly partOfSpeech: string;
    readonly definitions: readonly string[];
    readonly formOf: string | null;
}

const payload = z.record(
    z.string(),
    z.array(
        z.object({
            partOfSpeech: z.string(),
            definitions: z.array(z.object({ definition: z.string() })),
        })
    )
);

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

function decodeEntities(text: string): string {
    return text.replace(
        /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
        (entity: string, name: string) => {
            if (name.startsWith('#')) {
                const code =
                    name[1] === 'x' || name[1] === 'X'
                        ? Number.parseInt(name.slice(2), 16)
                        : Number.parseInt(name.slice(1), 10);
                return code > 0 && code <= 0x10ffff
                    ? String.fromCodePoint(code)
                    : entity;
            }
            return ENTITIES[name.toLowerCase()] ?? entity;
        }
    );
}

/** The text a definition's HTML shows. The worker has no DOM parser, and
 *  nothing here is ever rendered as HTML: tags go, entities are decoded. */
export function plainText(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
}

/** The word a "form of" definition points to. */
function formOf(html: string): string | null {
    const match =
        /class="[^"]*\bform-of-definition-link\b[^"]*"[^>]*>[\s\S]*?<a\b[^>]*\btitle="([^"]+)"/.exec(
            html
        );
    const word = match ? decodeEntities(match[1]!).trim() : '';
    return word === '' ? null : word;
}

/** Wiktionary files Chinese under one code; every other language under its
 *  base tag. */
export function wiktionaryLanguage(language: string): string {
    const base = language.split('-')[0]!.toLowerCase();
    return base === 'zh' ? 'zh' : base;
}

/**
 * Wiktionary's entries for `title` in `language`, or null when it has no
 * page for it or cannot be reached. Requests carry no cookies; the answer
 * is read up to a byte limit and reduced to plain text here.
 */
export async function wiktionaryEntries(
    title: string,
    language: string
): Promise<WiktionaryEntry[] | null> {
    let response: Response;
    try {
        response = await fetchWithTimeout(
            ENDPOINT + encodeURIComponent(title.replace(/ /g, '_')),
            { credentials: 'omit' },
            TIMEOUT_MS
        );
    } catch {
        return null;
    }
    if (!response.ok) {
        cancelResponseBodySafely(response);
        return null;
    }
    let parsed: z.infer<typeof payload>;
    try {
        const body = await readResponseTextWithLimit(
            response,
            MAX_RESPONSE_BYTES
        );
        parsed = payload.parse(JSON.parse(body));
    } catch {
        return null;
    }
    return (parsed[wiktionaryLanguage(language)] ?? []).flatMap((entry) => {
        const definitions = entry.definitions
            .map(({ definition }) => plainText(definition))
            .filter((definition) => definition !== '');
        const first = entry.definitions[0]?.definition ?? '';
        return definitions.length > 0
            ? [
                  {
                      partOfSpeech: entry.partOfSpeech,
                      definitions,
                      formOf: formOf(first),
                  },
              ]
            : [];
    });
}
