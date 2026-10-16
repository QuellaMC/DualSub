import { useCallback, useEffect, useState } from 'react';
import { hasHostPermission } from '@/shared/hostPermissions';

/** Whether DualSub may reach `baseUrl`'s host: null while that is checked.
 *  `recheck` reads it again, for after a permission prompt is answered. */
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
    return {
        permitted: state?.baseUrl === baseUrl ? state.permitted : null,
        recheck,
    };
}
