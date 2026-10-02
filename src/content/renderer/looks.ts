import {
    getDefaultValue,
    type CustomLook,
    type SettingsValues,
} from '@/config/schema';
import type { DisplaySettings } from './styling';

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

/** The translation keeps this color in the platform looks so the lines
 *  stay apart. */
export const TRANSLATION_COLOR = '#00FFFF';

const FONTS: Record<
    CustomLook['font'],
    Pick<SubtitleLook, 'fontFamily' | 'fontVariant'>
> = {
    default: { fontFamily: 'inherit', fontVariant: 'normal' },
    'sans-serif': {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontVariant: 'normal',
    },
    serif: {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontVariant: 'normal',
    },
    monospace: {
        fontFamily: '"Courier New", Courier, monospace',
        fontVariant: 'normal',
    },
    casual: {
        fontFamily: '"Comic Sans MS", "Chalkboard SE", cursive',
        fontVariant: 'normal',
    },
    'small-caps': {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontVariant: 'small-caps',
    },
};

const EDGES: Record<
    CustomLook['edge'],
    Pick<SubtitleLook, 'textShadow' | 'textStroke'>
> = {
    none: { textShadow: 'none', textStroke: '' },
    shadow: { textShadow: '1px 1px 2px black, 0 0 3px black', textStroke: '' },
    outline: { textShadow: 'none', textStroke: '1.5px black' },
    raised: { textShadow: '2px 2px 0 rgba(0, 0, 0, 0.5)', textStroke: '' },
    depressed: { textShadow: '1px 1px 0 rgba(0, 0, 0, 0.88)', textStroke: '' },
};

/** A `#rrggbb` color at an opacity; the hex itself when fully opaque. */
export function hexWithOpacity(hex: string, opacity: number): string {
    if (opacity >= 1) {
        return hex;
    }
    const value = Number.parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

export function customLook(values: CustomLook): SubtitleLook {
    return {
        ...FONTS[values.font],
        fontWeight: values.bold ? 'bold' : 'normal',
        originalColor: values.originalColor,
        translatedColor: values.translatedColor,
        ...EDGES[values.edge],
        background: hexWithOpacity(
            values.backgroundColor,
            values.backgroundOpacity
        ),
        padding: '0.2em 0.5em',
        borderRadius: '4px',
    };
}

/** Custom starts from what the viewer already sees: DualSub's own look
 *  is the custom look at the setting's defaults. */
export const DUALSUB_LOOK: SubtitleLook = customLook(
    getDefaultValue('subtitleCustomLook')
);

/** The platform style is the viewer's own platform settings when the page
 *  has reported them, else the platform's documented defaults. */
export function resolveLook(
    display: Pick<DisplaySettings, 'style' | 'customLook'>,
    platformPreset: SubtitleLook,
    platformLook: SubtitleLook | null
): SubtitleLook {
    switch (display.style) {
        case 'platform':
            return platformLook ?? platformPreset;
        case 'custom':
            return display.customLook;
        default:
            return DUALSUB_LOOK;
    }
}
