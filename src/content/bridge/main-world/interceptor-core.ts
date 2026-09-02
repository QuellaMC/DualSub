import {
    isHelloMessage,
    isIsolatedToMain,
    mainReadyEventName,
    type BridgePlatform,
    type CapturedEvent,
    type IsolatedToMain,
} from '../protocol';

// Runs in the page's own realm as a declarative MAIN-world content script.
// It shares globals with the site, so every later call uses a native captured
// at install time. A recipe that inspects JSON gets its JSON.parse patch
// installed synchronously at document_start — before any page script can
// parse a manifest.

export interface InterceptorRecipe {
    readonly platform: BridgePlatform;
    /** Inspect every JSON.parse result and emit anything worth capturing. */
    onParsed?(parsed: unknown, emit: (event: CapturedEvent) => void): void;
    /** Control messages from the isolated world (timeline polling, track
     *  resolution). */
    onControl?(
        message: IsolatedToMain,
        emit: (event: CapturedEvent) => void
    ): void;
    onClose?(): void;
}

const MAX_BUFFERED_EVENTS = 20;

export function installInterceptor(recipe: InterceptorRecipe): void {
    const flagKey = `__dualsubInterceptor_${recipe.platform}`;
    const nativeParse = JSON.parse;
    // Captured as values on purpose: they are invoked with .call on the
    // intended target, never as bare functions.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeDispatchEvent = EventTarget.prototype.dispatchEvent;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    const NativeCustomEvent = CustomEvent;

    const announceReady = (): void => {
        nativeDispatchEvent.call(
            document,
            new NativeCustomEvent(mainReadyEventName(recipe.platform))
        );
    };

    // Declarative injection runs once per document; a second execution only
    // re-announces so the isolated world can re-handshake.
    if (Object.getOwnPropertyDescriptor(window, flagKey)) {
        announceReady();
        return;
    }

    let port: MessagePort | null = null;
    const buffered: CapturedEvent[] = [];

    const emit = (event: CapturedEvent): void => {
        if (port) {
            try {
                port.postMessage(event);
            } catch {
                // A closed port drops the event; the isolated side re-hellos.
            }
            return;
        }
        buffered.push(event);
        if (buffered.length > MAX_BUFFERED_EVENTS) {
            buffered.shift();
        }
    };

    const onParsed = recipe.onParsed?.bind(recipe);
    if (onParsed) {
        JSON.parse = function (
            text: string,
            reviver?: (this: unknown, key: string, value: unknown) => unknown
        ) {
            const parsed: unknown = nativeParse.call(JSON, text, reviver);
            try {
                onParsed(parsed, emit);
            } catch {
                // Parsing must stay transparent even if inspection fails.
            }
            return parsed;
        } as typeof JSON.parse;
    }

    const adoptPort = (candidate: MessagePort, capability: string): void => {
        port?.close();
        port = candidate;
        candidate.onmessage = (event: MessageEvent<unknown>) => {
            const message = event.data;
            if (!isIsolatedToMain(message)) {
                return;
            }
            if (message.t === 'close') {
                if (port === candidate) {
                    port = null;
                }
                candidate.close();
                recipe.onClose?.();
                return;
            }
            recipe.onControl?.(message, emit);
        };
        candidate.postMessage({
            t: 'ready',
            capability,
            buffered: buffered.splice(0),
        });
    };

    nativeAddEventListener.call(window, 'message', (rawEvent: Event) => {
        const event = rawEvent as MessageEvent<unknown>;
        if (event.source !== window || event.origin !== location.origin) {
            return;
        }
        if (!isHelloMessage(event.data, recipe.platform)) {
            return;
        }
        const candidate = event.ports[0];
        if (!candidate) {
            return;
        }
        adoptPort(candidate, event.data.capability);
    });

    Object.defineProperty(window, flagKey, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    announceReady();
}
