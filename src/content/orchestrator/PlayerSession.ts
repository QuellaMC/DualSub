import { createLogger } from '@/shared/logger';
import type { SiteConfig } from '@/config/service';
import { getDefaultValue, type SettingsValues } from '@/config/schema';
import {
    isSameLanguage,
    normalizeLanguageCode,
} from '@/shared/languageNormalization';
import { AUTO_LANGUAGE } from '@/shared/subtitleLanguages';
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
import type { SubtitleLook } from '../renderer/looks';
import { toDisplaySettings } from '../renderer/styling';
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

const DISPLAY_SETTINGS_KEYS = [
    'subtitleStyle',
    'subtitleCustomLook',
    'subtitleTranslationColor',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleLayoutOrientation',
    'subtitleLayoutOrder',
    'subtitleTimeOffset',
] as const;

export const CONTENT_SETTINGS_KEYS = [
    'subtitlesEnabled',
    'hideOfficialSubtitles',
    ...DISPLAY_SETTINGS_KEYS,
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

export type LanguageSettings = Pick<
    SettingsValues,
    (typeof FETCH_SETTINGS_KEYS)[number]
>;

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

export function toLanguageSettings(
    values: Partial<LanguageSettings>
): LanguageSettings {
    return {
        originalLanguage:
            values.originalLanguage ?? getDefaultValue('originalLanguage'),
        targetLanguage:
            values.targetLanguage ?? getDefaultValue('targetLanguage'),
        useOfficialTranslations:
            values.useOfficialTranslations ??
            getDefaultValue('useOfficialTranslations'),
    };
}

/**
 * The concrete languages for the session. An automatic top line takes the
 * language the player says is spoken, or English when the player could not
 * tell (`null`); it is null itself while the player has not reported yet
 * (`undefined`).
 */
export function resolveSubtitleLanguages(
    settings: LanguageSettings,
    spokenLanguage: string | null | undefined
): SubtitleLanguages | null {
    const { originalLanguage, targetLanguage, useOfficialTranslations } =
        settings;
    if (originalLanguage !== AUTO_LANGUAGE) {
        return { originalLanguage, targetLanguage, useOfficialTranslations };
    }
    if (spokenLanguage === undefined) {
        return null;
    }
    return {
        originalLanguage:
            spokenLanguage === null
                ? 'en'
                : normalizeLanguageCode(spokenLanguage),
        targetLanguage,
        useOfficialTranslations,
    };
}

function sameSubtitleLanguages(
    left: SubtitleLanguages | null,
    right: SubtitleLanguages | null
): boolean {
    return (
        left === right ||
        (left !== null &&
            right !== null &&
            left.originalLanguage === right.originalLanguage &&
            left.targetLanguage === right.targetLanguage &&
            left.useOfficialTranslations === right.useOfficialTranslations)
    );
}

function isContextInvalidated(error: unknown): boolean {
    return error instanceof Error && /context invalidated/i.test(error.message);
}

export interface PlayerSessionDeps {
    readonly id: number;
    readonly videoId: string;
    readonly descriptor: PlatformDescriptor;
    /** The settings as this platform's site sees them. */
    readonly config: SiteConfig;
    readonly bridge: BridgeControlSender;
    readonly cache: SubtitleEventCache;
    readonly uiRoot: UiRoot;
    readonly handoff: PlatformHandoff | null;
    /** The viewer's platform subtitle appearance, when already reported. */
    readonly platformLook: SubtitleLook | null;
    readonly settings: ContentSettings;
    readonly languageSettings: LanguageSettings;
    readonly interaction: InteractionSettings;
    readonly onNavigationMismatch: () => void;
    readonly onContextInvalidated: () => void;
}

/**
 * Everything that lives exactly as long as one video is on the player
 * route. One AbortSignal is the lifetime: listeners, timers, the frame
 * loop, and in-flight requests all die with it, so a stale continuation
 * cannot touch a successor session. Settings changes come in through
 * `applySettings` from whoever read its settings.
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
    /** Shows or hides the site's own subtitles in the bound media. */
    private hideNativeSubs: ((hidden: boolean) => void) | null = null;
    private settings: ContentSettings;
    private languageSettings: LanguageSettings;
    /** What the player reported as spoken: undefined until it reports,
     *  null when it could not tell. */
    private spokenLanguage: string | null | undefined;
    private languagesValue: SubtitleLanguages | null;
    private interaction: InteractionSettings;
    private latestSubtitleEvent: CapturedEvent | null = null;
    private loadingToken = 0;
    private completedKey: string | null = null;
    /** The request whose answer the session waits for. A newer request or a
     *  languages change replaces it, so a slower earlier answer never
     *  overwrites newer cues. */
    private pendingRequest: { readonly key: string } | null = null;
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
        this.languageSettings = deps.languageSettings;
        this.languagesValue = resolveSubtitleLanguages(
            deps.languageSettings,
            undefined
        );
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
                config: deps.config,
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
            platformLook: deps.platformLook,
            videoId: deps.videoId,
            uiRoot: deps.uiRoot,
            signal: this.signal,
            logger: this.logger,
            onNavigationMismatch: deps.onNavigationMismatch,
            onSeek: () => this.translation?.scheduler.kick(),
            onOriginalPainted: (revision) =>
                this.selection.onSubtitleChange(revision),
            onWordIntent: (intent) => this.onWordIntent(intent),
            wordLanguage: () => this.languagesValue?.originalLanguage ?? 'en',
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
                this.hideNativeSubs = installNativeSubHider(
                    this.adapter.nativeSubRecipe,
                    media,
                    { signal: this.mediaScope.signal, logger: this.logger },
                    this.nativeSubsHidden()
                );
                this.translation?.scheduler.kick();
            },
            onLost: () => {
                this.mediaScope?.abort();
                this.mediaScope = null;
                this.hideNativeSubs = null;
                this.renderer.detachMedia();
            },
            signal: this.signal,
            logger: this.logger,
        });
    }

    /** Its video is bound, so its subtitles can show there. */
    get hasMedia(): boolean {
        return this.mediaBinding.current !== null;
    }

    /** The language the top line shows; null until it is known. */
    get topLanguage(): string | null {
        return this.languagesValue?.originalLanguage ?? null;
    }

    start(): void {
        this.renderer.setVisible(this.settings.subtitlesEnabled);
        this.renderer.setInteractive(this.interaction.aiContextEnabled);
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
            this.connectPageWorld();
        }
        this.state = 'active';
        this.logger.info('Session started', { videoId: this.videoId });
    }

    onBridgeConnected(): void {
        if (this.state === 'active') {
            this.connectPageWorld();
        }
    }

    /** Every platform reports the spoken language the same way; the rest
     *  of the page-world setup is the adapter's. */
    private connectPageWorld(): void {
        this.deps.bridge.sendControl({
            t: 'watch-spoken-language',
            videoId: this.videoId,
        });
        this.adapter.onBridgeConnected?.();
    }

    onSubtitleEvent(event: CapturedEvent): void {
        if (this.state === 'ending' || this.state === 'ended') {
            return;
        }
        this.latestSubtitleEvent = event;
        if (!this.settings.subtitlesEnabled || !this.languagesValue) {
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

    updateLanguageSettings(next: LanguageSettings): void {
        this.languageSettings = next;
        this.applyLanguages();
    }

    /** The player reported the language of the audio playing. */
    updateSpokenLanguage(language: string | null): void {
        if (language !== this.spokenLanguage) {
            this.spokenLanguage = language;
            this.applyLanguages();
        }
    }

    /** Reload subtitles when the concrete languages change; the current cues
     *  stay on screen behind a placeholder until the new set arrives. */
    private applyLanguages(): void {
        const next = resolveSubtitleLanguages(
            this.languageSettings,
            this.spokenLanguage
        );
        if (sameSubtitleLanguages(next, this.languagesValue)) {
            return;
        }
        this.languagesValue = next;
        this.completedKey = null;
        this.pendingRequest = null;
        this.setLoading(true);
        this.adapter.onLanguagesChanged?.();
        if (this.latestSubtitleEvent) {
            this.onSubtitleEvent(this.latestSubtitleEvent);
        }
    }

    /** The page reported the viewer's platform subtitle appearance. */
    updatePlatformLook(look: SubtitleLook | null): void {
        this.renderer.setPlatformLook(look);
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

    /** The site's own subtitles hide only while DualSub shows its lines. */
    private nativeSubsHidden(): boolean {
        return (
            this.settings.hideOfficialSubtitles &&
            this.settings.subtitlesEnabled
        );
    }

    /** Follow a change to the settings as the site sees them. */
    applySettings(changes: Partial<SettingsValues>): void {
        if (FETCH_SETTINGS_KEYS.some((key) => changes[key] !== undefined)) {
            this.updateLanguageSettings(
                toLanguageSettings({
                    ...this.languageSettings,
                    ...changes,
                })
            );
        }
        for (const key of CONTENT_SETTINGS_KEYS) {
            if (changes[key] !== undefined) {
                (this.settings as Record<string, unknown>)[key] = changes[key];
            }
        }
        if (DISPLAY_SETTINGS_KEYS.some((key) => changes[key] !== undefined)) {
            this.renderer.setDisplay(toDisplaySettings(this.settings));
        }
        if (
            changes.subtitlesEnabled !== undefined ||
            changes.hideOfficialSubtitles !== undefined
        ) {
            this.hideNativeSubs?.(this.nativeSubsHidden());
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
        const languages = this.languagesValue;
        if (!languages) {
            return;
        }
        const { originalLanguage, targetLanguage, useOfficialTranslations } =
            languages;
        const key = JSON.stringify([spec, languages]);
        if (key === this.completedKey || key === this.pendingRequest?.key) {
            return;
        }
        const pending = { key };
        this.pendingRequest = pending;
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
                          useOfficialTranslations,
                      };

            const response = await sendWithRetry(fetchVtt, request, {
                retries: 3,
                baseDelayMs: 150,
                canDispatch: () => !this.signal.aborted,
            });
            ensureLive(this.signal);
            if (pending !== this.pendingRequest) {
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
            if (pending === this.pendingRequest) {
                this.setLoading(false);
            }
            this.logger.error('Subtitle request errored', error);
        } finally {
            if (this.pendingRequest === pending) {
                this.pendingRequest = null;
            }
        }
    }

    private startTranslation(cueSet: CueSet): void {
        this.translation?.scope.abort();
        this.translation = null;
        // A video already in the target language keeps its one line.
        if (
            cueSet.useNativeTarget ||
            isSameLanguage(cueSet.sourceLanguage, cueSet.targetLanguage)
        ) {
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
        this.deps.bridge.sendControl({ t: 'unwatch-spoken-language' });
        this.adapter.beforeAbort();
        this.controller.abort();
        this.renderer.destroy();
        const platformScratch = this.adapter.dispose();
        this.state = 'ended';
        return { mediaScope: this.mediaBinding.current, platformScratch };
    }
}
