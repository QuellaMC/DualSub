import { parseSync } from '@babel/core';
import fs from 'node:fs';

const readSource = (relativePath) =>
    fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const parseModule = (source, filename) =>
    parseSync(source, {
        babelrc: false,
        configFile: false,
        filename,
        sourceType: 'module',
    }).program;

function collectNodes(root, predicate, skipNode = null) {
    const matches = [];

    function visit(value) {
        if (!value || typeof value !== 'object' || value === skipNode) return;
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry);
            return;
        }
        if (predicate(value)) matches.push(value);
        for (const child of Object.values(value)) visit(child);
    }

    visit(root);
    return matches;
}

function isIdentifier(node, name) {
    return node?.type === 'Identifier' && node.name === name;
}

function isStringLiteral(node, value) {
    return node?.type === 'StringLiteral' && node.value === value;
}

function isNormalizeCueTextCall(node) {
    return (
        node.type === 'CallExpression' &&
        isIdentifier(node.callee, 'normalizeCueText')
    );
}

function isTextLinesJoinCall(node) {
    return (
        node?.type === 'CallExpression' &&
        node.arguments.length === 1 &&
        isStringLiteral(node.arguments[0], '\n') &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        isIdentifier(node.callee.object, 'textLines') &&
        isIdentifier(node.callee.property, 'join')
    );
}

function isReplaceCall(node) {
    return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        ['replace', 'replaceAll'].includes(node.callee.property?.name)
    );
}

const entityTokenSamples = Object.freeze([
    '&#38;',
    '&#39;',
    '&#169;',
    '&#x26;',
    '&#x3C;',
    '&#x1F600;',
    '&#X26;',
    '&amp;',
    '&AMP;',
    '&lt;',
    '&LT;',
    '&gt;',
    '&GT;',
    '&quot;',
    '&QUOT;',
    '&apos;',
    '&APOS;',
    '&nbsp;',
    '&NBSP;',
    '&lrm;',
    '&LRM;',
    '&rlm;',
    '&RLM;',
]);
const ampersandPatternSource = /&|\\x26|\\u0026|\\u\{26\}/i;

function readStaticString(node) {
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
    }
    return null;
}

function readRegexDescriptor(node) {
    if (node.type === 'RegExpLiteral') {
        return { source: node.pattern, flags: node.flags ?? '' };
    }
    if (
        (node.type === 'CallExpression' || node.type === 'NewExpression') &&
        isIdentifier(node.callee, 'RegExp')
    ) {
        const source = readStaticString(node.arguments[0]);
        if (source === null) return null;
        return {
            source,
            flags: readStaticString(node.arguments[1]) ?? '',
        };
    }
    return null;
}

function isEntityDecoderPattern(node) {
    const descriptor = readRegexDescriptor(node);
    if (!descriptor || !ampersandPatternSource.test(descriptor.source)) {
        return false;
    }

    try {
        const safeFlags = descriptor.flags.replace(/[gy]/g, '');
        const pattern = new RegExp(descriptor.source, safeFlags);
        return entityTokenSamples.some((entity) => {
            const match = pattern.exec(entity);
            return match?.index === 0 && match[0] === entity;
        });
    } catch {
        return false;
    }
}

const ttmlSource = readSource('background/parsers/ttmlParser.js');
const subtitleUtilitiesSource = readSource(
    'content_scripts/shared/subtitleUtilities.js'
);
const manifest = JSON.parse(readSource('manifest.json'));
const ttmlAst = parseModule(ttmlSource, 'background/parsers/ttmlParser.js');
const subtitleUtilitiesAst = parseModule(
    subtitleUtilitiesSource,
    'content_scripts/shared/subtitleUtilities.js'
);

const parsePElementsMethods = collectNodes(
    ttmlAst,
    (node) =>
        node.type === 'ClassMethod' && isIdentifier(node.key, 'parsePElements')
);
const parseVttFunctions = collectNodes(
    subtitleUtilitiesAst,
    (node) =>
        node.type === 'FunctionDeclaration' && isIdentifier(node.id, 'parseVTT')
);
const computeTextSignatureFunctions = collectNodes(
    subtitleUtilitiesAst,
    (node) =>
        node.type === 'FunctionDeclaration' &&
        isIdentifier(node.id, 'computeTextSignature')
);
const entityDetectorFixtureAst = parseModule(
    `
        const groupedNamed = /&(?:amp;|lt;)/gi;
        const groupedMixed = new RegExp('&(?:#(?:x)?|amp|lt);', 'gi');
        const encoder = /&/g;
    `,
    'tests/entity-detector-fixture.js'
);

const legacyTtmlHelpers = new Set([
    'decodeEntities',
    'decodeNumericEntity',
    'parseCueText',
]);
const legacyWebVttHelpers = new Set([
    'decodeNumericEntity',
    'decodeCueTextEntities',
    'normalizeVttCueText',
]);

describe('shared cue-text normalizer source contract', () => {
    test.each([
        ['TTML', ttmlAst, ['normalizeCueText']],
        [
            'WebVTT',
            subtitleUtilitiesAst,
            ['normalizeCueLineEndings', 'normalizeCueText'],
        ],
    ])(
        '%s consumer has exact unaliased shared imports',
        (_label, ast, names) => {
            const imports = ast.body.filter(
                (node) =>
                    node.type === 'ImportDeclaration' &&
                    node.source.value === '../../utils/cueTextNormalizer.js'
            );

            expect(imports).toHaveLength(1);
            expect(imports[0].specifiers).toHaveLength(names.length);
            expect(
                imports[0].specifiers.map((specifier) => {
                    expect(specifier.type).toBe('ImportSpecifier');
                    expect(specifier.imported.name).toBe(specifier.local.name);
                    return specifier.imported.name;
                })
            ).toEqual(names);
        }
    );

    test('TTMLParser.parsePElements calls only the shared TTML normalizer', () => {
        expect(parsePElementsMethods).toHaveLength(1);
        const calls = collectNodes(
            parsePElementsMethods[0],
            isNormalizeCueTextCall
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].arguments).toHaveLength(2);
        expect(isIdentifier(calls[0].arguments[0], 'textContent')).toBe(true);
        expect(isStringLiteral(calls[0].arguments[1], 'ttml')).toBe(true);
        expect(collectNodes(parsePElementsMethods[0], isReplaceCall)).toEqual(
            []
        );
    });

    test('parseVTT calls only the shared WebVTT normalizer', () => {
        expect(parseVttFunctions).toHaveLength(1);
        const calls = collectNodes(
            parseVttFunctions[0],
            isNormalizeCueTextCall
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].arguments).toHaveLength(2);
        expect(isTextLinesJoinCall(calls[0].arguments[0])).toBe(true);
        expect(isStringLiteral(calls[0].arguments[1], 'webvtt')).toBe(true);
        expect(collectNodes(parseVttFunctions[0], isReplaceCall)).toEqual([]);
    });

    test('legacy consumer-local normalization helper names are absent from code', () => {
        const ttmlIdentifiers = collectNodes(
            ttmlAst,
            (node) =>
                node.type === 'Identifier' && legacyTtmlHelpers.has(node.name)
        );
        const webVttIdentifiers = collectNodes(
            subtitleUtilitiesAst,
            (node) =>
                node.type === 'Identifier' && legacyWebVttHelpers.has(node.name)
        );

        expect(ttmlIdentifiers).toEqual([]);
        expect(webVttIdentifiers).toEqual([]);
    });

    test('entity-decoding regexes remain centralized outside both consumers', () => {
        expect(computeTextSignatureFunctions).toHaveLength(1);
        expect(collectNodes(ttmlAst, isEntityDecoderPattern)).toEqual([]);
        expect(
            collectNodes(
                subtitleUtilitiesAst,
                isEntityDecoderPattern,
                computeTextSignatureFunctions[0]
            )
        ).toEqual([]);
        expect(
            collectNodes(
                computeTextSignatureFunctions[0],
                isEntityDecoderPattern
            ).map(readRegexDescriptor)
        ).toEqual([
            { source: '&nbsp;', flags: 'gi' },
            { source: '&amp;', flags: 'gi' },
            { source: '&lt;', flags: 'gi' },
            { source: '&gt;', flags: 'gi' },
        ]);
    });

    test('entity detector recognizes grouped decoders but not an encoder', () => {
        expect(
            collectNodes(entityDetectorFixtureAst, isEntityDecoderPattern).map(
                readRegexDescriptor
            )
        ).toEqual([
            { source: '&(?:amp;|lt;)', flags: 'gi' },
            { source: '&(?:#(?:x)?|amp|lt);', flags: 'gi' },
        ]);
    });

    test('platform trust surfaces use the same exact HTTPS matches', () => {
        const expectedMatches = [
            'https://*.disneyplus.com/*',
            'https://*.netflix.com/*',
        ];
        const subtitleUtilityGroups = manifest.web_accessible_resources.filter(
            ({ resources = [] }) =>
                resources.includes(
                    'content_scripts/shared/subtitleUtilities.js'
                )
        );

        expect(
            manifest.host_permissions.filter(
                (match) =>
                    match.includes('disneyplus.com') ||
                    match.includes('netflix.com')
            )
        ).toEqual(expectedMatches);
        expect(manifest.content_scripts.map(({ matches }) => matches)).toEqual(
            expectedMatches.map((match) => [match])
        );
        expect(subtitleUtilityGroups).toHaveLength(1);
        expect(
            subtitleUtilityGroups.flatMap(({ matches = [] }) => matches)
        ).toEqual(expectedMatches);
        for (const { resources } of subtitleUtilityGroups) {
            expect(
                resources.filter(
                    (resource) => resource === 'utils/cueTextNormalizer.js'
                )
            ).toHaveLength(1);
        }
    });
});
