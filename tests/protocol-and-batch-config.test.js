import { readFileSync } from 'node:fs';
import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';
import { MessageHandler } from '../background/handlers/messageHandler.js';

describe('MessageActions catalog', () => {
    test('publishes the exact immutable cross-context wire contract', () => {
        expect(MessageActions).toEqual({
            TRANSLATE: 'translate',
            FETCH_VTT: 'fetchVTT',
            ANALYZE_CONTEXT: 'analyzeContext',
            PING: 'ping',
            CHECK_BACKGROUND_READY: 'checkBackgroundReady',
            CONFIG_CHANGED: 'configChanged',
            LOGGING_LEVEL_CHANGED: 'LOGGING_LEVEL_CHANGED',
            SIDEPANEL_WORD_SELECTED: 'sidePanelWordSelected',
            SIDEPANEL_PAUSE_VIDEO: 'sidePanelPauseVideo',
            SIDEPANEL_GET_STATE: 'sidePanelGetState',
            SIDEPANEL_UPDATE_STATE: 'sidePanelUpdateState',
            SIDEPANEL_REGISTER: 'sidePanelRegister',
            SIDEPANEL_SELECTION_SYNC: 'sidePanelSelectionSync',
            SIDEPANEL_TAB_ACTIVATED: 'tabActivated',
            SIDEPANEL_FORCE_BIND_TAB: 'sidePanelForceBindTab',
            SIDEPANEL_BINDING_CONFIRMED: 'sidePanelBindingConfirmed',
        });
        expect(Object.isFrozen(MessageActions)).toBe(true);
    });

    test('assigns one unique wire value to every action', () => {
        const values = Object.values(MessageActions);
        expect(new Set(values).size).toBe(values.length);
    });

    test('owned production modules use the catalog instead of raw wire literals', () => {
        const productionFiles = [
            'sidepanel/hooks/useSidePanelCommunication.js',
            'sidepanel/hooks/SidePanelContext.jsx',
            'sidepanel/hooks/useAIAnalysis.js',
            'sidepanel/hooks/useWordSelection.js',
            'background/services/sidePanelService.js',
            'content_scripts/aicontext/providers/AIContextProvider.js',
            'content_scripts/shared/protocol/messageProtocol.js',
        ];
        const catalogOnlyValues = [
            'analyzeContext',
            'ping',
            'sidePanelRegister',
            'sidePanelBindingConfirmed',
            'sidePanelUpdateState',
            'sidePanelSelectionSync',
            'tabActivated',
            'sidePanelForceBindTab',
        ];

        for (const file of productionFiles) {
            const source = readFileSync(file, 'utf8');
            for (const value of catalogOnlyValues) {
                for (const quote of ["'", '"', '`']) {
                    expect(source).not.toContain(`${quote}${value}${quote}`);
                }
            }
        }
    });
});

// Minimal tests for validator and batch sizing

describe('MessageHandler.validateMessagePayload', () => {
    test('valid translate', () => {
        const message = {
            action: MessageActions.TRANSLATE,
            text: 'hi',
            targetLang: 'zh-CN',
            cueStart: 12.5,
            cueVideoId: 'video-1',
        };
        const result = MessageHandler.validateMessagePayload(message);

        expect(result).toEqual({
            valid: true,
            action: MessageActions.TRANSLATE,
            request: message,
        });
        expect(result.request).not.toBe(message);
        expect(Object.isFrozen(result.request)).toBe(true);
    });

    test('rejects an inexact translate record', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.TRANSLATE,
            text: 'hi',
            targetLang: 'zh-CN',
            cueStart: 12.5,
            cueVideoId: 'video-1',
            extra: true,
        });

        expect(result).toEqual({
            valid: false,
            error: 'Invalid translation request',
        });
    });

    test.each(['translateBatch', 'checkBatchSupport'])(
        'legacy literal action %s is unsupported and cannot reach the translation service',
        (action) => {
            let serviceAccessCount = 0;
            let responseCount = 0;
            const translationService = new Proxy(Object.create(null), {
                get() {
                    serviceAccessCount++;
                    throw new Error('Legacy batch action reached the service');
                },
            });
            const handler = new MessageHandler();
            handler.logger = {
                debug() {},
                warn() {},
            };
            handler.setServices({ translationService });

            expect(Object.values(MessageActions)).not.toContain(action);
            expect(
                handler.handleMessage({ action }, {}, () => {
                    responseCount++;
                })
            ).toBe(false);
            expect(serviceAccessCount).toBe(0);
            expect(responseCount).toBe(0);
        }
    );

    test('valid fetchVTT via url', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.FETCH_VTT,
            url: 'https://example.com/subs.vtt',
        });
        expect(result.valid).toBe(true);
    });

    test('valid fetchVTT via data.tracks', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.FETCH_VTT,
            data: { tracks: [] },
        });
        expect(result.valid).toBe(true);
    });

    test('defers fetchVTT payload validation without traversing hostile fields', () => {
        let payloadAccessCount = 0;
        const message = { action: MessageActions.FETCH_VTT };
        for (const key of ['url', 'data', 'tracks']) {
            Object.defineProperty(message, key, {
                get() {
                    payloadAccessCount++;
                    throw new Error(`generic validation read ${key}`);
                },
            });
        }

        expect(MessageHandler.validateMessagePayload(message)).toEqual({
            valid: true,
            action: MessageActions.FETCH_VTT,
        });
        expect(payloadAccessCount).toBe(0);
    });
});
