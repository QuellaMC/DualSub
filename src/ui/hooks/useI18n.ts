import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

type Catalog = Readonly<Record<string, { readonly message: string }>>;

interface LoadedCatalog {
    /** The locale the catalog is in: the one asked for, or English. */
    readonly locale: string;
    readonly catalog: Catalog;
}

const FALLBACK_LOCALE = 'en';
const catalogs = new Map<string, Promise<LoadedCatalog>>();

function catalogUrl(locale: string): string {
    return new URL(
        `_locales/${locale.replace('-', '_')}/messages.json`,
        browser.runtime.getURL('/')
    ).href;
}

async function fetchCatalog(locale: string): Promise<LoadedCatalog> {
    const response = await fetch(catalogUrl(locale));
    if (!response.ok) {
        throw new Error(`Locale catalog ${locale} returned ${response.status}`);
    }
    return { locale, catalog: (await response.json()) as Catalog };
}

/** The catalog for `locale`, or English's when it cannot be loaded. A
 *  failed locale is not remembered, so a later mount retries it. */
export function loadCatalog(locale: string): Promise<LoadedCatalog> {
    let pending = catalogs.get(locale);
    if (!pending) {
        pending = fetchCatalog(locale).catch((error: unknown) => {
            catalogs.delete(locale);
            if (locale === FALLBACK_LOCALE) {
                throw error;
            }
            return loadCatalog(FALLBACK_LOCALE);
        });
        catalogs.set(locale, pending);
    }
    return pending;
}

export function resetCatalogsForTests(): void {
    catalogs.clear();
}

export type Translate = (
    key: string,
    ...substitutions: readonly (string | number)[]
) => string;

/**
 * Extension-page i18n keyed by the user's chosen UI language rather than the
 * browser locale. `t` returns the key itself until a catalog is loaded, and
 * `ready` says whether the current locale's request has been answered. The
 * page declares the language of the catalog it shows, English included when
 * the chosen one could not load, which picks the right glyphs for Chinese
 * and Japanese text and the right voice for screen readers.
 */
export function useI18n(locale: string | null): {
    readonly t: Translate;
    /** The current locale's catalog, or its English stand-in, is in place. */
    readonly ready: boolean;
    /** The locale of the catalog in place (an older one's while a new one
     *  loads); null before any. */
    readonly loadedLocale: string | null;
} {
    const [loaded, setLoaded] = useState<
        (LoadedCatalog & { readonly requested: string }) | null
    >(null);

    useEffect(() => {
        if (locale === null) {
            return;
        }
        let active = true;
        loadCatalog(locale).then(
            (result) => {
                if (active) {
                    setLoaded({ ...result, requested: locale });
                }
            },
            () => {
                if (active) {
                    setLoaded({
                        requested: locale,
                        locale: FALLBACK_LOCALE,
                        catalog: {},
                    });
                }
            }
        );
        return () => {
            active = false;
        };
    }, [locale]);

    useEffect(() => {
        if (loaded) {
            document.documentElement.lang = loaded.locale;
        }
    }, [loaded]);

    const catalog = loaded?.catalog;
    const t = useCallback<Translate>(
        (key, ...substitutions) => {
            const message = catalog?.[key]?.message ?? key;
            if (substitutions.length === 0) {
                return message;
            }
            let index = 0;
            return message.replace(/%[sd]/g, (match) =>
                index < substitutions.length
                    ? String(substitutions[index++])
                    : match
            );
        },
        [catalog]
    );

    return {
        t,
        ready: loaded?.requested === locale,
        loadedLocale: loaded?.locale ?? null,
    };
}
