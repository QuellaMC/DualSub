import {
    useCallback,
    useLayoutEffect,
    useState,
    type RefCallback,
} from 'react';
import { STANDARD_PLACEMENT } from '@/shared/cuePlacement';
import type { SubtitleLook } from '@/content/renderer/looks';
import {
    applyBlockStyle,
    createBlockElements,
    type BlockElements,
    type DisplaySettings,
} from '@/content/renderer/styling';

export interface SampleBlock {
    readonly display: DisplaySettings;
    readonly look: SubtitleLook;
    /** The text takes the size it would have on a picture this many pixels
     *  tall. */
    readonly pictureHeight: number;
    readonly originalText: string;
    /** Empty for one line. */
    readonly translatedText: string;
}

/**
 * One subtitle block drawn by the renderer's own styling, so a preview
 * cannot drift from the overlay, and the ref that puts it in its frame.
 * The block keeps its elements as the settings change, so their styles
 * can transition.
 */
export function useSubtitleBlock({
    display,
    look,
    pictureHeight,
    originalText,
    translatedText,
}: SampleBlock): readonly [BlockElements, RefCallback<HTMLElement>] {
    const [elements] = useState(() => createBlockElements('preview'));

    const attach = useCallback(
        (frame: HTMLElement | null) => {
            frame?.append(elements.container);
            return () => elements.container.remove();
        },
        [elements]
    );

    useLayoutEffect(() => {
        elements.original.textContent = originalText;
        elements.translated.textContent = translatedText;
        applyBlockStyle(
            elements,
            display,
            look,
            pictureHeight,
            STANDARD_PLACEMENT
        );
    }, [elements, display, look, pictureHeight, originalText, translatedText]);

    return [elements, attach];
}
