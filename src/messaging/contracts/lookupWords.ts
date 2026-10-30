import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedNonBlankString, languageTag } from './primitives';

/** Word types a dictionary entry can have, named the same for every source;
 *  the panel shows each in the viewer's language. */
export const WORD_TYPES = [
    'noun',
    'verb',
    'adjective',
    'adverb',
    'pronoun',
    'preposition',
    'conjunction',
    'interjection',
    'saying',
    'other',
] as const;

export type WordType = (typeof WORD_TYPES)[number];

/** Where the dictionary entries came from. */
export const DICTIONARY_SOURCES = ['google', 'wiktionary'] as const;

export type DictionarySource = (typeof DICTIONARY_SOURCES)[number];

export const MAX_DICTIONARY_ENTRIES = 6;
export const MAX_DICTIONARY_SENSES = 3;

export const dictionaryEntry = z.strictObject({
    /** The word as the dictionary lists it. */
    term: boundedNonBlankString(256),
    /** The form that was looked up, when it is not the listed word. */
    from: boundedNonBlankString(256).nullable(),
    type: z.enum(WORD_TYPES),
    senses: z
        .array(boundedNonBlankString(1024))
        .min(1)
        .max(MAX_DICTIONARY_SENSES),
});

export type DictionaryEntry = z.infer<typeof dictionaryEntry>;

export const lookupResult = z.strictObject({
    /** The picked words in the target language; null when no translation
     *  came back. */
    translation: boundedNonBlankString(4096).nullable(),
    entries: z.array(dictionaryEntry).max(MAX_DICTIONARY_ENTRIES),
    source: z.enum(DICTIONARY_SOURCES).nullable(),
});

export type LookupResult = z.infer<typeof lookupResult>;

/** The side panel looks up the words a viewer picked: their translation and
 *  dictionary entries. */
export const lookupWords = defineContract({
    action: MessageActions.LOOKUP_WORDS,
    transport: 'runtime',
    senders: ['sidepanel'],
    request: z.strictObject({
        action: z.literal(MessageActions.LOOKUP_WORDS),
        text: boundedNonBlankString(4096),
        /** The language the line is in, when it is known. */
        language: languageTag.nullable(),
        targetLanguage: languageTag,
    }),
    response: lookupResult,
});

export type LookupWordsRequest = z.infer<typeof lookupWords.request>;
