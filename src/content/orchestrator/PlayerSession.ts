import { createLogger } from '@/shared/logger';
import { configService } from '@/config/service';
import type { SettingsValues } from '@/config/schema';
import { sendMessage, sendWithRetry } from '@/messaging/client';
import { fetchVtt, type FetchVttRequest } from '@/messaging/contracts/fetchVtt';
import {
    sidePanelSelectionSync,
    sidePanelWordSelected,
    type ContentSelectionSnapshot,
} from '@/messaging/contracts/selection';
import {
    translate,
    type TranslateRequest,
    type TranslateResponse,
} from '@/messaging/contracts/translate';
import type { CapturedEvent } from '../bridge/protocol';
import type { SubtitleEventCache } from '../bridge/SubtitleEventCache';
import type {
    BridgeControlSender,
    PlatformAdapter,
    PlatformDescriptor,
    PlatformHandoff,
    SubtitleFetchSpec,
    SubtitleLanguages,
} from '../platform/types';
import { installNativeSubHider } from '../platform/shared/nativeSubHider';
import { Renderer } from '../renderer/Renderer';
import { RendererState } from '../renderer/RendererState';
import type { UiRoot } from '../renderer/domLayer';
import type { DisplaySettings } from '../renderer/styling';
import type { WordIntent } from '../renderer/wordLayer';
import {
    allocateLifecycleGeneration,
    SelectionAuthority,
} from '../selection/SelectionAuthority';
import { buildCueSet, type CueSet } from '../subtitles/cueModel';
import { TranslationScheduler } from '../translation/TranslationScheduler';
import { MediaBinding } from './MediaBinding';
import { childScope, ensureLive, runScoped, scopedTimeout } from './scope';

export type SessionEndReason =
    | 'navigation'
    | 'left-player-page'
    | 'document-teardown'
    | 'context-invalidated';

/** A wait longer than this drops the loading placeholder; the platform
 *  evidently has nothing coming. */
const SUBTITLE_LOADING_TIMEOUT_MS = 20_000;

export const CONTENT_SETTINGS_KEYS = [
    'subtitlesEnabled',
    'subtitleFontSize',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleLayoutOrientation',
    'subtitleLayoutOrder',
    'subtitleTimeOffset',
] as const;

export type ContentSettings = Pick<
    SettingsValues,
    (typeof CONTENT_SETTINGS_KEYS)[number]
>;

export const FETCH_SETTINGS_KEYS = [
    'targetLanguage',
    'originalLanguage',
    'useOfficialTranslations',
] as const;

/** Clickable words and what a click asks the side panel to do. */
export const INTERACTION_SETTINGS_KEYS = [
    'aiContextEnabled',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
] as const;

export type InteractionSettings = Pick<
    SettingsValues,
    (typeof INTERACTION_SETTINGS_KEYS)[number]
>;

export function toSubtitleLanguages(
    settings: Partial<
        Pick<SettingsValues, (typeof FETCH_SETTINGS_KEYS)[number]>
    >
): SubtitleLanguages {
    return {
        originalLanguage: settings.originalLanguage ?? 'en',
        targetLanguage: settings.targetLanguage ?? 'en',
        useOfficialTranslations: settings.useOfficialTranslations ?? true,
    };
}

export function toDisplaySettings(settings: ContentSettings): DisplaySettings {
    return {
        fontSizeVw: settings.subtitleFontSize,
        gap: settings.subtitleGap,
        verticalPosition: settings.subtitleVerticalPosition,
        orientation: settings.subtitleLayoutOrientation,
        order: settings.subtitleLayoutOrder,
        timeOffset: settings.subtitleTimeOffset,
    };
}

function isContextInvalidated(error: unknown): boolean {
    return error instanceof Error && /context invalidated/i.test(error.message);
}

export interface PlayerSessionDeps {
    readonly id: number;
    readonly videoId: string;
    readonly descriptor: PlatformDescriptor;
    readonly bridge: BridgeControlSender;
    readonly cache: SubtitleEventCache;
    readonly uiRoot: UiRoot;
    readonly handoff: PlatformHandoff | null;
    readonly settings: ContentSettings;
    readonly languages: SubtitleLanguages;
    readonly interaction: InteractionSettings;
    readonly onNavigationMismatch: () => void;
    readonly onContextInvalidated: () => void;
}

/**
 * Everything that lives exactly as long as one video is on the player
 * route. One AbortSignal is the lifetime: listeners, timers, the frame
 * loop, in-flight requests, and config subscriptions all die with it, so a
 * stale continuation cannot touch a successor session.
 */
export class PlayerSession {
    readonly id: number;
    readonly videoId: string;
    readonly signal: AbortSignal;
    private readonly controller = new AbortController();
    private readonly logger;
    private state: 'starting' | 'active' | 'ending' | 'ended' = 'starting';
    private adapter: PlatformAdapter;
    private readonly rendererState: RendererState;
    private readonly renderer: Renderer;
    private readonly mediaBinding: MediaBinding;
    /** Which words of the current line are selected; the panel mirrors it. */
    readonly selection: SelectionAuthority;
    private mediaScope: AbortController | null = null;
    private settings: ContentSettings;
    private languagesValue: SubtitleLanguages;
    private interaction: InteractionSettings;
    private latestSubtitleEvent: CapturedEvent | null = null;
    private loadingToken = 0;
    private inFlightKey: string | null = null;
    private completedKey: string | null = null;
    /** Latest-wins: a slower earlier request must not overwrite newer cues. */
    private requestSequence = 0;
    /** Translate-mode loop for the current cue set; one scope per cue set. */
    private translation: {
        readonly scheduler: TranslationScheduler;
        readonly scope: AbortController;
    } | null = null;

    constructor(private readonly deps: PlayerSessionDeps) {
        this.id = deps.id;
        this.videoId = deps.videoId;
        this.signal = this.controller.signal;
        this.settings = deps.settings;
        this.languagesValue = deps.languages;
        this.interaction = deps.interaction;
        this.logger = createLogger(
            `PlayerSession:${deps.descriptor.id}:${deps.id}`
        );
        this.selection = new SelectionAuthority({
            lifecycleGeneration: allocateLifecycleGeneration(),
            publish: (snapshot, canDispatch) =>
                this.publishSelection(snapshot, canDispatch),
            onSelectionChanged: (indices) =>
                this.renderer.setSelectedWords(indices),
        });

        this.adapter = deps.descriptor.createAdapter(
            {
                signal: this.signal,
                videoId: deps.videoId,
                languages: () => this.languagesValue,
                bridge: deps.bridge,
                config: configService,
                logger: this.logger,
            },
            deps.handoff
        );
        this.rendererState = new RendererState(
            toDisplaySettings(deps.settings)
        );
        this.renderer = new Renderer({
            state: this.rendererState,
            adapter: this.adapter,
            descriptor: deps.descriptor,
            videoId: deps.videoId,
            uiRoot: deps.uiRoot,
            signal: this.signal,
            logger: this.logger,
            onNavigationMismatch: deps.onNavigationMismatch,
            onSeek: () => this.translation?.scheduler.kick(),
            onOriginalPainted: (revision) =>
                this.selection.onSubtitleChange(revision),
            onWordIntent: (intent) => this.onWordIntent(intent),
            wordLanguage: () => this.languagesValue.originalLanguage,
        });
        this.mediaBinding = new MediaBinding({
            adapter: this.adapter,
            requireReplacementOf: deps.descriptor.capabilities
                .videoReplacedAcrossEpisodes
                ? (deps.handoff?.mediaScope ?? null)
                : null,
            onBound: (media) => {
                this.mediaScope = childScope(this.signal);
                this.adapter.onClockInvalidated();
                this.renderer.attachMedia(media);
                installNativeSubHider(this.adapter.nativeSubRecipe, media, {
                    signal: this.mediaScope.signal,
                    config: configService,
                    logger: this.logger,
                });
                this.translation?.scheduler.kick();
            },
            onLost: () => {
                this.mediaScope?.abort();
                this.mediaScope = null;
                this.renderer.detachMedia();
            },
            signal: this.signal,
            logger: this.logger,
        });
    }

    get languages(): SubtitleLanguages {
        return this.languagesValue;
    }

    start(): void {
        this.renderer.setVisible(this.settings.subtitlesEnabled);
        this.renderer.setInteractive(this.interaction.aiContextEnabled);
        const unsubscribe = configService.onChanged((changes) =>
            this.applySettings(changes)
        );
        this.signal.addEventListener('abort', unsubscribe, { once: true });
        this.setLoading(true);

        // Replays retained events synchronously — anything the page bridge
        // resolved before this session existed.
        this.deps.cache.subscribe(
            this.videoId,
            (event) => this.onSubtitleEvent(event),
            this.signal
        );
        this.mediaBinding.start();
        if (this.deps.bridge.connected) {
            this.adapter.onBridgeConnected?.();
        }
        this.state = 'active';
        this.logger.info('Session started', { videoId: this.videoId });
    }

    onBridgeConnected(): void {
        if (this.state === 'active') {
            this.adapter.onBridgeConnected?.();
        }
    }

    onSubtitleEvent(event: CapturedEvent): void {
        if (this.state === 'ending' || this.state === 'ended') {
            return;
        }
        this.latestSubtitleEvent = event;
        if (!this.settings.subtitlesEnabled) {
            return;
        }
        const source = this.adapter.interpretSubtitleEvent(event);
        if (!source) {
            return;
        }
        if (source.kind === 'unavailable') {
            this.setLoading(false);
            return;
        }
        runScoped(this.requestSubtitles(source));
    }

    /** Reload subtitles for new languages; the current cues stay on screen
     *  behind a placeholder until the new set arrives. */
    updateLanguages(next: SubtitleLanguages): void {
        const current = this.languagesValue;
        if (
            next.originalLanguage === current.originalLanguage &&
            next.targetLanguage === current.targetLanguage &&
            next.useOfficialTranslations === current.useOfficialTranslations
        ) {
            return;
        }
        this.languagesValue = next;
        this.completedKey = null;
        this.setLoading(true);
        this.adapter.onLanguagesChanged?.();
        if (this.latestSubtitleEvent) {
            this.onSubtitleEvent(this.latestSubtitleEvent);
        }
    }

    private setLoading(loading: boolean): void {
        this.loadingToken += 1;
        this.renderer.setLoading(loading);
        if (!loading) {
            return;
        }
        const token = this.loadingToken;
        scopedTimeout(
            this.signal,
            () => {
                if (token === this.loadingToken) {
                    this.logger.warn('Subtitles did not arrive in time');
                    this.setLoading(false);
                }
            },
            SUBTITLE_LOADING_TIMEOUT_MS
        );
    }

    onPlatformEvent(event: CapturedEvent): void {
        if (this.state === 'active') {
            this.adapter.onPlatformEvent(event);
        }
    }

    /** Display settings from storage or from a popup live preview. */
    applySettings(changes: Partial<SettingsValues>): void {
        let displayChanged = false;
        for (const key of CONTENT_SETTINGS_KEYS) {
            if (changes[key] !== undefined) {
                (this.settings as Record<string, unknown>)[key] = changes[key];
                if (key !== 'subtitlesEnabled') {
                    displayChanged = true;
                }
            }
        }
        if (displayChanged) {
            this.renderer.setDisplay(toDisplaySettings(this.settings));
        }
        if (changes.subtitlesEnabled !== undefined) {
            this.renderer.setVisible(changes.subtitlesEnabled);
            this.translation?.scheduler.setActive(changes.subtitlesEnabled);
            if (
                changes.subtitlesEnabled &&
                this.rendererState.cues.length === 0 &&
                this.latestSubtitleEvent
            ) {
                this.onSubtitleEvent(this.latestSubtitleEvent);
            }
        }
        for (const key of INTERACTION_SETTINGS_KEYS) {
            if (changes[key] !== undefined) {
                (this.interaction as Record<string, unknown>)[key] =
                    changes[key];
            }
        }
        if (changes.aiContextEnabled !== undefined) {
            // The panel learns the selection is gone before the words stop
            // being clickable.
            if (!changes.aiContextEnabled) {
                this.selection.clear();
            }
            this.renderer.setInteractive(changes.aiContextEnabled);
        }
    }

    private onWordIntent(intent: WordIntent): void {
        if (!this.selection.toggle(intent)) {
            return;
        }
        runScoped(this.sendWordIntent());
    }

    /** Tell the background a word was clicked so it can open the panel and
     *  pause playback per the gesture-time settings. */
    private async sendWordIntent(): Promise<void> {
        try {
            await sendMessage(sidePanelWordSelected, {
                action: 'sidePanelWordSelected',
                options: {
                    autoOpen: this.interaction.sidePanelAutoOpen,
                    pauseVideo: this.interaction.sidePanelAutoPauseVideo,
                },
            });
        } catch (error) {
            if (isContextInvalidated(error)) {
                this.deps.onContextInvalidated();
                return;
            }
            this.logger.debug('Word intent not delivered', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
        }
    }

    private async publishSelection(
        snapshot: ContentSelectionSnapshot,
        canDispatch: () => boolean
    ): Promise<boolean> {
        try {
            const response = await sendWithRetry(
                sidePanelSelectionSync,
                { action: 'sidePanelSelectionSync', data: snapshot },
                {
                    retries: 2,
                    baseDelayMs: 120,
                    pingBeforeRetry: false,
                    canDispatch: () => !this.signal.aborted && canDispatch(),
                }
            );
            return response.success;
        } catch (error) {
            if (!this.signal.aborted && isContextInvalidated(error)) {
                this.deps.onContextInvalidated();
            }
            return false;
        }
    }

    /** Pause through the platform first; a direct media pause is the
     *  fallback only where the platform tolerates it. */
    async pauseVideo(): Promise<boolean> {
        const video = this.mediaBinding.current?.video;
        if (!video) {
            return false;
        }
        if (video.paused || video.ended) {
            return true;
        }
        try {
            if (await this.adapter.pause(video)) {
                return true;
            }
        } catch (error) {
            this.logger.warn('Platform pause failed', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
        }
        if (!this.deps.descriptor.capabilities.directMediaControl) {
            return false;
        }
        video.pause();
        return video.paused;
    }

    private async requestSubtitles(spec: SubtitleFetchSpec): Promise<void> {
        const { originalLanguage, targetLanguage, useOfficialTranslations } =
            this.languagesValue;
        const key = JSON.stringify([spec, this.languagesValue]);
        if (key === this.completedKey || key === this.inFlightKey) {
            return;
        }
        this.inFlightKey = key;
        this.requestSequence += 1;
        const sequence = this.requestSequence;
        try {
            const request: FetchVttRequest =
                spec.kind === 'netflix-tracks'
                    ? {
                          action: 'fetchVTT',
                          source: 'netflix',
                          videoId: this.videoId,
                          targetLanguage,
                          originalLanguage,
                          useOfficialTranslations,
                          data: { tracks: spec.tracks },
                      }
                    : {
                          action: 'fetchVTT',
                          source: 'disneyplus',
                          videoId: this.videoId,
                          url: spec.url,
                          targetLanguage,
                          originalLanguage,
                      };

            const response = await sendWithRetry(fetchVtt, request, {
                retries: 3,
                baseDelayMs: 150,
                canDispatch: () => !this.signal.aborted,
            });
            ensureLive(this.signal);
            if (sequence !== this.requestSequence) {
                return;
            }

            if (response.success) {
                this.completedKey = key;
                const cueSet = buildCueSet(response);
                this.rendererState.loadCues(cueSet);
                this.setLoading(false);
                this.startTranslation(cueSet);
                this.logger.info('Subtitles loaded', {
                    cueCount: cueSet.cues.length,
                    useNativeTarget: cueSet.useNativeTarget,
                });
            } else {
                this.setLoading(false);
                this.logger.warn('Subtitle request failed', {
                    error: response.error,
                    stage: response.stage,
                });
            }
        } catch (error) {
            if (this.signal.aborted) {
                return;
            }
            if (isContextInvalidated(error)) {
                this.deps.onContextInvalidated();
                return;
            }
            if (sequence === this.requestSequence) {
                this.setLoading(false);
            }
            this.logger.error('Subtitle request errored', error);
        } finally {
            if (this.inFlightKey === key) {
                this.inFlightKey = null;
            }
        }
    }

    private startTranslation(cueSet: CueSet): void {
        this.translation?.scope.abort();
        this.translation = null;
        if (cueSet.useNativeTarget) {
            return;
        }
        const scope = childScope(this.signal);
        const scheduler = new TranslationScheduler({
            cues: cueSet.cues,
            videoId: this.videoId,
            targetLanguage: cueSet.targetLanguage,
            currentTime: () => this.renderer.currentTime,
            send: (request) => this.sendTranslate(request, scope.signal),
            onTranslated: () => this.renderer.cuesChanged(),
            signal: scope.signal,
            logger: this.logger,
        });
        this.translation = { scheduler, scope };
        scheduler.start();
        scheduler.setActive(this.settings.subtitlesEnabled);
    }

    private async sendTranslate(
        request: TranslateRequest,
        signal: AbortSignal
    ): Promise<TranslateResponse> {
        try {
            return await sendWithRetry(translate, request, {
                retries: 1,
                baseDelayMs: 500,
                canDispatch: () => !signal.aborted,
            });
        } catch (error) {
            if (!signal.aborted && isContextInvalidated(error)) {
                this.deps.onContextInvalidated();
            }
            throw error;
        }
    }

    /** Ordered teardown; idempotent. Returns memory for the successor. */
    end(reason: SessionEndReason): PlatformHandoff {
        if (this.state === 'ending' || this.state === 'ended') {
            return {
                mediaScope: this.mediaBinding.current,
                platformScratch: null,
            };
        }
        this.state = 'ending';
        this.logger.info('Session ending', { reason });
        // Page-world goodbyes ride the still-live bridge before abort.
        this.adapter.beforeAbort();
        this.controller.abort();
        this.renderer.destroy();
        const platformScratch = this.adapter.dispose();
        this.state = 'ended';
        return { mediaScope: this.mediaBinding.current, platformScratch };
    }
}
