import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

type Catalog = Readonly<Record<string, { readonly message: string }>>;

const FALLBACK_LOCALE = 'en';
const catalogs = new Map<string, Promise<Catalog>>();

function catalogUrl(locale: string): string {
    return new URL(
        `_locales/${locale.replace('-', '_')}/messages.json`,
        browser.runtime.getURL('/')
    ).href;
}

async function fetchCatalog(locale: string): Promise<Catalog> {
    const response = await fetch(catalogUrl(locale));
    if (!response.ok) {
        throw new Error(`Locale catalog ${locale} returned ${response.status}`);
    }
    return (await response.json()) as Catalog;
}

/** The catalog for `locale`, or English when it cannot be loaded. A failed
 *  locale is not remembered, so a later mount retries it. */
export function loadCatalog(locale: string): Promise<Catalog> {
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
 * `ready` says whether the current locale's catalog is in place.
 */
export function useI18n(locale: string | null): {
    readonly t: Translate;
    readonly ready: boolean;
} {
    const [loaded, setLoaded] = useState<{
        locale: string;
        catalog: Catalog;
    } | null>(null);

    useEffect(() => {
        if (locale === null) {
            return;
        }
        let active = true;
        loadCatalog(locale)
            .then((catalog) => {
                if (active) {
                    setLoaded({ locale, catalog });
                }
            })
            .catch(() => {
                if (active) {
                    setLoaded({ locale, catalog: {} });
                }
            });
        return () => {
            active = false;
        };
    }, [locale]);

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

    return { t, ready: loaded !== null && loaded.locale === locale };
}
