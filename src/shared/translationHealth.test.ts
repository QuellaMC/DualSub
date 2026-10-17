import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    readTranslationHealth,
    writeTranslationHealth,
    type TranslationHealth,
} from './translationHealth';

const RECORD: TranslationHealth = {
    provider: 'deepl',
    problem: 'quota',
    fallback: 'microsoft_edge',
    since: 42,
};

describe('translation health', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.session.clear();
    });

    it('round-trips a record through session storage and clears it', async () => {
        await writeTranslationHealth(RECORD);
        expect(await readTranslationHealth()).toEqual(RECORD);
        await writeTranslationHealth(null);
        expect(await readTranslationHealth()).toBeNull();
    });

    it.each([
        ['an unknown provider', { ...RECORD, provider: 'babelfish' }],
        ['an unknown problem', { ...RECORD, problem: 'sadness' }],
        ['an extra field', { ...RECORD, note: 'x' }],
        ['a missing field', { provider: 'deepl', problem: 'quota' }],
    ])('reads %s as no record', async (_label, value) => {
        await fakeBrowser.storage.session.set({ translationHealth: value });
        expect(await readTranslationHealth()).toBeNull();
    });
});
