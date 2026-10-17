import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { hasHostPermission } from '@/shared/hostPermissions';

/** Whether DualSub may reach `baseUrl`'s host: null while that is checked.
 *  It is read again when access changes anywhere (another tab, the
 *  browser's extension controls); `recheck` reads it again, for after a
 *  permission prompt is answered. */
export function useHostPermission(baseUrl: string): {
    readonly permitted: boolean | null;
    readonly recheck: () => void;
} {
    const [state, setState] = useState<{
        baseUrl: string;
        permitted: boolean;
    } | null>(null);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let active = true;
        hasHostPermission(baseUrl).then(
            (permitted) => {
                if (active) {
                    setState({ baseUrl, permitted });
                }
            },
            () => {
                if (active) {
                    setState({ baseUrl, permitted: false });
                }
            }
        );
        return () => {
            active = false;
        };
    }, [baseUrl, revision]);

    const recheck = useCallback(() => setRevision((count) => count + 1), []);

    useEffect(() => {
        browser.permissions.onAdded.addListener(recheck);
        browser.permissions.onRemoved.addListener(recheck);
        return () => {
            browser.permissions.onAdded.removeListener(recheck);
            browser.permissions.onRemoved.removeListener(recheck);
        };
    }, [recheck]);
    return {
        permitted: state?.baseUrl === baseUrl ? state.permitted : null,
        recheck,
    };
}
