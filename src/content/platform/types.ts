import type { CapturedEvent, IsolatedToMain } from '../bridge/protocol';
import type { Logger } from '@/shared/logger';
import type { SettingsValues } from '@/config/schema';

export type PlatformId = 'netflix' | 'disneyplus';

/** Fixed per-platform behavior flags — data, not overridable escape hatches. */
export interface PlatformCapabilities {
    /** video.pause()/play() are safe (Netflix). false → the adapter must go
     *  through the platform's own UI control (Disney toggle button). */
    readonly directMediaControl: boolean;
    /** The <video> element is replaced across episodes, so media detection
     *  after navigation must refuse the previous element. */
    readonly videoReplacedAcrossEpisodes: boolean;
}

export type BridgeEventClassification =
    | { kind: 'subtitle'; videoId: string }
    | { kind: 'platform'; videoId: string | null };

export interface BridgeControlSender {
    readonly connected: boolean;
    sendControl(message: IsolatedToMain): boolean;
}

export type ConfigReader = {
    get<K extends keyof SettingsValues>(key: K): Promise<SettingsValues[K]>;
};

/** The session's subtitle language choices, fixed for its lifetime: a
 *  change restarts the session. */
export interface SubtitleLanguages {
    readonly originalLanguage: string;
    readonly targetLanguage: string;
    readonly useOfficialTranslations: boolean;
}

export interface AdapterContext {
    readonly signal: AbortSignal;
    readonly videoId: string;
    readonly languages: SubtitleLanguages;
    readonly bridge: BridgeControlSender;
    readonly config: ConfigReader;
    readonly logger: Logger;
}

export interface MediaScope {
    readonly root: HTMLElement | null;
    readonly video: HTMLVideoElement;
}

/** Cross-session platform memory handed old session → new session. */
export interface PlatformHandoff {
    readonly mediaScope: MediaScope | null;
    readonly platformScratch: unknown;
}

export type SubtitleFetchSpec =
    | {
          readonly kind: 'netflix-tracks';
          readonly tracks: unknown[];
      }
    | { readonly kind: 'm3u8-master'; readonly url: string };

export interface NativeSubRecipe {
    readonly styleId: string;
    readonly selectors: readonly string[];
    readonly css: string;
    /** Roots to watch for re-rendered native subtitle nodes. */
    observedRoots(media: MediaScope): Element[];
}

/** Stateless, per-platform facts usable before any session exists. */
export interface PlatformDescriptor {
    readonly id: PlatformId;
    readonly capabilities: PlatformCapabilities;
    /** videoId from an absolute URL, or null when not a player route. */
    parseVideoIdFromUrl(url: string): string | null;
    /** Route a validated bridge event before any session exists. Netflix
     *  keys by the event's own movieId so next-episode preloads land under
     *  the upcoming video. Null → drop. */
    classifyBridgeEvent(event: CapturedEvent): BridgeEventClassification | null;
    createAdapter(
        context: AdapterContext,
        handoff: PlatformHandoff | null
    ): PlatformAdapter;
}

/** One stateful adapter per PlayerSession. */
export interface PlatformAdapter {
    /** Turn a subtitle event for this session's video into a background
     *  fetch spec, or null to ignore. */
    interpretSubtitleEvent(event: CapturedEvent): SubtitleFetchSpec | null;
    /** Non-subtitle platform events (Disney timeline updates). */
    onPlatformEvent(event: CapturedEvent): void;
    /** The page bridge (re)connected: send any page-world setup traffic. */
    onBridgeConnected?(): void;
    /** Program time in seconds for cue lookup, or null meaning "suppress
     *  subtitles this frame" (Disney interstitials, untrustworthy clock). */
    getPlaybackTime(video: HTMLVideoElement): number | null;
    /** Seek or media re-bind: drop any clock calibration. */
    onClockInvalidated(): void;
    discoverVideo(): HTMLVideoElement | null;
    getPlayerContainer(video: HTMLVideoElement): HTMLElement | null;
    pause(video: HTMLVideoElement): Promise<boolean>;
    play(video: HTMLVideoElement): Promise<boolean>;
    readonly nativeSubRecipe: NativeSubRecipe;
    /** Teardown step before the session aborts: last page-world traffic. */
    beforeAbort(): void;
    /** Final teardown step; returns opaque platform memory for the successor. */
    dispose(): unknown;
}
