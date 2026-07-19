import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PRODUCTION_ROOTS = [
    'background',
    'config',
    'content_scripts',
    'context_providers',
    'injected_scripts',
    'options',
    'popup',
    'services',
    'shared',
    'sidepanel',
    'translation_providers',
    'utils',
    'video_platforms',
];

const RETIRED_CATALOG_MEMBERS = [
    'CHANGE_PROVIDER',
    'CHANGE_CONTEXT_PROVIDER',
    'GET_CONTEXT_STATUS',
    'GET_AVAILABLE_MODELS',
    'GET_DEFAULT_MODEL',
    'RELOAD_CONTEXT_PROVIDER_CONFIG',
    'SIDEPANEL_OPEN',
    'TOGGLE_SUBTITLES',
];

const RETIRED_ACTION_LITERALS = [
    'changeProvider',
    'changeContextProvider',
    'getContextStatus',
    'getAvailableModels',
    'getDefaultModel',
    'reloadContextProviderConfig',
    'sidePanelOpen',
    'updateConfig',
    'toggleFeature',
    'getStatus',
    'dualsub-config-update',
    'dualsub-feature-toggle',
    'toggleSubtitles',
    'toggleInteractiveSubtitles',
    'updateContextPreferences',
];

const RETIRED_TRANSPORT_IDENTIFIERS = [
    'forwardWordSelection',
    'tabStates',
    'openReason',
    'bindingChanged',
    'getBinding',
    'sendToTab',
    'sendToBoundTab',
    'backgroundMessageListener',
    '_setupCrossPlatformCommunication',
    '_handleBackgroundMessage',
    '_handleConfigurationUpdate',
    '_handleFeatureToggle',
    'reinitialize',
];

const RETIRED_PLATFORM_HANDLER_IDENTIFIERS = [
    'handlePlatformSpecificMessage',
    '_handleNetflixSpecificAction',
    '_handleToggleInteractiveSubtitles',
    '_handleUpdateContextPreferences',
    '_toggleInteractiveSubtitles',
    '_updateContextPreferences',
];

function isProductionJavaScript(filePath) {
    const normalizedPath = filePath.replaceAll('\\', '/');
    const fileName = normalizedPath.split('/').at(-1);

    return (
        /\.(?:js|jsx|mjs)$/.test(fileName) &&
        !/(?:^|\/)tests?(?:\/|$)/.test(normalizedPath) &&
        !/\.(?:test|spec)\.(?:js|jsx|mjs)$/.test(fileName)
    );
}

function collectProductionJavaScript(directory) {
    const files = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filePath = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectProductionJavaScript(filePath));
        } else if (isProductionJavaScript(filePath)) {
            files.push(filePath);
        }
    }

    return files;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const productionFiles = PRODUCTION_ROOTS.flatMap((root) =>
    collectProductionJavaScript(root)
);

describe('retired message-route source guard', () => {
    test('keeps the active Popup config sender on the centralized protocol', () => {
        const source = readFileSync('popup/hooks/useChromeMessage.js', 'utf8');

        expect(source).toContain('buildConfigChangedRequestMessage');
        expect(source).toContain('parseContentControlResponseMessage');
        expect(source).not.toMatch(/["'`]configChanged["'`]/);
    });

    test('keeps retired catalog members, wire literals, and transport fields out of production', () => {
        const catalogMemberPattern = new RegExp(
            `\\bMessageActions\\s*\\.\\s*(?:${RETIRED_CATALOG_MEMBERS.join('|')})\\b`
        );
        const retiredLiteralPattern = new RegExp(
            `[\\"'\\\`](?:${RETIRED_ACTION_LITERALS.map(escapeRegExp).join('|')})[\\"'\\\`]`
        );
        const retiredTransportPattern = new RegExp(
            `\\b(?:${RETIRED_TRANSPORT_IDENTIFIERS.join('|')})\\b`
        );
        const retiredPlatformHandlerPattern = new RegExp(
            `\\b(?:${RETIRED_PLATFORM_HANDLER_IDENTIFIERS.join('|')})\\b`
        );
        const findings = [];

        for (const file of productionFiles) {
            const source = readFileSync(file, 'utf8');
            for (const [label, pattern] of [
                ['catalog member', catalogMemberPattern],
                ['wire literal', retiredLiteralPattern],
                ['transport identifier', retiredTransportPattern],
                ['platform handler', retiredPlatformHandlerPattern],
            ]) {
                if (pattern.test(source)) {
                    findings.push(
                        `${relative(process.cwd(), file)}: retired ${label}`
                    );
                }
            }
        }

        expect(findings).toEqual([]);
    });

    test('has no production import or export of the deleted readiness hook', () => {
        const findings = productionFiles.filter((file) =>
            /\buseBackgroundReady\b/.test(readFileSync(file, 'utf8'))
        );

        expect(findings).toEqual([]);
    });

    test('excludes explicit negative-test fixtures from production scanning', () => {
        const fixturePath = 'sidepanel/sidepanel.test.jsx';
        const fixtureSource = readFileSync(fixturePath, 'utf8');

        expect(isProductionJavaScript(fixturePath)).toBe(false);
        expect(fixtureSource).toContain("action: 'bindingChanged'");
        expect(productionFiles).not.toContain(fixturePath);
    });
});
