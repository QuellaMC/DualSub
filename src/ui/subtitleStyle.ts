import type { SettingsValues } from '@/config/schema';
import { DISNEY_LOOK } from '@/content/platform/disneyplus/appearance';
import { NETFLIX_LOOK } from '@/content/platform/netflix/appearance';
import type { PlatformId } from '@/shared/platforms';
import type { SubtitleLook } from '@/content/renderer/looks';

export type SubtitleStyle = SettingsValues['subtitleStyle'];

/** Catalog keys of the style choices, in menu order. */
export const SUBTITLE_STYLE_LABELS: Record<SubtitleStyle, string> = {
    platform: 'subtitleStylePlatform',
    custom: 'subtitleStyleCustom',
};

export function isSubtitleStyle(value: string): value is SubtitleStyle {
    return Object.hasOwn(SUBTITLE_STYLE_LABELS, value);
}

/** How each platform draws subtitles for a fresh profile. */
export const PLATFORM_PRESETS: Record<PlatformId, SubtitleLook> = {
    netflix: NETFLIX_LOOK,
    disneyplus: DISNEY_LOOK,
};
