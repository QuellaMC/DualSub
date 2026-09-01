import { browser } from 'wxt/browser';

export type TranslationFailureKind = 'api' | 'request';

const MESSAGE_KEYS = {
    api: 'translationApiError',
    request: 'translationRequestError',
} as const satisfies Record<TranslationFailureKind, string>;

/** Localized placeholder painted where a translation will not arrive. */
export function translationFailureText(kind: TranslationFailureKind): string {
    try {
        const message = browser.i18n.getMessage(MESSAGE_KEYS[kind]);
        if (message !== '') {
            return message;
        }
    } catch {
        // No i18n catalog in this runtime; fall through to the constant.
    }
    return '[Translation Error]';
}
