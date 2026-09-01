import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import golden from './manifest.golden.json';

// Guards the shipped manifest against accidental drift: permissions, hosts,
// entrypoint wiring, and the absence of web_accessible_resources are all
// deliberate, reviewed facts. Update the golden file only in a commit whose
// message explains the manifest change. Requires `npm run build` first.
const builtManifestPath = fileURLToPath(
    new URL('../../.output/chrome-mv3/manifest.json', import.meta.url)
);

describe.skipIf(!existsSync(builtManifestPath))('built manifest', () => {
    it('matches the golden snapshot (ignoring version)', () => {
        const built = JSON.parse(
            readFileSync(builtManifestPath, 'utf8')
        ) as Record<string, unknown>;
        delete built.version;
        expect(built).toEqual(golden);
    });
});
