import fs from 'node:fs';

import { Linter } from 'eslint';

const sourcePaths = [
    'background/handlers/messageHandler.js',
    'background/parsers/netflixParser.js',
    'background/parsers/ttmlParser.js',
    'background/parsers/vttParser.js',
    'background/services/aiContextService.js',
    'background/services/sidePanelService.js',
    'background/services/subtitleService.js',
    'background/services/translationService.js',
    'content_scripts/aicontext/core/AIContextManager.js',
    'content_scripts/aicontext/handlers/textSelection.js',
    'content_scripts/aicontext/ui/events/ModalController.js',
    'content_scripts/aicontext/ui/modal-core.js',
    'content_scripts/aicontext/ui/modal-events.js',
    'content_scripts/aicontext/ui/modal.js',
    'content_scripts/aicontext/utils/selectionPersistence.js',
    'content_scripts/core/BaseContentScript.js',
    'video_platforms/BasePlatformAdapter.js',
    'video_platforms/disneyPlusPlatform.js',
    'video_platforms/netflixPlatform.js',
    'video_platforms/platform_interface.js',
];

const strictAdapterSourcePaths = new Set([
    'video_platforms/BasePlatformAdapter.js',
    'video_platforms/disneyPlusPlatform.js',
    'video_platforms/netflixPlatform.js',
    'video_platforms/platform_interface.js',
]);

const rawContentFieldPattern =
    /\b(?:analysisResult|config|contentPreview|detail|downloadUrl|firstLines|fullErrorText|fullResponse|metadata|newContent|oldContent|originalLine|payload|playlistPreview|playlistUrl|request|response|result|resultPreview|segmentUrls|selectedText|selectedWords|selection|subtitleContent|text|textPreview|tracksData|ttmlSample|url|word)\s*:/;
const rawContentShorthandPattern =
    /[{,]\s*(?:analysisResult|config|contentPreview|detail|downloadUrl|firstLines|fullErrorText|fullResponse|metadata|newContent|oldContent|originalLine|payload|playlistPreview|playlistUrl|request|response|result|resultPreview|segmentUrls|selectedText|selectedWords|selection|subtitleContent|text|textPreview|tracksData|ttmlSample|url|word)\s*(?=[,}])/;
const rawObjectArgumentPattern =
    /,\s*(?:detail|metadata|payload|request|response|result)\s*\)?\s*$/;
const rawAdapterErrorFieldPattern =
    /\b(?:error|message|stack|cause|customField)\s*:/;
const rawAdapterErrorValuePattern =
    /(?:^|[,(]\s*)(?:error|lastErr|lastError|_error|e)\s*(?=[,)]|$)|\b(?:error|lastErr|lastError|_error|e)(?:\?\.|\.)|\b(?:response|result|settings|config)(?:\?\.|\.)(?:error|message|stack|cause)\b/;
const rawAdapterLanguageFieldPattern =
    /\b(?:sourceLanguage|targetLanguage|originalLanguage|selectedLanguage)\s*:|[{,]\s*(?:sourceLanguage|targetLanguage|originalLanguage|selectedLanguage)\s*(?=[,}])/;
const rawAdapterIdentityFieldPattern =
    /\b(?:url|uri|path|query|videoId|movieId)\s*:|[{,]\s*(?:url|uri|path|query|videoId|movieId)\s*(?=[,}])/;
const repeatedAdapterArrayLengthPattern =
    /\b(?:timedtexttracks|validTracks|bufferedTracks)(?:\?\.|\.)length\b/;
const directAdapterLoggerCallPattern =
    /\b(?:logger|this\.logger)(?:\.|\?\.)(?:debug|info|warn|error)\s*\(/;

function extractLogCalls(source, includeAdapterSinks = false) {
    const calls = [];
    const callStart = includeAdapterSinks
        ? /(?:\b(?:logger|this\.logger)(?:\.|\?\.)(?:debug|info|warn|error)|\bconsole\.(?:debug|info|warn|error)|\b(?:this\.)?(?:core\.)?_log|\b(?:this\.)?_logBestEffort|\b(?:this\.)?logWithFallback)\s*\(/g
        : /(?:\b(?:logger|this\.logger)(?:\.|\?\.)(?:debug|info|warn|error)|\b(?:this\.)?(?:core\.)?_log|\b(?:this\.)?logWithFallback)\s*\(/g;
    for (const match of source.matchAll(callStart)) {
        let depth = 1;
        let quote = null;
        let escaped = false;
        let index = match.index + match[0].length;
        for (; index < source.length && depth > 0; index++) {
            const char = source[index];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quote) {
                    quote = null;
                }
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                quote = char;
            } else if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
            }
        }
        calls.push(source.slice(match.index, index));
    }
    return calls;
}

const baseConsoleMethods = new Set(['log', 'error', 'warn', 'info', 'debug']);
const baseContentLoggerMethods = new Set(['debug', 'info', 'warn', 'error']);
const throwablePropertyNames = new Set(['message', 'stack', 'cause']);
const wholeObjectNames = new Set([
    'request',
    'response',
    'result',
    'error',
    'detail',
    'eventData',
    'subtitleData',
    'changes',
    'event',
    'node',
]);
const catchLikeNames = new Set([
    'error',
    'err',
    'e',
    'lastErr',
    'lastError',
    'cleanupError',
    'listenerError',
]);
const configurationValueNames = new Set([
    'config',
    'currentConfig',
    'aiContextConfig',
    'provider',
    'selectedProvider',
    'aiContextProvider',
    'loggingLevel',
    'level',
]);
const mediaIdentityNames = new Set([
    'videoId',
    'movieId',
    'subtitleId',
    'sourceLanguage',
    'targetLanguage',
    'originalLanguage',
    'selectedLanguage',
    'language',
    'requestId',
]);
const dynamicBridgeNames = new Set(['msg', 'data']);
const codeChannelIdentityNames = new Set([
    'platform',
    'platformFile',
    'platformFilename',
    'moduleFilename',
    'className',
    'platformClassName',
    'eventId',
    'eventType',
    'action',
]);
const urlIdentityNames = new Set([
    'url',
    'pageUrl',
    'currentUrl',
    'subtitleUrl',
]);
const unprojectedStateValueNames = new Set([
    'useNativeTarget',
    'subtitlesActive',
    'enabled',
    'requiresUtilities',
    'isAnalyzing',
]);
const keyArrayNames = new Set(['changedKeys', 'configKeys', 'requestKeys']);
const handlerDescriptionNames = new Set(['description']);
const identityHelperNames = new Set([
    'getPlatformName',
    'getPlatformClass',
    'getInjectScriptConfig',
]);

const getStaticMemberName = (member) => {
    if (member?.type !== 'MemberExpression') return null;
    if (!member.computed && member.property?.type === 'Identifier') {
        return member.property.name;
    }
    if (
        member.computed &&
        member.property?.type === 'Literal' &&
        typeof member.property.value === 'string'
    ) {
        return member.property.value;
    }
    return null;
};

const isThisMember = (node, propertyName) =>
    node?.type === 'MemberExpression' &&
    node.object?.type === 'ThisExpression' &&
    getStaticMemberName(node) === propertyName;

const isFixedString = (node) =>
    node?.type === 'Literal' && typeof node.value === 'string';

const isOperationalContentLoggerUpdateLevel = (callee) =>
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    isThisMember(callee.object, 'contentLogger') &&
    getStaticMemberName(callee) === 'updateLevel';

const getBaseLogSink = (node) => {
    if (node?.type !== 'CallExpression') return null;
    const callee = node.callee;
    if (isThisMember(callee, 'logWithFallback')) {
        return 'logWithFallback';
    }
    if (callee?.type !== 'MemberExpression') return null;

    const method = getStaticMemberName(callee);
    if (
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'console' &&
        baseConsoleMethods.has(method)
    ) {
        return 'console';
    }
    if (isThisMember(callee.object, 'contentLogger')) {
        if (isOperationalContentLoggerUpdateLevel(callee)) return null;
        if (callee.computed || baseContentLoggerMethods.has(method)) {
            return 'contentLogger';
        }
    }
    return null;
};

const isInsideBaseLogSinkHelper = (node) => {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (
            ancestor.type === 'FunctionDeclaration' &&
            ancestor.id?.name === 'logAIContextLifecycleFailure'
        ) {
            return true;
        }
        if (
            ancestor.type === 'MethodDefinition' &&
            !ancestor.computed &&
            ancestor.key?.type === 'Identifier' &&
            ancestor.key.name === 'logWithFallback' &&
            ancestor.parent?.type === 'ClassBody' &&
            ancestor.parent.parent?.id?.name === 'BaseContentScript'
        ) {
            return true;
        }
    }
    return false;
};

const isWindowLocationMember = (node) =>
    node?.type === 'MemberExpression' &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'window' &&
    getStaticMemberName(node) === 'location';

const getThisIdentityHelperName = (node) => {
    if (
        node?.type !== 'CallExpression' ||
        node.callee?.type !== 'MemberExpression' ||
        node.callee.object?.type !== 'ThisExpression'
    ) {
        return null;
    }
    const helperName = getStaticMemberName(node.callee);
    return identityHelperNames.has(helperName) ? helperName : null;
};

const containsStrictForbiddenMetadata = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (
        node.type === 'Identifier' &&
        (codeChannelIdentityNames.has(node.name) ||
            keyArrayNames.has(node.name) ||
            handlerDescriptionNames.has(node.name))
    ) {
        return true;
    }
    if (
        node.type === 'MemberExpression' &&
        (codeChannelIdentityNames.has(getStaticMemberName(node)) ||
            keyArrayNames.has(getStaticMemberName(node)) ||
            handlerDescriptionNames.has(getStaticMemberName(node)))
    ) {
        return true;
    }
    if (getThisIdentityHelperName(node)) return true;
    return Object.entries(node).some(
        ([key, value]) =>
            key !== 'parent' &&
            (Array.isArray(value)
                ? value.some(containsStrictForbiddenMetadata)
                : value?.type && containsStrictForbiddenMetadata(value))
    );
};

const containsSensitiveLengthSource = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (isWindowLocationMember(node)) return true;
    if (getThisIdentityHelperName(node)) return true;
    if (
        node.type === 'Identifier' &&
        (catchLikeNames.has(node.name) ||
            wholeObjectNames.has(node.name) ||
            configurationValueNames.has(node.name) ||
            mediaIdentityNames.has(node.name) ||
            dynamicBridgeNames.has(node.name) ||
            codeChannelIdentityNames.has(node.name) ||
            urlIdentityNames.has(node.name) ||
            unprojectedStateValueNames.has(node.name) ||
            keyArrayNames.has(node.name) ||
            handlerDescriptionNames.has(node.name))
    ) {
        return true;
    }
    if (
        node.type === 'MemberExpression' &&
        (throwablePropertyNames.has(getStaticMemberName(node)) ||
            getStaticMemberName(node) === 'detail' ||
            getStaticMemberName(node) === 'tagName' ||
            configurationValueNames.has(getStaticMemberName(node)) ||
            mediaIdentityNames.has(getStaticMemberName(node)) ||
            codeChannelIdentityNames.has(getStaticMemberName(node)) ||
            urlIdentityNames.has(getStaticMemberName(node)) ||
            unprojectedStateValueNames.has(getStaticMemberName(node)) ||
            keyArrayNames.has(getStaticMemberName(node)) ||
            handlerDescriptionNames.has(getStaticMemberName(node)) ||
            (node.object?.type === 'Identifier' &&
                node.object.name === 'request' &&
                getStaticMemberName(node) === 'action'))
    ) {
        return true;
    }
    return Object.entries(node).some(
        ([key, value]) =>
            key !== 'parent' &&
            (Array.isArray(value)
                ? value.some(containsSensitiveLengthSource)
                : value?.type && containsSensitiveLengthSource(value))
    );
};

const isObjectKeysCall = (node) =>
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'Object' &&
    getStaticMemberName(node.callee) === 'keys';

const isSafeProjection = (node) => {
    if (
        node?.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'Boolean'
    ) {
        return !node.arguments.some(containsStrictForbiddenMetadata);
    }
    if (
        node?.type === 'UnaryExpression' &&
        ['!', 'typeof'].includes(node.operator)
    ) {
        return !containsStrictForbiddenMetadata(node.argument);
    }
    return (
        node?.type === 'MemberExpression' &&
        getStaticMemberName(node) === 'length' &&
        !containsStrictForbiddenMetadata(node.object) &&
        (isObjectKeysCall(node.object) ||
            !containsSensitiveLengthSource(node.object))
    );
};

const auditBaseMetadata = (node, context) => {
    const report = (target, message) =>
        context.report({ node: target, message });
    const reportForbiddenName = (target, name) => {
        if (codeChannelIdentityNames.has(name)) {
            report(
                target,
                'Log metadata must not include subclass or code-channel identities.'
            );
            return true;
        }
        if (keyArrayNames.has(name)) {
            report(
                target,
                'Log metadata must not include changedKeys, configKeys, or requestKeys arrays.'
            );
            return true;
        }
        if (handlerDescriptionNames.has(name)) {
            report(
                target,
                'Log metadata must not include handler descriptions.'
            );
            return true;
        }
        return false;
    };
    const visit = (
        current,
        catchBindingNames = new Set(),
        isTopLevelMetadata = false
    ) => {
        if (!current || typeof current !== 'object') return;
        if (isSafeProjection(current)) return;

        if (current.type === 'Identifier') {
            if (reportForbiddenName(current, current.name)) {
                return;
            }
            if (
                catchBindingNames.has(current.name) ||
                catchLikeNames.has(current.name)
            ) {
                report(
                    current,
                    'Log metadata must not include catch bindings or Error objects.'
                );
            } else if (wholeObjectNames.has(current.name)) {
                report(
                    current,
                    'Log metadata must not include whole request, response, result, error, detail, or eventData objects.'
                );
            } else if (configurationValueNames.has(current.name)) {
                report(
                    current,
                    'Log metadata must not include configuration, provider, or logging-level values.'
                );
            } else if (mediaIdentityNames.has(current.name)) {
                report(
                    current,
                    'Log metadata must not include request, video, movie, subtitle, or language identities.'
                );
            } else if (dynamicBridgeNames.has(current.name)) {
                report(
                    current,
                    'Log metadata must not forward dynamic EventBuffer, navigation, or injector bridge values.'
                );
            } else if (urlIdentityNames.has(current.name)) {
                report(
                    current,
                    'Log metadata must not include URL identities.'
                );
            } else if (unprojectedStateValueNames.has(current.name)) {
                report(
                    current,
                    'Log metadata state values must use Boolean(...) projection.'
                );
            } else if (isTopLevelMetadata) {
                report(
                    current,
                    'Log metadata aliases are forbidden; inline an auditable object or safe projection.'
                );
            }
            return;
        }

        if (
            current.type === 'NewExpression' &&
            current.callee?.type === 'Identifier' &&
            current.callee.name === 'Error'
        ) {
            report(
                current,
                'Log metadata must not include catch bindings or Error objects.'
            );
        }

        if (current.type === 'MemberExpression') {
            const propertyName = getStaticMemberName(current);
            reportForbiddenName(current, propertyName);
            if (urlIdentityNames.has(propertyName)) {
                report(
                    current,
                    'Log metadata must not include URL identities.'
                );
                return;
            }
            if (unprojectedStateValueNames.has(propertyName)) {
                report(
                    current,
                    'Log metadata state values must use Boolean(...) projection.'
                );
                return;
            }
            if (throwablePropertyNames.has(propertyName)) {
                report(
                    current,
                    'Log metadata must not include .message, .stack, or .cause.'
                );
            }
            if (isWindowLocationMember(current)) {
                report(
                    current,
                    'Log metadata must not include window.location.'
                );
            }
            if (
                propertyName === 'detail' ||
                (current.object?.type === 'Identifier' &&
                    current.object.name === 'event' &&
                    propertyName === 'detail')
            ) {
                report(
                    current,
                    'Log metadata must not include event.detail, detail, or eventData.'
                );
            }
            if (
                current.object?.type === 'Identifier' &&
                current.object.name === 'request' &&
                propertyName === 'action'
            ) {
                report(
                    current,
                    'Log metadata must not include request actions or key arrays.'
                );
            }
            if (configurationValueNames.has(propertyName)) {
                report(
                    current,
                    'Log metadata must not include configuration, provider, or logging-level values.'
                );
            }
            if (mediaIdentityNames.has(propertyName)) {
                report(
                    current,
                    'Log metadata must not include request, video, movie, subtitle, or language identities.'
                );
            }
            if (propertyName === 'tagName') {
                report(
                    current,
                    'Log metadata must not include DOM tagName identities.'
                );
            }
            visit(current.object, catchBindingNames);
            if (current.computed) visit(current.property, catchBindingNames);
            return;
        }

        if (current.type === 'CallExpression') {
            const identityHelperName = getThisIdentityHelperName(current);
            if (identityHelperName) {
                report(
                    current,
                    `Log metadata must not include this.${identityHelperName}().`
                );
            }
            if (isObjectKeysCall(current)) {
                report(
                    current,
                    'Log metadata must not include Object.keys(...) arrays; project only their count.'
                );
            }
            current.arguments.forEach((argument) =>
                visit(argument, catchBindingNames)
            );
            return;
        }

        if (current.type === 'ObjectExpression') {
            current.properties.forEach((property) => {
                if (property.computed) visit(property.key, catchBindingNames);
                if (property.type === 'Property') {
                    const propertyName =
                        !property.computed &&
                        property.key?.type === 'Identifier'
                            ? property.key.name
                            : property.key?.type === 'Literal' &&
                                typeof property.key.value === 'string'
                              ? property.key.value
                              : null;
                    const reportedShorthand = reportForbiddenName(
                        property.key,
                        propertyName
                    );
                    if (!(property.shorthand && reportedShorthand)) {
                        visit(property.value, catchBindingNames);
                    }
                } else if (property.type === 'SpreadElement') {
                    visit(property.argument, catchBindingNames);
                }
            });
            return;
        }

        if (current.type === 'CatchClause') {
            const nestedCatchBindings = new Set(catchBindingNames);
            if (current.param?.type === 'Identifier') {
                nestedCatchBindings.add(current.param.name);
            }
            visit(current.body, nestedCatchBindings);
            return;
        }

        for (const [key, value] of Object.entries(current)) {
            if (key === 'parent' || key === 'callee') continue;
            if (Array.isArray(value)) {
                value.forEach((child) => visit(child, catchBindingNames));
            } else if (value?.type) {
                visit(value, catchBindingNames);
            }
        }
    };

    const catchBindingNames = new Set();
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (
            ancestor.type === 'CatchClause' &&
            ancestor.param?.type === 'Identifier'
        ) {
            catchBindingNames.add(ancestor.param.name);
        }
    }
    visit(node, catchBindingNames, true);
};

const auditBaseContentScriptLogContract = (source) => {
    const privacyRule = {
        meta: { type: 'problem', schema: [] },
        create(context) {
            return {
                MemberExpression(node) {
                    if (
                        node.object?.type === 'Identifier' &&
                        node.object.name === 'window' &&
                        getStaticMemberName(node) === '__dualsub_log'
                    ) {
                        context.report({
                            node,
                            message:
                                'The page-visible window.__dualsub_log bridge is forbidden.',
                        });
                    }
                },
                CallExpression(node) {
                    const sink = getBaseLogSink(node);
                    if (!sink || isInsideBaseLogSinkHelper(node)) return;

                    if (sink === 'logWithFallback') {
                        if (!isFixedString(node.arguments[0])) {
                            context.report({
                                node: node.arguments[0] || node,
                                message:
                                    'logWithFallback level must be a fixed string literal.',
                            });
                        }
                        if (!isFixedString(node.arguments[1])) {
                            context.report({
                                node: node.arguments[1] || node,
                                message:
                                    'logWithFallback message must be a fixed string literal.',
                            });
                        }
                        node.arguments
                            .slice(2)
                            .forEach((argument) =>
                                auditBaseMetadata(argument, context)
                            );
                        return;
                    }

                    if (
                        node.arguments.length !== 1 ||
                        !isFixedString(node.arguments[0])
                    ) {
                        context.report({
                            node,
                            message: `${sink} log calls must receive exactly one fixed string literal.`,
                        });
                    }
                },
            };
        },
    };
    const linter = new Linter();
    return linter.verify(source, [
        {
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            plugins: {
                privacy: {
                    rules: { 'base-log-contract': privacyRule },
                },
            },
            rules: { 'privacy/base-log-contract': 'error' },
        },
    ]);
};

describe('production logging privacy source guard', () => {
    test.each(sourcePaths)(
        '%s logs metadata, not user content',
        (sourcePath) => {
            const source = fs.readFileSync(
                new URL(`../${sourcePath}`, import.meta.url),
                'utf8'
            );

            if (strictAdapterSourcePaths.has(sourcePath)) {
                expect(source).not.toMatch(directAdapterLoggerCallPattern);
            }

            for (const logCall of extractLogCalls(
                source,
                strictAdapterSourcePaths.has(sourcePath)
            )) {
                expect(logCall).not.toMatch(rawContentFieldPattern);
                expect(logCall).not.toMatch(rawContentShorthandPattern);
                expect(logCall.trim()).not.toMatch(rawObjectArgumentPattern);
                if (strictAdapterSourcePaths.has(sourcePath)) {
                    expect(logCall).not.toMatch(rawAdapterErrorFieldPattern);
                    expect(logCall).not.toMatch(rawAdapterErrorValuePattern);
                    expect(logCall).not.toMatch(rawAdapterLanguageFieldPattern);
                    expect(logCall).not.toMatch(rawAdapterIdentityFieldPattern);
                    expect(logCall).not.toMatch(
                        repeatedAdapterArrayLengthPattern
                    );
                }
            }
        }
    );

    test('BaseContentScript logs only fixed messages and bounded metadata', () => {
        const source = fs.readFileSync(
            new URL(
                '../content_scripts/core/BaseContentScript.js',
                import.meta.url
            ),
            'utf8'
        );

        expect(auditBaseContentScriptLogContract(source)).toEqual([]);
    });

    test('BaseContentScript AST guard rejects every privileged log leak class', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                logWithFallback(level, message, data = {}) {
                    this.contentLogger[level](message, data);
                    console.log('[DualSub]', message, data);
                }
                leak(level, msg, request, response, result, event, eventData,
                    config, provider, loggingLevel, videoId, sourceLanguage, node, data) {
                    try {
                        throw new Error('canary');
                    } catch (error) {
                        this.logWithFallback(level, msg, {
                            error,
                            throwableMessage: error.message,
                            throwableStack: error.stack,
                            throwableCause: error.cause,
                            location: window.location.href,
                            detail: event.detail,
                            eventData,
                            action: request.action,
                            requestKeys: Object.keys(request),
                            config,
                            provider,
                            loggingLevel,
                            videoId,
                            sourceLanguage,
                            tagName: node.tagName,
                            platform: this.getPlatformName(),
                            response,
                            result,
                            data,
                            constructed: new Error('canary'),
                        });
                        this.contentLogger.warn('fixed', request);
                        console.error(error);
                    }
                    window.__dualsub_log = () => {};
                    window.__dualsub_log?.('warn', msg, data);
                }
            }
        `);
        const categories = messages.map(({ message }) => message);

        expect(categories).toEqual(
            expect.arrayContaining([
                'logWithFallback level must be a fixed string literal.',
                'logWithFallback message must be a fixed string literal.',
                'Log metadata must not include catch bindings or Error objects.',
                'Log metadata must not include .message, .stack, or .cause.',
                'Log metadata must not include window.location.',
                'Log metadata must not include event.detail, detail, or eventData.',
                'Log metadata must not include request actions or key arrays.',
                'Log metadata must not include Object.keys(...) arrays; project only their count.',
                'Log metadata must not include configuration, provider, or logging-level values.',
                'Log metadata must not include request, video, movie, subtitle, or language identities.',
                'Log metadata must not include DOM tagName identities.',
                'Log metadata must not include this.getPlatformName().',
                'Log metadata must not include whole request, response, result, error, detail, or eventData objects.',
                'Log metadata must not forward dynamic EventBuffer, navigation, or injector bridge values.',
                'contentLogger log calls must receive exactly one fixed string literal.',
                'console log calls must receive exactly one fixed string literal.',
                'The page-visible window.__dualsub_log bridge is forbidden.',
            ])
        );
        expect(
            categories.filter(
                (message) =>
                    message ===
                    'The page-visible window.__dualsub_log bridge is forbidden.'
            )
        ).toHaveLength(2);
    });

    test('BaseContentScript AST guard permits fixed logs, booleans, and counts', () => {
        const messages = auditBaseContentScriptLogContract(`
            function logAIContextLifecycleFailure(contentScript, level, message) {
                console.warn(message);
                contentScript.logWithFallback(level, message);
            }
            class BaseContentScript {
                logWithFallback(level, message, data = {}) {
                    this.contentLogger[level](message, data);
                    console.log('[DualSub]', message, data);
                }
                safe(config, request, provider, error, items, enabled,
                    platformReady, platformInitialized) {
                    this.logWithFallback('info', 'Platform fixed message.', {
                        enabled: Boolean(enabled),
                        hasProvider: Boolean(provider),
                        hadError: Boolean(error),
                        platformReady: Boolean(platformReady),
                        platformInitialized: Boolean(platformInitialized),
                        itemCount: items.length,
                        changedKeyCount: Object.keys(config).length,
                        configKeyCount: Object.keys(config).length,
                        settingCount: Object.keys(config).length,
                        requestKeyCount: Object.keys(request).length,
                        message: 'Fixed metadata.',
                        constant: 3,
                    });
                    this.contentLogger.info('Fixed logger message.');
                    this.contentLogger.updateLevel(config.loggingLevel);
                    console.warn('Fixed console message.');
                }
            }
        `);

        expect(messages).toEqual([]);
    });

    test('BaseContentScript AST guard rejects identity aliases, key arrays, descriptions, and computed logger sinks', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                logWithFallback(level, message, data = {}) {
                    this.contentLogger[level](message, data);
                }
                leak(level, source) {
                    const platform = source.platform;
                    const platformFile = source.platformFile;
                    const platformFilename = source.platformFilename;
                    const moduleFilename = source.moduleFilename;
                    const className = source.className;
                    const platformClassName = source.platformClassName;
                    const eventId = source.eventId;
                    const changedKeys = source.changedKeys;
                    const configKeys = source.configKeys;
                    const requestKeys = source.requestKeys;
                    const description = source.description;
                    this.logWithFallback('info', 'Fixed message.', {
                        platform,
                        platformFile,
                        platformFilename,
                        moduleFilename,
                        className,
                        platformClassName,
                        eventId,
                        changedKeys,
                        configKeys,
                        requestKeys,
                        description,
                        derivedPlatform: this.getPlatformName(),
                        derivedClass: this.getPlatformClass(),
                        injectConfig: this.getInjectScriptConfig(),
                    });
                    this.contentLogger[level](description);
                }
            }
        `);
        const categories = messages.map(({ message }) => message);

        expect(
            categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include subclass or code-channel identities.'
            )
        ).toHaveLength(7);
        expect(
            categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include changedKeys, configKeys, or requestKeys arrays.'
            )
        ).toHaveLength(3);
        expect(
            categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include handler descriptions.'
            )
        ).toHaveLength(1);
        expect(categories).toEqual(
            expect.arrayContaining([
                'Log metadata must not include this.getPlatformName().',
                'Log metadata must not include this.getPlatformClass().',
                'Log metadata must not include this.getInjectScriptConfig().',
                'contentLogger log calls must receive exactly one fixed string literal.',
            ])
        );
    });

    test('BaseContentScript AST guard rejects lengths from sensitive sources', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                leak(error, event) {
                    this.logWithFallback('warn', 'Fixed message.', {
                        errorLength: error.message.length,
                        detailLength: event.detail.length,
                    });
                }
            }
        `);

        expect(messages.map(({ message }) => message)).toEqual(
            expect.arrayContaining([
                'Log metadata must not include .message, .stack, or .cause.',
                'Log metadata must not include event.detail, detail, or eventData.',
            ])
        );
    });

    test('BaseContentScript AST guard rejects an innocuous bare metadata alias', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                leak(error) {
                    const errorContext = {
                        error: error.message,
                        stack: error.stack,
                        platform: this.getPlatformName(),
                        className: this.PlatformClass?.name,
                        currentUrl: window.location.href,
                    };
                    this.logWithFallback(
                        'error',
                        'Fixed message.',
                        errorContext
                    );
                }
            }
        `);

        expect(messages.map(({ message }) => message)).toEqual([
            'Log metadata aliases are forbidden; inline an auditable object or safe projection.',
        ]);
    });

    test('BaseContentScript AST guard rejects raw ingress objects, URLs, event identity, and state values', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                leak(
                    subtitleData,
                    changes,
                    event,
                    node,
                    url,
                    pageUrl,
                    currentUrl,
                    subtitleUrl,
                    eventType
                ) {
                    this.logWithFallback('debug', 'Fixed message.', {
                        subtitleData,
                        changes,
                        event,
                        node,
                        url,
                        pageUrl,
                        currentUrl,
                        subtitleUrl,
                        eventType,
                        useNativeTarget: subtitleData.useNativeTarget,
                        subtitlesActive: this.subtitleUtils.subtitlesActive,
                    });
                    this.logWithFallback('debug', 'Fixed safe message.', {
                        hasNativeTarget: Boolean(
                            subtitleData.useNativeTarget
                        ),
                        isSubtitlesActive: Boolean(
                            this.subtitleUtils.subtitlesActive
                        ),
                    });
                }
            }
        `);
        const categories = messages.map(({ message }) => message);

        const categoryCounts = {
            wholeObjects: categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include whole request, response, result, error, detail, or eventData objects.'
            ).length,
            urls: categories.filter(
                (message) =>
                    message === 'Log metadata must not include URL identities.'
            ).length,
            codeChannelIdentities: categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include subclass or code-channel identities.'
            ).length,
            unprojectedStateValues: categories.filter(
                (message) =>
                    message ===
                    'Log metadata state values must use Boolean(...) projection.'
            ).length,
        };

        expect(categoryCounts).toEqual({
            wholeObjects: 4,
            urls: 4,
            codeChannelIdentities: 1,
            unprojectedStateValues: 2,
        });
    });

    test('BaseContentScript AST guard rejects raw message-handler aliases and unprojected state', () => {
        const messages = auditBaseContentScriptLogContract(`
            class BaseContentScript {
                leak(action, level, enabled, requiresUtilities, isAnalyzing) {
                    this.logWithFallback('debug', 'Fixed message.', {
                        action,
                        level,
                        enabled,
                        requiresUtilities,
                        isAnalyzing,
                    });
                    this.logWithFallback('debug', 'Fixed safe message.', {
                        isEnabled: Boolean(enabled),
                        hasRequiredUtilities: Boolean(requiresUtilities),
                        isAnalyzing: Boolean(isAnalyzing),
                    });
                }
            }
        `);
        const categories = messages.map(({ message }) => message);

        expect({
            codeChannelIdentities: categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include subclass or code-channel identities.'
            ).length,
            loggingLevels: categories.filter(
                (message) =>
                    message ===
                    'Log metadata must not include configuration, provider, or logging-level values.'
            ).length,
            unprojectedStateValues: categories.filter(
                (message) =>
                    message ===
                    'Log metadata state values must use Boolean(...) projection.'
            ).length,
        }).toEqual({
            codeChannelIdentities: 1,
            loggingLevels: 1,
            unprojectedStateValues: 3,
        });
    });
});
