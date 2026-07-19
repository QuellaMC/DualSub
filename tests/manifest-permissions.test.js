import fs from 'node:fs';

const manifest = JSON.parse(
    fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
);

describe('Manifest runtime host permissions', () => {
    test('allows service-worker subtitle fetches from supported streaming CDNs', () => {
        expect(manifest.host_permissions).toEqual(
            expect.arrayContaining([
                'https://*.media.dssott.com/*',
                'https://*.dssedge.com/*',
                'https://*.nflxvideo.net/*',
            ])
        );
        expect(
            manifest.host_permissions.filter((permission) =>
                permission.includes('dssedge.com')
            )
        ).toEqual(['https://*.dssedge.com/*']);
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

    test('exposes the shared injection channel without adding another host grant', () => {
        const resources = manifest.web_accessible_resources.flatMap(
            (entry) => entry.resources
        );
        expect(resources).toContain(
            'content_scripts/shared/injectionChannel.js'
        );
        expect(manifest.host_permissions).not.toContain('https://*/*');
    });
});
