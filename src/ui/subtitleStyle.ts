import type { SettingsValues } from '@/config/schema';
import { DISNEY_LOOK } from '@/content/platform/disneyplus/appearance';
import { NETFLIX_LOOK } from '@/content/platform/netflix/appearance';
import type { PlatformId } from '@/content/platform/types';
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

export const PLATFORM_NAMES: Record<PlatformId, string> = {
    netflix: 'Netflix',
    disneyplus: 'Disney+',
};

/** How each platform draws subtitles for a fresh profile. */
export const PLATFORM_PRESETS: Record<PlatformId, SubtitleLook> = {
    netflix: NETFLIX_LOOK,
    disneyplus: DISNEY_LOOK,
};

export function isPlatformId(value: string): value is PlatformId {
    return Object.hasOwn(PLATFORM_NAMES, value);
}
