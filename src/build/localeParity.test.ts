import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The catalogs are the whole of the extension's user-facing text. Every
// locale must say everything English says, with the same placeholders, and
// English must not carry text nothing asks for.

type Catalog = Record<string, { message: string }>;

const LOCALES_DIR = resolve('public/_locales');
const SOURCE_ROOTS = [resolve('src'), resolve('wxt.config.ts')];

function readCatalog(locale: string): Catalog {
    return JSON.parse(
        readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8')
    ) as Catalog;
}

function sourceFiles(path: string): string[] {
    const stat = readdirSync(path, { withFileTypes: true });
    return stat.flatMap((entry) => {
        const child = join(path, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(child);
        }
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
            ? [child]
            : [];
    });
}

function placeholders(message: string): string[] {
    return message.match(/%[sd]/g) ?? [];
}

const locales = readdirSync(LOCALES_DIR).sort();
const english = readCatalog('en');
const source = SOURCE_ROOTS.flatMap((root) =>
    root.endsWith('.ts') ? [root] : sourceFiles(root)
)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

/** Keys built at runtime from a family prefix rather than written out. */
const DYNAMIC_KEY_PREFIXES = ['lang_'];

function isReferenced(key: string): boolean {
    if (DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        return source.includes(`${key.split('_')[0]}_\${`);
    }
    return (
        new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`).test(source) ||
        source.includes(`__MSG_${key}__`)
    );
}

describe('locale catalogs', () => {
    it('ship every supported locale', () => {
        expect(locales).toEqual(['en', 'es', 'ja', 'ko', 'zh_CN', 'zh_TW']);
    });

    it.each(locales)('%s says everything English says', (locale) => {
        const catalog = readCatalog(locale);
        expect(Object.keys(catalog).sort()).toEqual(
            Object.keys(english).sort()
        );
        for (const [key, entry] of Object.entries(catalog)) {
            expect(entry.message.trim(), key).not.toBe('');
            expect(placeholders(entry.message), key).toEqual(
                placeholders(english[key]!.message)
            );
        }
    });

    it('carries no English text the extension never asks for', () => {
        const unused = Object.keys(english).filter((key) => !isReferenced(key));
        expect(unused).toEqual([]);
    });

    it('has English text for every key the code asks for', () => {
        const asked = new Set<string>();
        for (const match of source.matchAll(
            /(?:\bt|overlayText)\(\s*'([A-Za-z0-9_]+)'/g
        )) {
            asked.add(match[1]!);
        }
        for (const match of source.matchAll(/Key="([A-Za-z0-9_]+)"/g)) {
            asked.add(match[1]!);
        }
        const missing = [...asked].filter((key) => !(key in english));
        expect(missing).toEqual([]);
    });
});
