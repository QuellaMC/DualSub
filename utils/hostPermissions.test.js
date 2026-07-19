import { jest } from '@jest/globals';
import {
    hasHostPermission,
    requestHostPermission,
    toHostPermissionPattern,
} from './hostPermissions.js';

describe('hostPermissions', () => {
    beforeEach(() => {
        chrome.permissions = {
            contains: jest.fn().mockResolvedValue(false),
            request: jest.fn().mockResolvedValue(true),
        };
    });

    afterEach(() => {
        delete chrome.permissions;
    });

    it('normalizes custom URLs to an exact HTTPS host pattern', () => {
        expect(
            toHostPermissionPattern('https://models.example.test:8443/v1')
        ).toBe('https://models.example.test/*');
    });

    it.each([
        'http://models.example.test/v1',
        'ftp://models.example.test/v1',
        'https://user:secret@models.example.test/v1',
        'not a URL',
    ])('rejects unsafe provider URL %s', (baseUrl) => {
        expect(() => toHostPermissionPattern(baseUrl)).toThrow();
    });

    it.each(['http://localhost:11434/v1', 'http://127.0.0.1:8080/v1'])(
        'allows an explicit loopback development endpoint %s',
        (baseUrl) => {
            expect(toHostPermissionPattern(baseUrl)).toMatch(
                /^http:\/\/(?:localhost|127\.0\.0\.1)\/\*$/
            );
        }
    );

    it.each([
        'https://api.openai.com/v1',
        'https://generativelanguage.googleapis.com/v1beta/openai',
    ])('recognizes required API host %s without prompting', async (baseUrl) => {
        await expect(hasHostPermission(baseUrl)).resolves.toBe(true);
        await expect(requestHostPermission(baseUrl)).resolves.toBe(true);
        expect(chrome.permissions.contains).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    it('checks and requests only the selected custom origin', async () => {
        const baseUrl = 'https://models.example.test/v1';

        await expect(hasHostPermission(baseUrl)).resolves.toBe(false);
        await expect(requestHostPermission(baseUrl)).resolves.toBe(true);

        const expected = { origins: ['https://models.example.test/*'] };
        expect(chrome.permissions.contains).toHaveBeenCalledWith(expected);
        expect(chrome.permissions.request).toHaveBeenCalledWith(expected);
    });
});
