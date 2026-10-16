import { browser } from 'wxt/browser';
import { z } from 'zod';
import { PROVIDER_IDS } from './providers';

const TRANSLATION_HEALTH_KEY = 'translationHealth';

const translationHealthSchema = z.strictObject({
    provider: z.enum(PROVIDER_IDS),
    problem: z.enum(['credentials', 'quota', 'rejected']),
    /** The provider covering meanwhile; null when fallback is off. */
    fallback: z.enum(PROVIDER_IDS).nullable(),
    since: z.number().int().nonnegative(),
});

/** A lasting failure of the chosen provider: a rejected credential, a used
 *  up quota, or a refused request. */
export type TranslationHealth = z.infer<typeof translationHealthSchema>;

function toHealth(value: unknown): TranslationHealth | null {
    const parsed = translationHealthSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/** The failure the translation service last recorded, or null while the
 *  chosen provider works. Kept in session storage, so it outlives a worker
 *  restart and ends with the browser session. */
export async function readTranslationHealth(): Promise<TranslationHealth | null> {
    const items = await browser.storage.session.get(TRANSLATION_HEALTH_KEY);
    return toHealth(items[TRANSLATION_HEALTH_KEY]);
}

export async function writeTranslationHealth(
    health: TranslationHealth | null
): Promise<void> {
    if (health) {
        await browser.storage.session.set({ [TRANSLATION_HEALTH_KEY]: health });
    } else {
        await browser.storage.session.remove(TRANSLATION_HEALTH_KEY);
    }
}

/** Follow the recorded failure as the translation service updates it. */
export function onTranslationHealthChanged(
    callback: (health: TranslationHealth | null) => void
): () => void {
    const listener = (
        changes: Record<string, { newValue?: unknown }>,
        areaName: string
    ): void => {
        if (
            areaName === 'session' &&
            Object.hasOwn(changes, TRANSLATION_HEALTH_KEY)
        ) {
            callback(toHealth(changes[TRANSLATION_HEALTH_KEY]?.newValue));
        }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
}
