import fs from 'node:fs';

import { Linter } from 'eslint';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';

const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];
const disneyInjectorSource = fs.readFileSync(
    new URL('./disneyPlusInject.js', import.meta.url),
    'utf8'
);
const netflixInjectorSource = fs.readFileSync(
    new URL('./netflixInject.js', import.meta.url),
    'utf8'
);
const netflixCapability = 'c3'.repeat(32);
const contentEntrypointSources = [
    [
        'Disney+',
        fs.readFileSync(
            new URL(
                '../content_scripts/platforms/disneyPlusContent.js',
                import.meta.url
            ),
            'utf8'
        ),
    ],
    [
        'Netflix',
        fs.readFileSync(
            new URL(
                '../content_scripts/platforms/netflixContent.js',
                import.meta.url
            ),
            'utf8'
        ),
    ],
];
const scopedLogSources = [
    ['Disney+ injector', disneyInjectorSource],
    ['Netflix injector', netflixInjectorSource],
    ...contentEntrypointSources.map(([platform, source]) => [
        `${platform} entrypoint`,
        source,
    ]),
];

const getConsoleMethod = (node) => {
    if (
        node?.type !== 'CallExpression' ||
        node.callee?.type !== 'MemberExpression' ||
        node.callee.object?.type !== 'Identifier' ||
        node.callee.object.name !== 'console'
    ) {
        return null;
    }

    const method = node.callee.computed
        ? node.callee.property?.value
        : node.callee.property?.name;
    return consoleMethods.includes(method) ? method : null;
};

const walkNodes = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(value)) {
            value.forEach((child) => walkNodes(child, visit));
        } else if (value?.type) {
            walkNodes(value, visit);
        }
    }
};

const auditSourceLogContract = (source, requireUnboundCatch = false) => {
    let consoleCallCount = 0;
    let catchClauseCount = 0;
    const catchErrorCounts = [];
    const privacyRule = {
        meta: { type: 'problem', schema: [] },
        create(context) {
            return {
                Identifier(node) {
                    if (node.name !== 'console') return;
                    const member = node.parent;
                    const call = member?.parent;
                    if (
                        member?.type === 'MemberExpression' &&
                        member.object === node &&
                        call?.type === 'CallExpression' &&
                        call.callee === member &&
                        getConsoleMethod(call)
                    ) {
                        return;
                    }

                    context.report({
                        node,
                        message:
                            'Console methods must not be aliased or reached through another object.',
                    });
                },
                CallExpression(node) {
                    if (!getConsoleMethod(node)) return;
                    consoleCallCount += 1;
                    if (
                        node.arguments.length !== 1 ||
                        node.arguments[0]?.type !== 'Literal' ||
                        typeof node.arguments[0].value !== 'string'
                    ) {
                        context.report({
                            node,
                            message:
                                'Console calls must receive exactly one fixed string literal.',
                        });
                    }
                },
                CatchClause(node) {
                    catchClauseCount += 1;
                    if (requireUnboundCatch && node.param !== null) {
                        context.report({
                            node,
                            message:
                                'Entrypoint failure handlers must not bind a throwable that could be logged.',
                        });
                    }

                    let errorCallCount = 0;
                    walkNodes(node.body, (child) => {
                        if (getConsoleMethod(child) === 'error') {
                            errorCallCount += 1;
                        }
                    });
                    catchErrorCounts.push(errorCallCount);
                },
            };
        },
    };
    const linter = new Linter();
    const messages = linter.verify(source, [
        {
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            plugins: {
                privacy: {
                    rules: { 'fixed-console-arguments': privacyRule },
                },
            },
            rules: { 'privacy/fixed-console-arguments': 'error' },
        },
    ]);

    return { catchClauseCount, catchErrorCounts, consoleCallCount, messages };
};

describe('page-context log privacy', () => {
    let originalJsonParse;
    let netflixEvents;
    let netflixEventHandler;
    let consoleSpies;

    beforeEach(() => {
        originalJsonParse = JSON.parse;
        const netflixScript = document.createElement('script');
        netflixScript.id = 'netflix-dualsub-injector-script-tag';
        netflixScript.src = `chrome-extension://dualsub-test/injected_scripts/netflixInject.js#dualsub-channel=netflix.${netflixCapability}`;
        document.head.appendChild(netflixScript);
        netflixEvents = [];
        netflixEventHandler = (event) => netflixEvents.push(event.detail);
        document.addEventListener(
            'netflix-dualsub-injector-event',
            netflixEventHandler
        );
        delete window.netflixDualSubInjectorLoaded;
        consoleSpies = Object.fromEntries(
            consoleMethods.map((method) => [
                method,
                jest.spyOn(console, method).mockImplementation(() => {}),
            ])
        );
    });

    afterEach(() => {
        JSON.parse = originalJsonParse;
        delete window.netflixDualSubInjectorLoaded;
        document
            .getElementById('netflix-dualsub-injector-script-tag')
            ?.remove();
        document.removeEventListener(
            'netflix-dualsub-injector-event',
            netflixEventHandler
        );
        Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    });

    test('keeps the Netflix movie identifier out of serialized console output', () => {
        const movieId = 'NETFLIX_MOVIE_ID_CANARY';
        const timedtexttracks = [
            { language: 'en', new_track_id: 'English-en' },
        ];
        const response = { result: { movieId, timedtexttracks } };
        window.eval(netflixInjectorSource);

        const parsed = JSON.parse(JSON.stringify(response));

        expect(parsed).toEqual(response);
        expect(netflixEvents).toContainEqual({
            type: 'SUBTITLE_DATA_FOUND',
            dualsubChannel: {
                platform: 'netflix',
                capability: netflixCapability,
            },
            payload: { movieId, timedtexttracks },
        });
        const consoleArguments = Object.values(consoleSpies).flatMap((spy) =>
            spy.mock.calls.flat()
        );
        expect(consoleArguments.length).toBeGreaterThan(0);
        for (const argument of consoleArguments) {
            expect(typeof argument).toBe('string');
            expect(argument).not.toContain(movieId);
            expect(argument).not.toContain(netflixCapability);
        }
    });

    test.each(scopedLogSources)(
        '%s passes the literal-only console source contract',
        (_component, source) => {
            const audit = auditSourceLogContract(source);

            expect(audit.consoleCallCount).toBeGreaterThan(0);
            expect(audit.messages).toEqual([]);
        }
    );

    test.each(contentEntrypointSources)(
        '%s entrypoint retains failure handling without forwarding the caught error',
        (_platform, source) => {
            const audit = auditSourceLogContract(source, true);

            expect(audit.catchClauseCount).toBe(1);
            expect(audit.catchErrorCounts).toEqual([1]);
            expect(audit.messages).toEqual([]);
        }
    );

    test('source contract rejects hiding objects and secondary dynamic console calls', () => {
        const audit = auditSourceLogContract(
            `try {
                throw new Error('ERROR_MESSAGE_CANARY');
            } catch {
                console.error('fixed failure');
                console.error(window.location.href);
            }
            console.log('%o', {
                secret: 'OBJECT_CANARY',
                toJSON() { return { redacted: true }; }
            });
            const emit = console.error;
            emit(window.location.pathname);`,
            true
        );

        expect(audit.catchErrorCounts).toEqual([2]);
        expect(audit.messages).toHaveLength(3);
        expect(audit.messages.map(({ message }) => message)).toEqual(
            expect.arrayContaining([
                'Console calls must receive exactly one fixed string literal.',
                'Console methods must not be aliased or reached through another object.',
            ])
        );
    });
});
