import fs from 'node:fs';

const manifest = JSON.parse(
    fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
);

describe('Manifest runtime host permissions', () => {
    test('allows service-worker subtitle fetches from supported streaming CDNs', () => {
        expect(manifest.host_permissions).toEqual(
            expect.arrayContaining([
                'https://*.media.dssott.com/*',
                'https://*.nflxvideo.net/*',
            ])
        );
    });

    test('keeps custom provider access optional and user-scoped', () => {
        expect(manifest.optional_host_permissions).toEqual(
            expect.arrayContaining([
                'https://*/*',
                'http://localhost/*',
                'http://127.0.0.1/*',
            ])
        );
    });
});
