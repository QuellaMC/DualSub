import { extractDisneyPlusVideoIdFromPathname } from '@/shared/routeIdentity';
import type { CapturedEvent } from '../protocol';
import type { InterceptorRecipe } from './interceptor-core';
import { ResolutionSlot, waitFor } from './waitFor';

// Page-world natives captured at module evaluation (document_start), before
// any site script can replace them.
const nativeStringify = JSON.stringify;
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);

const PLAYBACK_POLL_INTERVAL_MS = 300;
const PLAYBACK_HEARTBEAT_MS = 1200;
const APPEARANCE_POLL_INTERVAL_MS = 500;
const APPEARANCE_WAIT_TIMEOUT_MS = 30_000;
const APPEARANCE_STRING_KEYS = [
    'backgroundColor',
    'windowColor',
    'textColor',
    'font',
    'size',
    'textEdge',
] as const;
const MAX_FONT_OVERRIDE_ENTRIES = 32;
const MAX_APPEARANCE_STRING_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

/** Expando properties the Disney player hangs on its custom elements. */
function readHostProperty(selector: string, property: string): unknown {
    const host = document.querySelector(selector);
    return host
        ? (host as unknown as Record<string, unknown>)[property]
        : undefined;
}

function readMasterPlaylistUrl(parsed: unknown): string | null {
    if (!isRecord(parsed)) {
        return null;
    }
    const container = isRecord(parsed.data) ? parsed.data : parsed;
    const stream = container.stream;
    if (!isRecord(stream) || !Array.isArray(stream.sources)) {
        return null;
    }
    const source: unknown = stream.sources[0];
    if (!isRecord(source) || !isRecord(source.complete)) {
        return null;
    }
    return readString(source.complete.url);
}

type TimelineSample = Omit<
    Extract<CapturedEvent, { t: 'timeline-update' }>,
    't' | 'platform' | 'sequence'
>;

function readPlaybackSessionId(root: unknown): string | null {
    if (!isRecord(root)) {
        return null;
    }
    const telemetry = root.telemetryParameters;
    const conviva = isRecord(telemetry) ? telemetry.conviva : null;
    const metadata = isRecord(conviva) ? conviva.metadata : null;
    return isRecord(metadata) ? readString(metadata.playbackSessionId) : null;
}

/** The player exposes its program clock on the `disney-web-player-ui`
 *  element; interstitial state lives on the controls overlay's store. */
function readPlaybackTimelineState(): TimelineSample | null {
    try {
        const playerApi = readHostProperty(
            'disney-web-player-ui',
            'mediaPlayerApi'
        );
        if (!isRecord(playerApi)) {
            return null;
        }
        const timeline = playerApi.timeline;
        const info = isRecord(timeline) ? timeline.info : null;
        const playheadPositionMs = isRecord(info)
            ? info.playheadPositionMs
            : null;
        if (
            typeof playheadPositionMs !== 'number' ||
            !Number.isFinite(playheadPositionMs) ||
            playheadPositionMs < 0
        ) {
            return null;
        }
        const videoId = extractDisneyPlusVideoIdFromPathname(location.pathname);
        if (!videoId) {
            return null;
        }

        const criteria = isRecord(playerApi.mediaPlaybackCriteria)
            ? playerApi.mediaPlaybackCriteria
            : null;
        const metadata =
            criteria && isRecord(criteria.metadata) ? criteria.metadata : null;
        const store = readHostProperty('main-app-controls-overlay', 'store');
        const interstitials = isRecord(store) ? store.interstitials : null;
        const isInterstitialPlaying = isRecord(interstitials)
            ? interstitials.isInterstitialPlaying
            : null;

        return {
            videoId,
            availId: metadata ? readString(metadata.availId) : null,
            playbackSessionId:
                readPlaybackSessionId(criteria) ??
                readPlaybackSessionId(playerApi),
            programTimeSeconds: playheadPositionMs / 1000,
            isInterstitialPlaying:
                typeof isInterstitialPlaying === 'boolean'
                    ? isInterstitialPlaying
                    : null,
        };
    } catch {
        return null;
    }
}

let pollTimer: number | null = null;
let polling = false;
let sequence = 0;
let lastSignature: string | null = null;
let lastDispatchAt = 0;

function dispatchPlaybackState(
    emit: (event: CapturedEvent) => void,
    force: boolean
): void {
    if (!force && !polling) {
        return;
    }
    const state = readPlaybackTimelineState();
    if (!state) {
        return;
    }
    const signature = nativeStringify(state);
    const now = Date.now();
    if (
        !force &&
        signature === lastSignature &&
        now - lastDispatchAt < PLAYBACK_HEARTBEAT_MS
    ) {
        return;
    }
    lastSignature = signature;
    lastDispatchAt = now;
    sequence += 1;
    emit({ t: 'timeline-update', platform: 'disneyplus', sequence, ...state });
}

/** The viewer's caption appearance as the player holds it, copied into
 *  fresh plain data; null until the player has mounted it. */
function readCaptionAppearance(): Record<string, unknown> | null {
    const playerApi = readHostProperty(
        'disney-web-player-ui',
        'mediaPlayerApi'
    );
    const captions = isRecord(playerApi) ? playerApi.captions : null;
    const preferences = isRecord(captions) ? captions.preferences : null;
    const source = isRecord(preferences) ? preferences.appearance : null;
    if (!isRecord(source)) {
        return null;
    }
    const appearance: Record<string, unknown> = {};
    for (const key of APPEARANCE_STRING_KEYS) {
        const value = source[key];
        if (
            typeof value === 'string' &&
            value.length <= MAX_APPEARANCE_STRING_LENGTH
        ) {
            appearance[key] = value;
        }
    }
    if (typeof source.sizeScalar === 'number') {
        appearance.sizeScalar = source.sizeScalar;
    }
    const fontMappingOverride: Record<string, Record<string, string>> = {};
    if (isRecord(source.fontMappingOverride)) {
        for (const [script, rules] of Object.entries(
            source.fontMappingOverride
        ).slice(0, MAX_FONT_OVERRIDE_ENTRIES)) {
            if (!isRecord(rules)) {
                continue;
            }
            const rule: Record<string, string> = {};
            for (const property of ['font-family', 'font-variant']) {
                const value = rules[property];
                if (
                    typeof value === 'string' &&
                    value.length <= MAX_APPEARANCE_STRING_LENGTH
                ) {
                    rule[property] = value;
                }
            }
            if (Object.keys(rule).length > 0) {
                fontMappingOverride[script] = rule;
            }
        }
    }
    appearance.fontMappingOverride = fontMappingOverride;
    return 'size' in appearance ? appearance : null;
}

const appearanceResolution = new ResolutionSlot();

async function resolveSubtitleAppearance(
    emit: (event: CapturedEvent) => void
): Promise<void> {
    const token = appearanceResolution.begin();
    try {
        const appearance = await waitFor(
            readCaptionAppearance,
            APPEARANCE_POLL_INTERVAL_MS,
            APPEARANCE_WAIT_TIMEOUT_MS,
            token
        );
        if (appearance && !token.cancelled) {
            emit({
                t: 'subtitle-appearance',
                platform: 'disneyplus',
                appearance,
            });
        }
    } finally {
        appearanceResolution.release(token);
    }
}

function pausePolling(): void {
    polling = false;
    if (pollTimer !== null) {
        nativeClearInterval(pollTimer);
        pollTimer = null;
    }
}

function resumePolling(emit: (event: CapturedEvent) => void): void {
    if (polling && pollTimer !== null) {
        return;
    }
    polling = true;
    pollTimer = nativeSetInterval(
        () => dispatchPlaybackState(emit, false),
        PLAYBACK_POLL_INTERVAL_MS
    );
    dispatchPlaybackState(emit, true);
}

/** Disney+ playback responses carry the HLS master URL under
 *  `stream.sources[0].complete.url`; the route path identifies the video.
 *  The isolated world drives a program-clock poller through control frames. */
export const disneyRecipe: InterceptorRecipe = {
    platform: 'disneyplus',
    onParsed(parsed, emit) {
        const url = readMasterPlaylistUrl(parsed);
        if (!url) {
            return;
        }
        const videoId = extractDisneyPlusVideoIdFromPathname(location.pathname);
        if (!videoId) {
            return;
        }
        emit({ t: 'subtitle-url', platform: 'disneyplus', url, videoId });
    },
    onControl(message, emit) {
        switch (message.t) {
            case 'request-playback-timeline':
                dispatchPlaybackState(emit, true);
                break;
            case 'playback-bridge-resume':
                resumePolling(emit);
                break;
            case 'request-subtitle-appearance':
                void resolveSubtitleAppearance(emit);
                break;
            case 'playback-bridge-pause':
            case 'close':
                pausePolling();
                break;
        }
    },
    onClose() {
        pausePolling();
        appearanceResolution.cancel();
    },
};
