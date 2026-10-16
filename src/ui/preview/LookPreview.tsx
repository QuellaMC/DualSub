import { useEffect, useRef } from 'react';
import { STANDARD_PLACEMENT } from '@/content/renderer/cueSelect';
import type { SubtitleLook } from '@/content/renderer/looks';
import {
    applyBlockStyle,
    createBlockElements,
    type DisplaySettings,
} from '@/content/renderer/styling';

/** A mock picture carrying one subtitle block, drawn by the renderer's own
 *  styling so the preview cannot drift from the overlay. The text takes the
 *  size it would have on a picture `pictureHeight` pixels tall. */
export function LookPreview({
    display,
    look,
    pictureHeight,
    originalText,
    translatedText,
    label,
}: {
    display: DisplaySettings;
    look: SubtitleLook;
    pictureHeight: number;
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
            pictureHeight,
            STANDARD_PLACEMENT
        );
        host.replaceChildren(elements.container);
        return () => elements.container.remove();
    }, [display, look, pictureHeight, originalText, translatedText]);

    return <div className="screen" ref={frame} role="img" aria-label={label} />;
}
