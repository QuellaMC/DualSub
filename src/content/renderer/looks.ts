import type { SettingsValues } from '@/config/schema';

export type SubtitleStyle = SettingsValues['subtitleStyle'];

/**
 * The typography and box of both subtitle lines. Layout (order, gap,
 * position) stays with the display settings, and size with the renderer:
 * the platforms size a single line, and two lines at that size are too
 * tall, so every look is drawn at DualSub's own size.
 */
export interface SubtitleLook {
    readonly fontFamily: string;
    readonly fontWeight: string;
    readonly fontVariant: string;
    readonly originalColor: string;
    readonly translatedColor: string;
    readonly textShadow: string;
    /** `-webkit-text-stroke` value; empty for none. */
    readonly textStroke: string;
    readonly background: string;
    readonly padding: string;
    readonly borderRadius: string;
}

/** The translation keeps this color in every look so the lines stay apart. */
export const TRANSLATION_COLOR = '#00FFFF';

export const DUALSUB_LOOK: SubtitleLook = {
    fontFamily: 'inherit',
    fontWeight: 'normal',
    fontVariant: 'normal',
    originalColor: 'white',
    translatedColor: TRANSLATION_COLOR,
    textShadow: '1px 1px 2px black, 0 0 3px black',
    textStroke: '',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '0.2em 0.5em',
    borderRadius: '4px',
};

/** The platform style is the viewer's own platform settings when the page
 *  has reported them, else the platform's documented defaults. */
export function resolveLook(
    style: SubtitleStyle,
    platformPreset: SubtitleLook,
    platformLook: SubtitleLook | null
): SubtitleLook {
    if (style !== 'platform') {
        return DUALSUB_LOOK;
    }
    return platformLook ?? platformPreset;
}
