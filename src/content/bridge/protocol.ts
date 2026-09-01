// Frames exchanged between the MAIN-world interceptor and the isolated-world
// bridge over a private MessagePort. Imported by BOTH worlds: this module
// must never reference chrome.* or any extension API.

export type BridgePlatform = 'netflix' | 'disneyplus';

export type CapturedEvent =
    | {
          t: 'subtitle-data';
          platform: 'netflix';
          movieId: string;
          tracks: unknown[];
      }
    | {
          t: 'subtitle-url';
          platform: 'disneyplus';
          url: string;
          videoId: string;
      }
    | {
          t: 'timeline-update';
          platform: 'disneyplus';
          sequence: number;
          videoId: string;
          programTimeSeconds: number;
          availId: string | null;
          playbackSessionId: string | null;
          isInterstitialPlaying: boolean | null;
      };

export type MainToIsolated =
    | { t: 'ready'; capability: string; buffered: CapturedEvent[] }
    | CapturedEvent;

export type IsolatedToMain =
    | { t: 'request-playback-timeline' }
    | { t: 'playback-bridge-resume' }
    | { t: 'playback-bridge-pause' }
    | { t: 'close' };

export interface HelloMessage {
    dualsub: 'hello';
    platform: BridgePlatform;
    capability: string;
}

export const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/;

export function mainReadyEventName(platform: BridgePlatform): string {
    return `dualsub:${platform}:main-ready`;
}

const MAX_BUFFERED_EVENTS = 20;
const MAX_ROUTE_ID_LENGTH = 768;
const MAX_URL_LENGTH = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= maxLength
    );
}

export function isCapturedEvent(value: unknown): value is CapturedEvent {
    if (!isRecord(value)) {
        return false;
    }
    switch (value.t) {
        case 'subtitle-data':
            return (
                value.platform === 'netflix' &&
                isBoundedString(value.movieId, MAX_ROUTE_ID_LENGTH) &&
                Array.isArray(value.tracks)
            );
        case 'subtitle-url':
            return (
                value.platform === 'disneyplus' &&
                isBoundedString(value.url, MAX_URL_LENGTH) &&
                isBoundedString(value.videoId, MAX_ROUTE_ID_LENGTH)
            );
        case 'timeline-update':
            return (
                value.platform === 'disneyplus' &&
                Number.isSafeInteger(value.sequence) &&
                isBoundedString(value.videoId, MAX_ROUTE_ID_LENGTH) &&
                typeof value.programTimeSeconds === 'number' &&
                Number.isFinite(value.programTimeSeconds) &&
                (value.availId === null ||
                    isBoundedString(value.availId, MAX_ROUTE_ID_LENGTH)) &&
                (value.playbackSessionId === null ||
                    isBoundedString(
                        value.playbackSessionId,
                        MAX_ROUTE_ID_LENGTH
                    )) &&
                (value.isInterstitialPlaying === null ||
                    typeof value.isInterstitialPlaying === 'boolean')
            );
        default:
            return false;
    }
}

export function isMainToIsolated(value: unknown): value is MainToIsolated {
    if (isCapturedEvent(value)) {
        return true;
    }
    return (
        isRecord(value) &&
        value.t === 'ready' &&
        typeof value.capability === 'string' &&
        CAPABILITY_PATTERN.test(value.capability) &&
        Array.isArray(value.buffered) &&
        value.buffered.length <= MAX_BUFFERED_EVENTS &&
        value.buffered.every(isCapturedEvent)
    );
}

export function isIsolatedToMain(value: unknown): value is IsolatedToMain {
    return (
        isRecord(value) &&
        (value.t === 'request-playback-timeline' ||
            value.t === 'playback-bridge-resume' ||
            value.t === 'playback-bridge-pause' ||
            value.t === 'close')
    );
}

export function isHelloMessage(
    value: unknown,
    platform: BridgePlatform
): value is HelloMessage {
    return (
        isRecord(value) &&
        value.dualsub === 'hello' &&
        value.platform === platform &&
        typeof value.capability === 'string' &&
        CAPABILITY_PATTERN.test(value.capability)
    );
}
