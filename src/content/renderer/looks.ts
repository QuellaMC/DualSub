import type { CustomLook, SettingsValues } from '@/config/schema';
import type { DisplaySettings } from './styling';

export type SubtitleStyle = SettingsValues['subtitleStyle'];

/**
 * The typography and box of both subtitle lines. Layout (order, gap,
 * position), the translation line's color, and size stay with the display
 * settings: the platforms size a single line, and two lines at that size
 * are too tall, so every look is drawn at DualSub's own size.
 */
export interface SubtitleLook {
    readonly fontFamily: string;
    readonly fontWeight: string;
    readonly fontVariant: string;
    readonly originalColor: string;
    readonly textShadow: string;
    /** `-webkit-text-stroke` value; empty for none. */
    readonly textStroke: string;
    readonly background: string;
    readonly padding: string;
    readonly borderRadius: string;
}

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

/** The custom look at the setting's defaults is DualSub's own look. */
export function customLook(values: CustomLook): SubtitleLook {
    return {
        ...FONTS[values.font],
        fontWeight: values.bold ? 'bold' : 'normal',
        originalColor: values.originalColor,
        ...EDGES[values.edge],
        background: hexWithOpacity(
            values.backgroundColor,
            values.backgroundOpacity
        ),
        padding: '0.2em 0.5em',
        borderRadius: '4px',
    };
}

/** The platform style is the viewer's own platform settings when the page
 *  has reported them, else the platform's documented defaults. */
export function resolveLook(
    display: Pick<DisplaySettings, 'style' | 'customLook'>,
    platformPreset: SubtitleLook,
    platformLook: SubtitleLook | null
): SubtitleLook {
    return display.style === 'platform'
        ? (platformLook ?? platformPreset)
        : display.customLook;
}
