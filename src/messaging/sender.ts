import { browser } from 'wxt/browser';

export type SenderRole =
    'background' | 'content' | 'options' | 'popup' | 'sidepanel';

export type ContentPlatform = 'netflix' | 'disneyplus';

export interface ClassifiedExtensionSender {
    readonly role: Exclude<SenderRole, 'content'>;
}

export interface ClassifiedContentSender {
    readonly role: 'content';
    readonly platform: ContentPlatform;
    readonly tabId: number;
    readonly windowId: number;
    readonly documentId: string;
    readonly documentLifecycle: 'active';
    readonly origin: string;
    readonly senderUrl: string;
    readonly tabUrl: string;
    readonly frameId: 0;
}

export type ClassifiedSender =
    ClassifiedExtensionSender | ClassifiedContentSender;

const ABSENT_OWN_PROPERTY = Symbol('absent-own-property');
const INVALID_OWN_PROPERTY = Symbol('invalid-own-property');

function readOwnDataValue(
    record: unknown,
    key: string,
    required = true,
    requireEnumerable = false
): unknown {
    if (record === null || typeof record !== 'object') {
        return INVALID_OWN_PROPERTY;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return required ? INVALID_OWN_PROPERTY : ABSENT_OWN_PROPERTY;
    }
    if (
        !Object.hasOwn(descriptor, 'value') ||
        (requireEnumerable && descriptor.enumerable !== true)
    ) {
        return INVALID_OWN_PROPERTY;
    }
    return descriptor.value;
}

interface RuntimeEndpoints {
    backgroundUrl: string;
    extensionId: string;
    extensionOrigin: string;
    optionsUrl: string;
    popupUrl: string;
    sidepanelUrl: string;
}

interface RuntimeLike {
    id?: unknown;
    getManifest?: () => unknown;
    getURL?(path: string): string;
}

function readRuntimeEndpoints(runtime: RuntimeLike): RuntimeEndpoints | null {
    if (
        typeof runtime.id !== 'string' ||
        runtime.id.length === 0 ||
        typeof runtime.getManifest !== 'function' ||
        typeof runtime.getURL !== 'function'
    ) {
        return null;
    }

    const manifest = runtime.getManifest() as {
        background?: { service_worker?: unknown };
        options_ui?: { page?: unknown };
        action?: { default_popup?: unknown };
        side_panel?: { default_path?: unknown };
    } | null;
    const paths = {
        background: manifest?.background?.service_worker,
        options: manifest?.options_ui?.page,
        popup: manifest?.action?.default_popup,
        sidepanel: manifest?.side_panel?.default_path,
    };
    if (
        Object.values(paths).some(
            (path) => typeof path !== 'string' || path.length === 0
        )
    ) {
        return null;
    }

    return {
        backgroundUrl: runtime.getURL(paths.background as string),
        extensionId: runtime.id,
        extensionOrigin: runtime.getURL('').replace(/\/+$/u, ''),
        optionsUrl: runtime.getURL(paths.options as string),
        popupUrl: runtime.getURL(paths.popup as string),
        sidepanelUrl: runtime.getURL(paths.sidepanel as string),
    };
}

interface ParsedContentUrl {
    href: string;
    origin: string;
    platform: ContentPlatform;
}

function parseSupportedContentUrl(rawUrl: unknown): ParsedContentUrl | null {
    if (typeof rawUrl !== 'string') {
        return null;
    }
    const parsedUrl = new URL(rawUrl);
    if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        parsedUrl.hostname.endsWith('.')
    ) {
        return null;
    }

    let platform: ContentPlatform | null = null;
    if (
        parsedUrl.hostname === 'netflix.com' ||
        parsedUrl.hostname.endsWith('.netflix.com')
    ) {
        platform = 'netflix';
    } else if (
        parsedUrl.hostname === 'disneyplus.com' ||
        parsedUrl.hostname.endsWith('.disneyplus.com')
    ) {
        platform = 'disneyplus';
    }
    if (!platform) {
        return null;
    }
    return { href: parsedUrl.href, origin: parsedUrl.origin, platform };
}

/**
 * Authenticate a runtime MessageSender into a role. Fail-closed: anything
 * that is not provably one of this extension's contexts returns null.
 * Content senders must be the active top frame of a live document on a
 * supported https origin, with sender.url and tab.url agreeing on platform
 * and origin.
 *
 * JavaScript cannot distinguish a fully transparent Proxy from its target;
 * only known data descriptors are read, and throwing traps fail closed.
 */
export function classifyExtensionMessageSender(
    sender: unknown,
    runtime: RuntimeLike = browser.runtime
): ClassifiedSender | null {
    try {
        const endpoints = readRuntimeEndpoints(runtime);
        if (!endpoints) {
            return null;
        }

        const id = readOwnDataValue(sender, 'id');
        const url = readOwnDataValue(sender, 'url');
        const origin = readOwnDataValue(sender, 'origin', false);
        const tab = readOwnDataValue(sender, 'tab', false);
        if (
            id !== endpoints.extensionId ||
            typeof url !== 'string' ||
            origin === INVALID_OWN_PROPERTY ||
            tab === INVALID_OWN_PROPERTY
        ) {
            return null;
        }

        let role: Exclude<SenderRole, 'content'> | null = null;
        if (url === endpoints.backgroundUrl) {
            role = 'background';
        } else if (url === endpoints.sidepanelUrl) {
            role = 'sidepanel';
        } else if (url === endpoints.popupUrl) {
            role = 'popup';
        } else if (url === endpoints.optionsUrl) {
            role = 'options';
        }

        if (role === 'options') {
            // The options page opens in a tab, so a tab record is legitimate
            // there — but it must be the options page's own tab.
            if (
                origin !== ABSENT_OWN_PROPERTY &&
                origin !== null &&
                origin !== endpoints.extensionOrigin
            ) {
                return null;
            }
            if (tab !== ABSENT_OWN_PROPERTY && tab !== null) {
                const tabUrl = readOwnDataValue(tab, 'url');
                if (tabUrl !== endpoints.optionsUrl) {
                    return null;
                }
            }
        } else if (role) {
            if (
                (origin !== ABSENT_OWN_PROPERTY &&
                    origin !== null &&
                    origin !== endpoints.extensionOrigin) ||
                (tab !== ABSENT_OWN_PROPERTY && tab !== null)
            ) {
                return null;
            }
        }

        if (role) {
            return Object.freeze({ role });
        }

        if (tab === ABSENT_OWN_PROPERTY || tab === null) {
            return null;
        }

        const documentId = readOwnDataValue(sender, 'documentId');
        const documentLifecycle = readOwnDataValue(
            sender,
            'documentLifecycle',
            true,
            true
        );
        const frameId = readOwnDataValue(sender, 'frameId');
        const tabId = readOwnDataValue(tab, 'id');
        const windowId = readOwnDataValue(tab, 'windowId');
        const active = readOwnDataValue(tab, 'active');
        const tabUrl = readOwnDataValue(tab, 'url');
        if (
            typeof documentId !== 'string' ||
            documentId.length === 0 ||
            documentLifecycle !== 'active' ||
            frameId !== 0 ||
            !Number.isSafeInteger(tabId) ||
            (tabId as number) < 0 ||
            !Number.isSafeInteger(windowId) ||
            (windowId as number) < 0 ||
            active !== true
        ) {
            return null;
        }

        const parsedSenderUrl = parseSupportedContentUrl(url);
        const parsedTabUrl = parseSupportedContentUrl(tabUrl);
        if (
            !parsedSenderUrl ||
            !parsedTabUrl ||
            parsedSenderUrl.platform !== parsedTabUrl.platform ||
            parsedSenderUrl.origin !== parsedTabUrl.origin ||
            (origin !== ABSENT_OWN_PROPERTY &&
                origin !== null &&
                origin !== parsedSenderUrl.origin)
        ) {
            return null;
        }

        return Object.freeze({
            role: 'content',
            platform: parsedSenderUrl.platform,
            tabId: tabId as number,
            windowId: windowId as number,
            documentId,
            documentLifecycle: 'active',
            origin: parsedSenderUrl.origin,
            senderUrl: parsedSenderUrl.href,
            tabUrl: parsedTabUrl.href,
            frameId: 0,
        });
    } catch {
        return null;
    }
}
