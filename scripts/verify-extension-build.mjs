import { readdir, readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const distDir = resolve(rootDir, 'dist');
const requiredApiHosts = [
    'https://*.media.dssott.com/*',
    'https://*.nflxvideo.net/*',
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
];
const allowedOptionalHosts = [
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
];

function normalizeExtensionPath(filePath) {
    return posix.normalize(filePath.replace(/^\//, '').split(/[?#]/, 1)[0]);
}

async function listFiles(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = [];

    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            paths.push(
                ...(await listFiles(
                    resolve(directory, entry.name),
                    relativePath
                ))
            );
        } else if (entry.isFile()) {
            paths.push(relativePath);
        }
    }

    return paths;
}

function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}

function collectManifestPaths(manifest) {
    const paths = [];
    const add = (value, label) => {
        if (typeof value === 'string') {
            paths.push({ label, path: normalizeExtensionPath(value) });
        }
    };
    const addObjectValues = (value, label) => {
        for (const [key, filePath] of Object.entries(value ?? {})) {
            add(filePath, `${label}.${key}`);
        }
    };

    add(manifest.background?.service_worker, 'background.service_worker');
    add(manifest.action?.default_popup, 'action.default_popup');
    addObjectValues(manifest.action?.default_icon, 'action.default_icon');
    add(manifest.options_ui?.page, 'options_ui.page');
    add(manifest.side_panel?.default_path, 'side_panel.default_path');
    addObjectValues(manifest.icons, 'icons');

    for (const [index, contentScript] of (
        manifest.content_scripts ?? []
    ).entries()) {
        for (const filePath of contentScript.js ?? []) {
            add(filePath, `content_scripts[${index}].js`);
        }
        for (const filePath of contentScript.css ?? []) {
            add(filePath, `content_scripts[${index}].css`);
        }
    }

    for (const [index, resourceGroup] of (
        manifest.web_accessible_resources ?? []
    ).entries()) {
        for (const filePath of resourceGroup.resources ?? []) {
            add(filePath, `web_accessible_resources[${index}]`);
        }
    }

    return paths;
}

function collectHtmlReferences(html, htmlPath) {
    const references = [];
    const attributePattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;

    for (const match of html.matchAll(attributePattern)) {
        const reference = match[1];
        if (
            reference.startsWith('#') ||
            reference.startsWith('//') ||
            /^(?:data|https?):/i.test(reference)
        ) {
            continue;
        }

        const referencedPath = reference.startsWith('/')
            ? normalizeExtensionPath(reference)
            : normalizeExtensionPath(posix.join(dirname(htmlPath), reference));
        references.push(referencedPath);
    }

    return references;
}

function collectRemoteAssetReferences(source) {
    const references = [];
    const remotePattern = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
    for (const match of source.matchAll(remotePattern)) {
        references.push(match[1]);
    }
    return references;
}

async function main() {
    const [manifestSource, packageSource, filePaths] = await Promise.all([
        readFile(resolve(distDir, 'manifest.json'), 'utf8'),
        readFile(resolve(rootDir, 'package.json'), 'utf8'),
        listFiles(distDir),
    ]);
    const manifest = JSON.parse(manifestSource);
    const packageJson = JSON.parse(packageSource);
    const files = new Set(filePaths);
    const errors = [];

    if (manifest.version !== packageJson.version) {
        errors.push(
            `Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`
        );
    }

    for (const host of requiredApiHosts) {
        if (!manifest.host_permissions?.includes(host)) {
            errors.push(
                `Required provider host permission is missing: ${host}`
            );
        }
    }
    for (const host of allowedOptionalHosts) {
        if (!manifest.optional_host_permissions?.includes(host)) {
            errors.push(
                `Optional provider host permission is missing: ${host}`
            );
        }
    }

    for (const { label, path } of collectManifestPaths(manifest)) {
        if (path.includes('*')) {
            const matcher = globToRegExp(path);
            if (![...files].some((filePath) => matcher.test(filePath))) {
                errors.push(`${label} does not match a built file: ${path}`);
            }
        } else if (!files.has(path)) {
            errors.push(`${label} references a missing built file: ${path}`);
        }
    }

    for (const htmlPath of [...files].filter((filePath) =>
        filePath.endsWith('.html')
    )) {
        const html = await readFile(resolve(distDir, htmlPath), 'utf8');
        for (const reference of collectRemoteAssetReferences(html)) {
            errors.push(
                `${htmlPath} loads a remote asset forbidden by Manifest V3: ${reference}`
            );
        }
        for (const reference of collectHtmlReferences(html, htmlPath)) {
            if (!files.has(reference)) {
                errors.push(
                    `${htmlPath} references a missing asset: ${reference}`
                );
            }
        }
    }

    for (const cssPath of [...files].filter((filePath) =>
        filePath.endsWith('.css')
    )) {
        const css = await readFile(resolve(distDir, cssPath), 'utf8');
        if (/https?:\/\//i.test(css)) {
            errors.push(
                `${cssPath} contains a remote URL forbidden by Manifest V3`
            );
        }
    }

    const developmentArtifacts = [...files].filter((filePath) => {
        const pathSegments = filePath.split('/');
        const fileName = pathSegments.at(-1);
        return (
            pathSegments.includes('tests') ||
            pathSegments.includes('__tests__') ||
            /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(fileName) ||
            /^test-.*\.[cm]?js$/i.test(fileName) ||
            /\.(?:md|map)$/i.test(fileName)
        );
    });
    for (const filePath of developmentArtifacts) {
        errors.push(`Development artifact was packaged: ${filePath}`);
    }

    if (errors.length > 0) {
        console.error('Extension build verification failed:');
        for (const error of errors) {
            console.error(`- ${error}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log(
        `Verified ${files.size} production files for extension ${manifest.version}.`
    );
}

main().catch((error) => {
    console.error('Extension build verification failed:', error);
    process.exitCode = 1;
});
