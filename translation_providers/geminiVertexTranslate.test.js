import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import { translate } from './geminiVertexTranslate.js';

const CONFIG = {
    vertexAccessToken: 'test-token',
    vertexProjectId: 'test-project',
    vertexLocation: 'us-central1',
    vertexModel: 'publishers/google/models/gemini-2.5-flash',
};

function successfulResponse(text = ' Hola ') {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text }] } }],
        }),
    };
}

function logs() {
    return ['debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

describe('Vertex Gemini translation', () => {
    let readConfig;

    beforeEach(() => {
        readConfig = jest
            .spyOn(configService, 'readMultipleResultStrict')
            .mockResolvedValue({ values: { ...CONFIG } });
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.fetch;
    });

    it('builds a Vertex request from the strict configuration projection', async () => {
        fetch.mockResolvedValue(successfulResponse());

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');

        expect(readConfig).toHaveBeenCalledWith(
            [
                'vertexAccessToken',
                'vertexProjectId',
                'vertexLocation',
                'vertexModel',
            ],
            { includeSensitive: true }
        );
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(
            'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent'
        );
        expect(init.headers.Authorization).toBe('Bearer test-token');
        expect(JSON.parse(init.body)).toMatchObject({
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: expect.stringContaining(
                                'Translate the following text from en to es'
                            ),
                        },
                    ],
                },
            ],
            generationConfig: { maxOutputTokens: 256 },
        });
    });

    it('short-circuits blank input', async () => {
        await expect(translate('   ', 'en', 'es')).resolves.toBe('');
        expect(readConfig).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a rejected read',
            () => readConfig.mockRejectedValue(new Error('secret')),
        ],
        [
            'a missing value',
            () =>
                readConfig.mockResolvedValue({
                    values: { ...CONFIG, vertexProjectId: '' },
                }),
        ],
    ])('fails closed for %s', async (_name, arrange) => {
        arrange();

        await expect(translate('Hello', 'en', 'es')).rejects.toMatchObject({
            message: 'Translation provider request failed.',
            provider: 'vertex_gemini',
            code: 'AUTHENTICATION_ERROR',
            retryable: false,
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(logs()).not.toContain('secret');
    });

    it('classifies network failures without exposing their details', async () => {
        fetch.mockRejectedValue(new TypeError('PRIVATE_NETWORK_DETAIL'));

        await expect(translate('Hello', 'en', 'es')).rejects.toMatchObject({
            message: 'Translation provider request failed.',
            provider: 'vertex_gemini',
            code: 'NETWORK_ERROR',
            retryable: true,
        });
        expect(logs()).not.toContain('PRIVATE_NETWORK_DETAIL');
    });

    it.each([
        [400, 'REQUEST_FAILED', false],
        [401, 'AUTHENTICATION_ERROR', false],
        [429, 'RATE_LIMIT_EXCEEDED', true],
        [503, 'UPSTREAM_ERROR', true],
    ])('classifies HTTP %s as %s', async (status, code, retryable) => {
        const readBody = jest.fn().mockRejectedValue(new Error('PRIVATE_BODY'));
        const response = {
            ok: false,
            status,
            json: readBody,
        };
        fetch.mockResolvedValue(response);

        await expect(translate('Hello', 'en', 'es')).rejects.toMatchObject({
            provider: 'vertex_gemini',
            status,
            code,
            retryable,
        });
        expect(readBody).not.toHaveBeenCalled();
        expect(logs()).not.toContain('PRIVATE_BODY');
    });

    it.each([
        ['missing candidates', { candidates: [] }],
        [
            'empty text',
            { candidates: [{ content: { parts: [{ text: '   ' }] } }] },
        ],
    ])('rejects a malformed response with %s', async (_name, payload) => {
        fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue(payload),
        });

        await expect(translate('Hello', 'en', 'es')).rejects.toMatchObject({
            message: 'Translation provider request failed.',
            code: 'REQUEST_FAILED',
            retryable: false,
        });
    });
});
