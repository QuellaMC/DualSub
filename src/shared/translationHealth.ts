import { browser } from 'wxt/browser';
import { z } from 'zod';
import { PROVIDER_IDS } from './providers';

const TRANSLATION_HEALTH_KEY = 'translationHealth';

const translationHealthSchema = z.strictObject({
    provider: z.enum(PROVIDER_IDS),
    problem: z.enum(['credentials', 'quota', 'rejected']),
    /** The provider that translated in its place last; null while none
     *  has, or when fallback is off. */
    fallback: z.enum(PROVIDER_IDS).nullable(),
    since: z.number().int().nonnegative(),
});

/** A lasting failure of the chosen provider: a rejected credential, a used
 *  up quota, or a refused request. */
export type TranslationHealth = z.infer<typeof translationHealthSchema>;

/** The failure the translation service last recorded, or null while the
 *  chosen provider works. Kept in session storage, so it outlives a worker
 *  restart and ends with the browser session. */
export async function readTranslationHealth(): Promise<TranslationHealth | null> {
    const items = await browser.storage.session.get(TRANSLATION_HEALTH_KEY);
    const parsed = translationHealthSchema.safeParse(
        items[TRANSLATION_HEALTH_KEY]
    );
    return parsed.success ? parsed.data : null;
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
