import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../design/Icon';
import type { Translate } from '../../hooks/useI18n';
import type { ToastTone } from './feedback';

export interface ToastState {
    readonly id: number;
    readonly message: string;
    readonly tone: ToastTone;
    /** Resolves whether the change was undone. */
    readonly undo: (() => Promise<boolean>) | null;
}

interface ToastProps {
    readonly t: Translate;
    readonly onDismiss: (id: number) => void;
    /** The toast is pointed at or focused, so it must not go yet. */
    readonly onHold: (held: boolean) => void;
}

const TEXT_INPUT_TYPES = [
    'text',
    'search',
    'url',
    'email',
    'password',
    'number',
];

/** Where Ctrl+Z already undoes the typing. */
function editsText(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
            TEXT_INPUT_TYPES.includes(target.type)) ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

/**
 * One change, said in words. It stays while pointed at or focused, and
 * Ctrl+Z (⌘Z) undoes it from anywhere but a text field, so Undo is in reach
 * for keyboard users before it goes. It goes once the change is undone, and
 * an Undo that fails stays to be tried again. Focus on Undo goes back to
 * where it came from.
 */
function ToastCard({
    t,
    toast,
    onDismiss,
    onHold,
}: ToastProps & { readonly toast: ToastState }) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const returnFocus = useRef<HTMLElement | null>(null);
    const held = hovered || focused;
    const { id, undo } = toast;

    useEffect(() => onHold(held), [held, onHold]);
    useEffect(() => () => onHold(false), [onHold]);

    const undoThenDismiss = useCallback((): void => {
        void undo?.().then((undone) => {
            if (undone) {
                onDismiss(id);
            }
        });
    }, [id, undo, onDismiss]);

    useEffect(() => {
        if (!undo) {
            return;
        }
        const onKey = (event: KeyboardEvent): void => {
            if (
                event.key.toLowerCase() === 'z' &&
                (event.ctrlKey || event.metaKey) &&
                !event.shiftKey &&
                !event.altKey &&
                !editsText(event.target)
            ) {
                event.preventDefault();
                undoThenDismiss();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo, undoThenDismiss]);

    return (
        <div
            className={`toast ${toast.tone}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    returnFocus.current =
                        event.relatedTarget instanceof HTMLElement
                            ? event.relatedTarget
                            : null;
                }
                setFocused(true);
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setFocused(false);
                }
            }}
        >
            <Icon name={toast.tone === 'done' ? 'check' : 'alert'} />
            <span>{toast.message}</span>
            {undo && (
                <button
                    type="button"
                    className="toast-undo"
                    aria-keyshortcuts="Control+Z Meta+Z"
                    onClick={() => {
                        undoThenDismiss();
                        const back = returnFocus.current;
                        (back?.isConnected
                            ? back
                            : document.querySelector<HTMLElement>('.content h1')
                        )?.focus();
                    }}
                >
                    {t('toastUndo')}
                </button>
            )}
        </div>
    );
}

export function Toast({
    toast,
    ...props
}: ToastProps & { readonly toast: ToastState | null }) {
    return (
        <div className="toast-region" role="status" aria-live="polite">
            {toast && <ToastCard key={toast.id} toast={toast} {...props} />}
        </div>
    );
}
