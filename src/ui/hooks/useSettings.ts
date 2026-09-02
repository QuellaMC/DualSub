import { useCallback, useEffect, useRef, useState } from 'react';
import { configService, type SettingsChanges } from '@/config/service';
import type { SettingsKey, SettingsValues } from '@/config/schema';

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
    readonly status: SettingsStatus;
    readonly settings: SettingsProjection<K> | null;
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

/**
 * A UI surface's view of the settings it renders. Storage is the single
 * source of truth: reads are authoritative (a failed read blocks the
 * surface rather than showing defaults), successful writes and storage
 * change events both flow into the same local projection, and an
 * unavailable surface retries on the next storage change.
 */
export function useSettings<K extends SettingsKey>(
    keys: readonly K[],
    options: { readonly includeSensitive?: boolean } = {}
): SettingsHandle<K> {
    const keyList = keys.join(' ');
    const includeSensitive = options.includeSensitive === true;
    const [state, setState] = useState<SettingsState<K>>({
        status: 'loading',
        settings: null,
    });
    const stateRef = useRef(state);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        const watched = keyList.split(' ') as K[];
        let active = true;

        const load = async (): Promise<void> => {
            let next: SettingsState<K>;
            try {
                const { values } = await configService.readMultipleResultStrict(
                    watched,
                    { includeSensitive }
                );
                next = {
                    status: 'ready',
                    settings: values as SettingsProjection<K>,
                };
            } catch {
                next = { status: 'unavailable', settings: null };
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
                if (stateRef.current.status === 'unavailable') {
                    void load();
                    return;
                }
                const relevant = pickWatched(changes, watched);
                if (Object.keys(relevant).length === 0) {
                    return;
                }
                setState((previous) =>
                    previous.settings
                        ? {
                              status: 'ready',
                              settings: { ...previous.settings, ...relevant },
                          }
                        : previous
                );
            },
            { includeSensitive }
        );
        void load();

        return () => {
            active = false;
            unsubscribe();
        };
    }, [keyList, includeSensitive]);

    const save = useCallback(
        async (changes: Partial<SettingsProjection<K>>): Promise<void> => {
            const written = await configService.setMultiple(changes);
            const relevant = pickWatched(written, keyList.split(' ') as K[]);
            setState((previous) =>
                previous.settings
                    ? {
                          status: 'ready',
                          settings: { ...previous.settings, ...relevant },
                      }
                    : previous
            );
        },
        [keyList]
    );

    return { status: state.status, settings: state.settings, save };
}
