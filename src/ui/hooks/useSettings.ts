import { useCallback, useEffect, useState } from 'react';
import {
    configService,
    type SettingsChanges,
    type SiteWrite,
} from '@/config/service';
import type { SettingsKey, SettingsValues } from '@/config/schema';
import type { PlatformId } from '@/shared/platforms';

export type SettingsStatus = 'loading' | 'ready' | 'unavailable';

export type SettingsProjection<K extends SettingsKey> = Pick<SettingsValues, K>;

export interface SettingsHandle<K extends SettingsKey> {
    readonly status: SettingsStatus;
    /** The complete projection once ready; null while loading or unavailable. */
    readonly settings: SettingsProjection<K> | null;
    /** Persist one or more settings. Rejects when validation or storage
     *  fails; nothing is written in that case. */
    readonly save: (changes: Partial<SettingsProjection<K>>) => Promise<void>;
}

interface SettingsState<K extends SettingsKey> {
    /** What the settings were read for: the keys, credentials, and site. */
    readonly view: string;
    readonly status: SettingsStatus;
    readonly settings: SettingsProjection<K> | null;
}

/** `state` with `changes` on top, when it holds ready settings of `view`. */
function withChanges<K extends SettingsKey>(
    state: SettingsState<K>,
    view: string,
    changes: Partial<SettingsProjection<K>>
): SettingsState<K> {
    return state.view === view && state.settings
        ? { view, status: 'ready', settings: { ...state.settings, ...changes } }
        : state;
}

function pickWatched<K extends SettingsKey>(
    values: Partial<SettingsValues>,
    watched: readonly K[]
): Partial<SettingsProjection<K>> {
    const picked: Record<string, unknown> = {};
    for (const key of watched) {
        if (values[key] !== undefined) {
            picked[key] = values[key];
        }
    }
    return picked as Partial<SettingsProjection<K>>;
}

export interface SettingsOptions {
    readonly includeSensitive?: boolean;
    /** Show the settings as this site sees them, and write site settings
     *  where `siteTarget` says. */
    readonly site?: PlatformId | null;
    readonly siteTarget?: SiteWrite['target'];
}

/**
 * A UI surface's view of the settings it renders. Storage is the single
 * source of truth: reads are authoritative (a failed read blocks the
 * surface rather than showing defaults), successful writes and storage
 * change events both flow into the same local projection, and an
 * unavailable surface retries on the next storage change. Switching to
 * another view, such as another site, shows it loading until its own
 * settings arrive.
 */
export function useSettings<K extends SettingsKey>(
    keys: readonly K[],
    options: SettingsOptions = {}
): SettingsHandle<K> {
    const keyList = keys.join(' ');
    const includeSensitive = options.includeSensitive === true;
    const site = options.site ?? null;
    const siteTarget = options.siteTarget ?? 'source';
    const view = JSON.stringify([keyList, includeSensitive, site]);
    const [state, setState] = useState<SettingsState<K>>({
        view,
        status: 'loading',
        settings: null,
    });

    useEffect(() => {
        const watched = keyList.split(' ') as K[];
        const readOptions = { includeSensitive, ...(site ? { site } : {}) };
        let active = true;
        let unavailable = false;
        // Changes are newer than a read still in flight.
        const heard: Partial<SettingsProjection<K>> = {};

        const load = async (): Promise<void> => {
            let next: SettingsState<K>;
            try {
                const { values } = await configService.readMultipleResultStrict(
                    watched,
                    readOptions
                );
                unavailable = false;
                next = {
                    view,
                    status: 'ready',
                    settings: {
                        ...(values as SettingsProjection<K>),
                        ...heard,
                    },
                };
            } catch {
                unavailable = true;
                next = { view, status: 'unavailable', settings: null };
            }
            if (active) {
                setState(next);
            }
        };

        const unsubscribe = configService.onChanged(
            (changes: SettingsChanges) => {
                // Credential changes reach only surfaces that asked for them.
                if (!active) {
                    return;
                }
                if (unavailable) {
                    void load();
                    return;
                }
                const relevant = pickWatched(changes, watched);
                if (Object.keys(relevant).length === 0) {
                    return;
                }
                Object.assign(heard, relevant);
                setState((previous) => withChanges(previous, view, relevant));
            },
            readOptions
        );
        void load();

        return () => {
            active = false;
            unsubscribe();
        };
    }, [view, keyList, includeSensitive, site]);

    const save = useCallback(
        async (changes: Partial<SettingsProjection<K>>): Promise<void> => {
            const written = await configService.setMultiple(
                changes,
                site ? { site, target: siteTarget } : undefined
            );
            const relevant = pickWatched(written, keyList.split(' ') as K[]);
            setState((previous) => withChanges(previous, view, relevant));
        },
        [view, keyList, site, siteTarget]
    );

    return state.view === view
        ? { status: state.status, settings: state.settings, save }
        : { status: 'loading', settings: null, save };
}
