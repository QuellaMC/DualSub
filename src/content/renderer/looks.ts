import type { SettingsValues } from '@/config/schema';
import { normalizeLanguageCode } from '@/shared/languageNormalization';

export type SubtitleStyle = SettingsValues['subtitleStyle'];

/** Adjustments a platform makes for the language of the line it draws. */
export interface LanguageLookOverride {
    readonly sizeScale?: number;
    readonly fontFamily?: string;
    readonly fontWeight?: string;
}

/**
 * The typography and box of both subtitle lines. Layout (order, gap,
 * position) stays with the display settings; size is a fraction of the
 * video's rendered height so every look scales the way the platforms'
 * own subtitles do.
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
    /** Font size at scale 1, as a fraction of the video's rendered height. */
    readonly sizeRatio: number;
    /** Keyed by normalized language code. */
    readonly languageOverrides: Readonly<Record<string, LanguageLookOverride>>;
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
    sizeRatio: 0.02,
    languageOverrides: {},
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

/** The look as the platform would draw a line in `language`. */
export function forLanguage(
    look: SubtitleLook,
    language: string
): SubtitleLook {
    const override = look.languageOverrides[normalizeLanguageCode(language)];
    if (!override) {
        return look;
    }
    return {
        ...look,
        sizeRatio: look.sizeRatio * (override.sizeScale ?? 1),
        fontFamily: override.fontFamily ?? look.fontFamily,
        fontWeight: override.fontWeight ?? look.fontWeight,
    };
}
