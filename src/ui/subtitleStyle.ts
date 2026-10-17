import { DISNEY_LOOK } from '@/content/platform/disneyplus/appearance';
import { NETFLIX_LOOK } from '@/content/platform/netflix/appearance';
import type { PlatformId } from '@/shared/platforms';
import type { SubtitleLook } from '@/content/renderer/looks';

/** How each platform draws subtitles for a fresh profile. */
export const PLATFORM_PRESETS: Record<PlatformId, SubtitleLook> = {
    netflix: NETFLIX_LOOK,
    disneyplus: DISNEY_LOOK,
};
