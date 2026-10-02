import { useEffect, useRef } from 'react';
import { STANDARD_PLACEMENT } from '@/content/renderer/cueSelect';
import type { SubtitleLook } from '@/content/renderer/looks';
import {
    applyBlockStyle,
    createBlockElements,
    type DisplaySettings,
} from '@/content/renderer/styling';

/** The preview is drawn as on a picture this many pixels tall, so the text
 *  has the size it would have on a full-HD screen. */
const PREVIEW_PICTURE_HEIGHT = 1080;

/** A mock picture carrying one subtitle block, drawn by the renderer's own
 *  styling so the preview cannot drift from the overlay. */
export function LookPreview({
    display,
    look,
    originalText,
    translatedText,
    label,
}: {
    display: DisplaySettings;
    look: SubtitleLook;
    originalText: string;
    translatedText: string;
    label: string;
}) {
    const frame = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = frame.current;
        if (!host) {
            return;
        }
        const elements = createBlockElements('preview');
        elements.original.textContent = originalText;
        elements.translated.textContent = translatedText;
        applyBlockStyle(
            elements,
            display,
            look,
            PREVIEW_PICTURE_HEIGHT,
            STANDARD_PLACEMENT
        );
        host.replaceChildren(elements.container);
        return () => elements.container.remove();
    }, [display, look, originalText, translatedText]);

    return (
        <div
            className="look-preview"
            ref={frame}
            role="img"
            aria-label={label}
        />
    );
}
