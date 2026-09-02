import { browser } from 'wxt/browser';

export type OverlayTextKey =
    'translationApiError' | 'translationRequestError' | 'subtitleLoading';

/** Localized text painted into the overlay; the key itself when this
 *  runtime has no catalog. */
export function overlayText(key: OverlayTextKey): string {
    try {
        const message = browser.i18n.getMessage(key);
        if (message !== '') {
            return message;
        }
    } catch {
        // No i18n catalog in this runtime; fall through to the key.
    }
    return key;
}
