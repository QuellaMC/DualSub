import {
    MAX_DICTIONARY_ENTRIES,
    MAX_DICTIONARY_SENSES,
    type DictionaryEntry,
    type LookupResult,
    type WordType,
} from '@/messaging/contracts/lookupWords';
import { createLogger, type Logger } from '@/shared/logger';
import { TtlCache } from '@/shared/ttlCache';
import {
    lookupDictionary,
    type GoogleDictionaryMeaning,
} from '../translation/providers/google';
import type { TranslationService } from '../translation/service';
import { wiktionaryEntries, type WiktionaryEntry } from './wiktionary';

const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Google lists translations best first; a few say enough. */
const MAX_GOOGLE_TERMS = 4;
/** A definition longer than this is cut, so an entry stays readable. */
const MAX_SENSE_LENGTH = 240;
/** Each "form of" link costs one more request; a lookup follows few. */
const MAX_FORM_LINKS = 2;
/** Dictionaries list words and sayings; a longer pick is a sentence. */
const MAX_DICTIONARY_QUERY = 64;

const WORD_TYPE_NAMES: Record<string, WordType> = {
    noun: 'noun',
    'proper noun': 'noun',
    verb: 'verb',
    adjective: 'adjective',
    adverb: 'adverb',
    pronoun: 'pronoun',
    preposition: 'preposition',
    postposition: 'preposition',
    conjunction: 'conjunction',
    interjection: 'interjection',
    phrase: 'saying',
    'prepositional phrase': 'saying',
    idiom: 'saying',
    proverb: 'saying',
};

/** The word type a dictionary names in English, as the panel shows it. */
export function wordTypeOf(partOfSpeech: string): WordType {
    return WORD_TYPE_NAMES[partOfSpeech.trim().toLowerCase()] ?? 'other';
}

function sense(text: string): string {
    return text.length > MAX_SENSE_LENGTH
        ? `${text.slice(0, MAX_SENSE_LENGTH - 1).trimEnd()}…`
        : text;
}

/** The looked-up form, when the dictionary lists the word under another. */
function fromOf(query: string, term: string): string | null {
    return term.toLocaleLowerCase() === query.toLocaleLowerCase()
        ? null
        : query;
}

function googleEntries(
    query: string,
    meanings: readonly GoogleDictionaryMeaning[]
): DictionaryEntry[] {
    return meanings.slice(0, MAX_DICTIONARY_ENTRIES).map((meaning) => {
        const term = meaning.baseForm ?? query;
        return {
            term,
            from: fromOf(query, term),
            type: wordTypeOf(meaning.pos),
            senses: [
                sense(meaning.terms.slice(0, MAX_GOOGLE_TERMS).join(', ')),
            ],
        };
    });
}

type Dictionary = Pick<LookupResult, 'entries' | 'source'>;

const NOTHING_FOUND: Dictionary = { entries: [], source: null };

export interface LookupServiceDeps {
    readonly translation: Pick<TranslationService, 'translate' | 'paced'>;
    readonly logger?: Logger;
}

/**
 * Looks up the words a viewer picked: their translation through the
 * viewer's own translation service, and dictionary entries — Google's
 * first, through the pacer that guards Google for translation, then
 * Wiktionary's when Google lists nothing or cannot be reached. A lookup
 * never fails as a whole: what could not be found is simply absent.
 */
export class LookupService {
    /** Entries as their dictionary gave them. Every translation goes through
     *  the translation service, whose cache follows its own configuration. */
    private readonly cache = new TtlCache<Dictionary>(
        CACHE_MAX_ENTRIES,
        CACHE_TTL_MS
    );
    private readonly logger: Logger;

    constructor(private readonly deps: LookupServiceDeps) {
        this.logger = deps.logger ?? createLogger('LookupService');
    }

    async lookup(
        text: string,
        language: string | null,
        targetLanguage: string
    ): Promise<LookupResult> {
        const query = text.trim().replace(/\s+/g, ' ');
        const [translation, dictionary] = await Promise.all([
            this.translate(query, language ?? 'auto', targetLanguage),
            this.dictionary(query, language, targetLanguage),
        ]);
        return { translation, ...dictionary };
    }

    private async translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string
    ): Promise<string | null> {
        try {
            const outcome = await this.deps.translation.translate(
                text,
                sourceLanguage,
                targetLanguage
            );
            return outcome.translatedText;
        } catch (error) {
            this.logger.debug('Lookup translation failed', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
            return null;
        }
    }

    /** The entries for `query` in the target language. Entries found are
     *  kept for a while; nothing found is asked again next time. */
    private async dictionary(
        query: string,
        language: string | null,
        targetLanguage: string
    ): Promise<Dictionary> {
        const key = JSON.stringify([language, targetLanguage, query]);
        let found = this.cache.get(key);
        if (!found) {
            found = await this.find(query, language, targetLanguage);
            if (found.source !== null) {
                this.cache.set(key, found);
            }
        }
        return found.source === 'wiktionary'
            ? {
                  entries: await this.inTargetLanguage(
                      found.entries,
                      targetLanguage
                  ),
                  source: found.source,
              }
            : found;
    }

    private async find(
        query: string,
        language: string | null,
        targetLanguage: string
    ): Promise<Dictionary> {
        if (query.length > MAX_DICTIONARY_QUERY) {
            return NOTHING_FOUND;
        }
        try {
            const meanings = await this.deps.translation.paced(
                'google',
                query,
                () =>
                    lookupDictionary(query, language ?? 'auto', targetLanguage)
            );
            if (meanings.length > 0) {
                return {
                    entries: googleEntries(query, meanings),
                    source: 'google',
                };
            }
        } catch (error) {
            this.logger.debug('Google dictionary unavailable', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
        }
        const entries =
            language === null ? [] : await this.wiktionary(query, language);
        return entries.length > 0
            ? { entries, source: 'wiktionary' }
            : NOTHING_FOUND;
    }

    /** Wiktionary's entries, each "form of" entry shown as the word it is a
     *  form of, defined in English. */
    private async wiktionary(
        query: string,
        language: string
    ): Promise<DictionaryEntry[]> {
        const found = await this.wiktionaryPage(query, language);
        if (!found) {
            return [];
        }
        const bases = new Map<string, readonly WiktionaryEntry[]>();
        const entries: DictionaryEntry[] = [];
        for (const entry of found.entries.slice(0, MAX_DICTIONARY_ENTRIES)) {
            let term = found.title;
            let definitions = entry.definitions;
            if (entry.formOf !== null) {
                if (!bases.has(entry.formOf) && bases.size >= MAX_FORM_LINKS) {
                    continue;
                }
                const base =
                    bases.get(entry.formOf) ??
                    (await wiktionaryEntries(entry.formOf, language)) ??
                    [];
                bases.set(entry.formOf, base);
                const match =
                    base.find(
                        (candidate) =>
                            candidate.partOfSpeech === entry.partOfSpeech &&
                            candidate.formOf === null
                    ) ?? base.find((candidate) => candidate.formOf === null);
                if (!match) {
                    continue;
                }
                term = entry.formOf;
                definitions = match.definitions;
            }
            entries.push({
                term,
                from: fromOf(query, term),
                type: wordTypeOf(entry.partOfSpeech),
                senses: definitions
                    .slice(0, MAX_DICTIONARY_SENSES)
                    .map((definition) => sense(definition)),
            });
        }
        return entries;
    }

    /** The page for `query` as written, where case can tell words apart
     *  ("Polish", "polish"), then in lowercase, as a word at the start of a
     *  line is capitalized. */
    private async wiktionaryPage(
        query: string,
        language: string
    ): Promise<{ title: string; entries: WiktionaryEntry[] } | null> {
        const lower = query.toLocaleLowerCase();
        for (const title of lower === query ? [query] : [query, lower]) {
            const entries = await wiktionaryEntries(title, language);
            if (entries && entries.length > 0) {
                return { title, entries };
            }
        }
        return null;
    }

    /** Wiktionary defines in English; other viewers get one translation of
     *  all the definitions, or the English when it does not line up. */
    private async inTargetLanguage(
        entries: DictionaryEntry[],
        targetLanguage: string
    ): Promise<DictionaryEntry[]> {
        if (entries.length === 0 || targetLanguage.split('-')[0] === 'en') {
            return entries;
        }
        const senses = entries.flatMap((entry) => entry.senses);
        const translated = await this.translate(
            senses.join('\n'),
            'en',
            targetLanguage
        );
        const lines = translated?.split('\n').map((line) => line.trim());
        if (!lines || lines.length !== senses.length || lines.includes('')) {
            return entries;
        }
        let next = 0;
        return entries.map((entry) => ({
            ...entry,
            senses: entry.senses.map(() => sense(lines[next++]!)),
        }));
    }
}
