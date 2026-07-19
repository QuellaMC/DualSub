import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';
import { MessageHandler } from '../background/handlers/messageHandler.js';
import {
    Providers,
    ProviderBatchConfigs,
} from '../content_scripts/shared/constants/providers.js';

// Minimal tests for validator and batch sizing

describe('MessageHandler.validateMessagePayload', () => {
    test('valid translate', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.TRANSLATE,
            text: 'hi',
            targetLang: 'zh-CN',
        });
        expect(result.valid).toBe(true);
    });

    test('invalid translate missing fields', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.TRANSLATE,
            text: 'hi',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/targetLang/);
    });

    test('valid translateBatch', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.TRANSLATE_BATCH,
            texts: ['a', 'b'],
            targetLang: 'es',
        });
        expect(result.valid).toBe(true);
    });

    test('invalid translateBatch missing texts', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.TRANSLATE_BATCH,
            targetLang: 'es',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/texts/);
    });

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

    test('invalid fetchVTT missing payload', () => {
        const result = MessageHandler.validateMessagePayload({
            action: MessageActions.FETCH_VTT,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/url|tracks/);
    });
});

describe('ProviderBatchConfigs', () => {
    test('only declares providers with a real multi-text request', () => {
        expect(Object.keys(ProviderBatchConfigs)).toEqual([
            Providers.OPENAI_COMPATIBLE,
            Providers.VERTEX_GEMINI,
        ]);
        expect(Object.keys(Providers)).toEqual([
            'GOOGLE',
            'MICROSOFT_EDGE_AUTH',
            'DEEPL',
            'OPENAI_COMPATIBLE',
            'VERTEX_GEMINI',
        ]);
    });

    test('openai_compatible has delimiter and maxBatchSize', () => {
        const cfg = ProviderBatchConfigs[Providers.OPENAI_COMPATIBLE];
        expect(typeof cfg.delimiter).toBe('string');
        expect(cfg.maxBatchSize).toBeGreaterThan(0);
    });
});
