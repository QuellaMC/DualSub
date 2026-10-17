import { fakeBrowser } from 'wxt/testing/fake-browser';

type PermissionsListener = (permissions: { origins?: string[] }) => void;

/**
 * Give the fake browser the permission events it leaves unmocked, and
 * return a way to announce access granted or taken back elsewhere: in
 * another tab, or in the browser's extension controls.
 */
export function installPermissionEvents(): (
    change: 'added' | 'removed',
    origins: string[]
) => void {
    const listeners = {
        added: new Set<PermissionsListener>(),
        removed: new Set<PermissionsListener>(),
    };
    const event = (set: Set<PermissionsListener>) => ({
        addListener: (listener: PermissionsListener) => void set.add(listener),
        removeListener: (listener: PermissionsListener) =>
            void set.delete(listener),
        hasListener: (listener: PermissionsListener) => set.has(listener),
    });
    Object.assign(fakeBrowser.permissions, {
        onAdded: event(listeners.added),
        onRemoved: event(listeners.removed),
    });
    return (change, origins) => {
        for (const listener of listeners[change]) {
            listener({ origins });
        }
    };
}
