import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    LOG_LEVELS,
    createLogger,
    redactSensitiveData,
    redactSensitiveText,
    setLoggingLevel,
} from './logger';

// Behavioral replacement for the legacy source-grep privacy test: assert what
// actually reaches the console, not what the source looks like.
describe('redactSensitiveText', () => {
    it('redacts key=value and key: value credential patterns', () => {
        expect(redactSensitiveText('api_key=sk-12345 rest')).toContain(
            'api_key=[REDACTED]'
        );
        expect(redactSensitiveText('apiKey: "sk-12345"')).toBe(
            'apiKey: [REDACTED]'
        );
        expect(redactSensitiveText("password = 'hunter2';")).toContain(
            'password = [REDACTED]'
        );
    });

    it('redacts bearer tokens', () => {
        expect(redactSensitiveText('sent Bearer abc.def.ghi today')).toBe(
            'sent Bearer [REDACTED] today'
        );
        const header = redactSensitiveText('Authorization: Bearer abc.def.ghi');
        expect(header).not.toContain('abc.def.ghi');
        expect(header).toContain('[REDACTED]');
    });

    it('redacts PEM private key blocks', () => {
        const pem =
            '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
        expect(redactSensitiveText(`before ${pem} after`)).toBe(
            'before [REDACTED] after'
        );
    });

    it('redacts URL query strings and fragments, keeping origin and path', () => {
        expect(
            redactSensitiveText(
                'see https://api.example.com/v1/x?token=abc#frag'
            )
        ).toBe('see https://api.example.com/v1/x?[REDACTED]#[REDACTED]');
        expect(redactSensitiveText('see https://api.example.com/v1/x')).toBe(
            'see https://api.example.com/v1/x'
        );
    });
});

describe('redactSensitiveData', () => {
    it('redacts sensitive object keys by name fragment', () => {
        expect(
            redactSensitiveData({
                deeplApiKey: 'sk-123',
                vertex_access_token: 'ya29',
                serviceAccount: '{...}',
                harmless: 'ok',
            })
        ).toEqual({
            deeplApiKey: '[REDACTED]',
            vertex_access_token: '[REDACTED]',
            serviceAccount: '[REDACTED]',
            harmless: 'ok',
        });
    });

    it('handles circular structures', () => {
        const node: Record<string, unknown> = { name: 'a' };
        node.self = node;
        expect(redactSensitiveData(node)).toEqual({
            name: 'a',
            self: '[Circular]',
        });
    });

    it('redacts inside Error message, stack, and extra fields', () => {
        const error = new Error('failed: api_key=sk-999') as Error & {
            requestToken?: string;
        };
        error.requestToken = 'should-hide';
        const redacted = redactSensitiveData(error) as Record<string, unknown>;
        expect(redacted.message).toBe('failed: api_key=[REDACTED]');
        expect(typeof redacted.stack).toBe('string');
        expect(redacted.requestToken).toBe('should-hide');
        const withSensitiveField = new Error('x') as Error & {
            accessToken?: string;
        };
        withSensitiveField.accessToken = 'ya29';
        expect(
            (redactSensitiveData(withSensitiveField) as Record<string, unknown>)
                .accessToken
        ).toBe('[REDACTED]');
    });

    it('stringifies exotic primitives and functions', () => {
        expect(redactSensitiveData(10n)).toBe('10');
        expect(redactSensitiveData(function namedFn() {})).toBe(
            '[Function namedFn]'
        );
    });
});

describe('createLogger', () => {
    afterEach(() => {
        setLoggingLevel(LOG_LEVELS.INFO);
        vi.restoreAllMocks();
    });

    it('respects the level gate, including OFF', () => {
        const debugSpy = vi
            .spyOn(console, 'debug')
            .mockImplementation(() => undefined);
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const logger = createLogger('Test');

        setLoggingLevel(LOG_LEVELS.INFO);
        logger.debug('hidden');
        expect(debugSpy).not.toHaveBeenCalled();

        setLoggingLevel(LOG_LEVELS.OFF);
        logger.error('also hidden');
        expect(errorSpy).not.toHaveBeenCalled();

        setLoggingLevel(LOG_LEVELS.DEBUG);
        logger.debug('visible');
        expect(debugSpy).toHaveBeenCalledOnce();
    });

    it('never lets a credential reach the console', () => {
        const infoSpy = vi
            .spyOn(console, 'info')
            .mockImplementation(() => undefined);
        createLogger('Test').info('saving key', { openaiApiKey: 'sk-secret' });
        const output = infoSpy.mock.calls[0]?.[0] as string;
        expect(output).not.toContain('sk-secret');
        expect(output).toContain('[REDACTED]');
    });

    it('treats a plain-object second argument to error() as context', () => {
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        createLogger('Test').error('boom', { videoId: 'v1' });
        const output = errorSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('"videoId":"v1"');
        expect(output).not.toContain('errorMessage');
    });
});
