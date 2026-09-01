import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const localesDir = fileURLToPath(
    new URL('../../public/_locales', import.meta.url)
);

const EXPECTED_LOCALES = ['en', 'es', 'ja', 'ko', 'zh_CN', 'zh_TW'];

type MessageEntry = { message: string };
type Messages = Record<string, MessageEntry>;

function loadMessages(locale: string): Messages {
    return JSON.parse(
        readFileSync(join(localesDir, locale, 'messages.json'), 'utf8')
    ) as Messages;
}

function substitutionSignature(text: string): string {
    return (text.match(/%[sd]/g) ?? []).sort().join(',');
}

describe('locale catalogs', () => {
    const english = loadMessages('en');

    it('ships exactly the expected locales', () => {
        expect(readdirSync(localesDir).sort()).toEqual(EXPECTED_LOCALES);
    });

    it('defines the manifest name and description keys', () => {
        expect(english.appName?.message).toBeTruthy();
        expect(english.appDesc?.message).toBeTruthy();
    });

    it.each(EXPECTED_LOCALES.filter((l) => l !== 'en'))(
        '%s has the same keys and %%s/%%d substitutions as en',
        (locale) => {
            const messages = loadMessages(locale);
            expect(Object.keys(messages).sort()).toEqual(
                Object.keys(english).sort()
            );
            for (const [key, entry] of Object.entries(messages)) {
                expect(entry.message, `${locale}/${key}`).toBeTypeOf('string');
                expect(
                    substitutionSignature(entry.message),
                    `${locale}/${key} substitution tokens`
                ).toBe(substitutionSignature(english[key]!.message));
            }
        }
    );
});
