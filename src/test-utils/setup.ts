import { configure } from '@testing-library/dom';

// CI runners share cores across the whole suite; a React update that lands
// in milliseconds locally can wait longer than the library's one-second
// default there. One margin for every UI test instead of per-test bumps.
configure({ asyncUtilTimeout: 2500 });

// happy-dom's navigator has no LockManager, which Chrome and Node provide;
// UI tests get the same exclusive, first-come locks.
if (typeof navigator !== 'undefined' && !navigator.locks) {
    const queues = new Map<string, Promise<unknown>>();
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
            request(name: string, callback: () => unknown): Promise<unknown> {
                const result = (queues.get(name) ?? Promise.resolve()).then(
                    () => callback()
                );
                queues.set(
                    name,
                    result.catch(() => undefined)
                );
                return result;
            },
        },
    });
}
