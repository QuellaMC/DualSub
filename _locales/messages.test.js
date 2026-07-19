import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localeRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(localeRoot, '..');
const localeNames = ['en', 'es', 'ja', 'ko', 'zh_CN', 'zh_TW'];
const runtimeRoots = [
    'background',
    'content_scripts',
    'context_providers',
    'options',
    'popup',
    'services',
    'shared',
    'sidepanel',
    'translation_providers',
    'utils',
    'video_platforms',
];

function loadMessages(localeName) {
    return JSON.parse(
        fs.readFileSync(
            path.join(localeRoot, localeName, 'messages.json'),
            'utf8'
        )
    );
}

function getPlaceholderSignature(message) {
    return message.match(/%(?:d|s)/g) ?? [];
}

function collectRuntimeSourceFiles(relativePath, files = []) {
    const absolutePath = path.join(projectRoot, relativePath);
    for (const entry of fs.readdirSync(absolutePath, {
        withFileTypes: true,
    })) {
        const childRelativePath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'tests') {
                collectRuntimeSourceFiles(childRelativePath, files);
            }
        } else if (
            /\.(?:js|jsx)$/.test(entry.name) &&
            !/\.test\.(?:js|jsx)$/.test(entry.name)
        ) {
            files.push(childRelativePath);
        }
    }
    return files;
}

function collectLiteralRuntimeMessageKeys() {
    const sourceFiles = runtimeRoots.flatMap((root) =>
        collectRuntimeSourceFiles(root)
    );
    sourceFiles.push('background.js');
    const keys = new Set();
    const messageCallPatterns = [
        /\bt\(\s*(['"])([A-Za-z0-9_]+)\1/g,
        /\bgetMessage\(\s*(['"])([A-Za-z0-9_]+)\1/g,
    ];

    for (const relativePath of sourceFiles) {
        const source = fs.readFileSync(
            path.join(projectRoot, relativePath),
            'utf8'
        );
        for (const pattern of messageCallPatterns) {
            for (const match of source.matchAll(pattern)) {
                keys.add(match[2]);
            }
        }
    }

    return [...keys].sort();
}

describe('extension locale catalogs', () => {
    const canonicalMessages = loadMessages('en');
    const canonicalKeys = Object.keys(canonicalMessages).sort();

    test.each(localeNames)(
        '%s matches the canonical English key set',
        (locale) => {
            expect(Object.keys(loadMessages(locale)).sort()).toEqual(
                canonicalKeys
            );
        }
    );

    test.each(localeNames)('%s contains valid message entries', (locale) => {
        const messages = loadMessages(locale);

        for (const [key, entry] of Object.entries(messages)) {
            expect(entry).toEqual({ message: expect.any(String) });
            expect(entry.message.trim()).not.toBe('');
            expect(key.trim()).not.toBe('');
        }
    });

    test.each(localeNames)(
        '%s preserves canonical placeholder signatures',
        (locale) => {
            const messages = loadMessages(locale);
            for (const key of canonicalKeys) {
                expect(getPlaceholderSignature(messages[key].message)).toEqual(
                    getPlaceholderSignature(canonicalMessages[key].message)
                );
            }
        }
    );

    test('canonical catalog covers every literal runtime message key', () => {
        const missingKeys = collectLiteralRuntimeMessageKeys().filter(
            (key) => !(key in canonicalMessages)
        );

        expect(missingKeys).toEqual([]);
    });
});
