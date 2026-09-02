// Audits the packaged extension before it is published: the zip must hold
// exactly the built extension, nothing from the source tree, and a manifest
// whose version fields agree with package.json.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const OUTPUT_DIR = resolve('.output');
const BUILD_DIR = join(OUTPUT_DIR, 'chrome-mv3');
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_ENTRY =
    /(\.map$|\.test\.|(^|\/)node_modules\/|(^|\/)src\/|\.ts$|\.tsx$)/;

function fail(message) {
    console.error(`verify-release: ${message}`);
    process.exit(1);
}

function listBuildFiles(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            return entry.isDirectory() ? listBuildFiles(path, name) : [name];
        })
        .sort();
}

function listArchiveEntries(archive) {
    let output;
    try {
        output = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    } catch (error) {
        fail(
            `could not list ${relative(process.cwd(), archive)} (${error.message})`
        );
    }
    return output
        .split('\n')
        .filter((line) => line !== '' && !line.endsWith('/'))
        .sort();
}

function readArchiveManifest(archive) {
    try {
        return JSON.parse(
            execFileSync('unzip', ['-p', archive, 'manifest.json'], {
                encoding: 'utf8',
            })
        );
    } catch (error) {
        fail(`manifest.json in the archive is unreadable (${error.message})`);
    }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const archive = join(OUTPUT_DIR, `${pkg.name}-${pkg.version}-chrome.zip`);
let archiveSize;
try {
    archiveSize = statSync(archive).size;
} catch {
    fail(
        `${relative(process.cwd(), archive)} is missing; run "npm run zip" first`
    );
}
if (archiveSize > MAX_ARCHIVE_BYTES) {
    fail(
        `archive is ${archiveSize} bytes, above the ${MAX_ARCHIVE_BYTES} byte cap`
    );
}

const built = listBuildFiles(BUILD_DIR);
const entries = listArchiveEntries(archive);
if (JSON.stringify(entries) !== JSON.stringify(built)) {
    const missing = built.filter((file) => !entries.includes(file));
    const extra = entries.filter((file) => !built.includes(file));
    fail(
        `archive does not match the build (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`
    );
}
const forbidden = entries.filter((entry) => FORBIDDEN_ENTRY.test(entry));
if (forbidden.length > 0) {
    fail(`archive carries source-tree files: ${forbidden.join(', ')}`);
}

const manifest = readArchiveManifest(archive);
const [releaseVersion, prerelease] = pkg.version.split('-');
if (manifest.version !== releaseVersion) {
    fail(
        `manifest version ${manifest.version} does not match package version ${pkg.version}`
    );
}
if (prerelease && manifest.version_name !== pkg.version) {
    fail(
        `manifest version_name ${manifest.version_name} should be ${pkg.version}`
    );
}
if (!prerelease && manifest.version_name !== undefined) {
    fail(
        `a stable release must not carry version_name (${manifest.version_name})`
    );
}
if (
    manifest.default_locale !== 'en' ||
    !entries.includes('_locales/en/messages.json')
) {
    fail('the default locale catalog is missing from the archive');
}
if (manifest.web_accessible_resources !== undefined) {
    fail('the manifest exposes web_accessible_resources');
}

console.log(
    `verify-release: ${relative(process.cwd(), archive)} ok (${entries.length} files, ${archiveSize} bytes, manifest ${manifest.version}${prerelease ? ` / ${manifest.version_name}` : ''})`
);
