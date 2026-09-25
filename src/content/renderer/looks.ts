import type { SettingsValues } from '@/config/schema';
import type { PlatformId } from '../platform/types';

export type SubtitleStyle = SettingsValues['subtitleStyle'];

/**
 * The typography and box of both subtitle lines. Layout (order, gap,
 * position) stays with the display settings; size is a fraction of the
 * video's rendered height so every look scales the way the platforms'
 * own subtitles do.
 */
export interface SubtitleLook {
    readonly fontFamily: string;
    readonly fontWeight: string;
    readonly originalColor: string;
    readonly translatedColor: string;
    readonly textShadow: string;
    readonly background: string;
    readonly padding: string;
    readonly borderRadius: string;
    /** Font size at scale 1, as a fraction of the video's rendered height. */
    readonly sizeRatio: number;
}

export const DUALSUB_LOOK: SubtitleLook = {
    fontFamily: 'inherit',
    fontWeight: 'normal',
    originalColor: 'white',
    translatedColor: '#00FFFF',
    textShadow: '1px 1px 2px black, 0 0 3px black',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '0.2em 0.5em',
    borderRadius: '4px',
    sizeRatio: 0.02,
};

/** Each platform's default subtitle rendering as its web player draws it.
 *  The translation keeps DualSub's color so the two lines stay apart. */
export const PLATFORM_LOOKS: Record<PlatformId, SubtitleLook> = {
    netflix: {
        fontFamily:
            '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontWeight: 'bold',
        originalColor: '#ffffff',
        translatedColor: '#00FFFF',
        textShadow: '#000000 0px 0px 7px',
        background: 'transparent',
        padding: '0',
        borderRadius: '0',
        sizeRatio: 0.035,
    },
    disneyplus: {
        fontFamily:
            'Avenir, "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontWeight: 'normal',
        originalColor: '#ffffff',
        translatedColor: '#00FFFF',
        textShadow: '0 0 6px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(0, 0, 0, 0.9)',
        background: 'transparent',
        padding: '0',
        borderRadius: '0',
        sizeRatio: 0.035,
    },
};

export function resolveLook(
    style: SubtitleStyle,
    platform: PlatformId
): SubtitleLook {
    return style === 'platform' ? PLATFORM_LOOKS[platform] : DUALSUB_LOOK;
}
