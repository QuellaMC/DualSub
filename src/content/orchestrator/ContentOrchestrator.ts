import { createLogger, setLoggingLevel } from '@/shared/logger';
import type { SettingsValues } from '@/config/schema';
import { configService, type SiteConfig } from '@/config/service';
import { MessageRouter } from '@/messaging/router';
import {
    loggingLevelChanged,
    playerStatus,
    sidePanelPauseVideo,
} from '@/messaging/contracts/control';
import {
    selectionRemovalCommand,
    selectionRepublishRequest,
} from '@/messaging/contracts/selection';
import { IsolatedBridge } from '../bridge/IsolatedBridge';
import type { CapturedEvent } from '../bridge/protocol';
import { SubtitleEventCache } from '../bridge/SubtitleEventCache';
import type { PlatformDescriptor, PlatformHandoff } from '../platform/types';
import { UiRoot } from '../renderer/domLayer';
import type { SubtitleLook } from '../renderer/looks';
import { NavigationWatcher } from './NavigationWatcher';
import {
    CONTENT_SETTINGS_KEYS,
    FETCH_SETTINGS_KEYS,
    INTERACTION_SETTINGS_KEYS,
    PlayerSession,
    toLanguageSettings,
    type ContentSettings,
    type InteractionSettings,
    type SessionEndReason,
} from './PlayerSession';

const SESSION_SETTINGS_KEYS = [
    ...CONTENT_SETTINGS_KEYS,
    ...FETCH_SETTINGS_KEYS,
    ...INTERACTION_SETTINGS_KEYS,
];

/**
 * Document root of the content side. Owns document-lifetime services (page
 * bridge, navigation watcher, overlay root, event cache) and runs the one
 * rule that replaces the old adoption flags: the route's videoId decides
 * which single PlayerSession exists.
 */
export class ContentOrchestrator {
    private readonly controller = new AbortController();
    private readonly logger;
    private readonly config: SiteConfig;
    private readonly cache = new SubtitleEventCache();
    private readonly uiRoot: UiRoot;
    private readonly bridge: IsolatedBridge;
    private readonly router = new MessageRouter();
    private activeSession: PlayerSession | null = null;
    /** For each session's settings read still out, the changes heard since
     *  it began, which are newer than its answer. */
    private readonly reads = new Set<Partial<SettingsValues>>();
    private handoff: PlatformHandoff | null = null;
    /** The viewer's platform subtitle appearance; profile-wide, so it
     *  outlives sessions. */
    private platformLook: SubtitleLook | null = null;
    private sessionCounter = 0;
    private reconciling = false;
    private pendingReconcile = false;
    private tornDown = false;

    constructor(private readonly descriptor: PlatformDescriptor) {
        this.logger = createLogger(`Content:${descriptor.id}`);
        this.config = configService.forSite(descriptor.id);
        this.uiRoot = new UiRoot(this.controller.signal);
        this.bridge = new IsolatedBridge(descriptor.id, {
            onEvent: (event) => this.onBridgeEvent(event),
            onConnected: () => this.activeSession?.onBridgeConnected(),
            logger: this.logger,
        });
    }

    start(): void {
        const { signal } = this.controller;

        this.router.handle(loggingLevelChanged, (request) => {
            setLoggingLevel(request.level);
            return { success: true as const };
        });
        this.router.handle(playerStatus, () => {
            const session = this.activeSession;
            return session?.hasMedia === true
                ? { onPlayer: true, topLanguage: session.topLanguage }
                : { onPlayer: false, topLanguage: null };
        });
        // Side panel traffic addresses the selection of whichever session is
        // on the route; with no session there is nothing to answer for.
        this.router.handle(
            selectionRepublishRequest,
            (request) =>
                this.activeSession?.selection.handleRepublish(
                    request.data.requestId
                ) ?? {
                    requestId: request.data.requestId,
                    result: 'empty' as const,
                }
        );
        this.router.handle(
            selectionRemovalCommand,
            (request) =>
                this.activeSession?.selection.handleRemoval(request.data) ?? {
                    success: false,
                    requestId: request.data.requestId,
                }
        );
        this.router.handle(sidePanelPauseVideo, async () =>
            (await this.activeSession?.pauseVideo())
                ? { success: true as const }
                : { success: false as const, error: 'No video to pause' }
        );
        this.router.listen();
        void configService.syncLoggingLevel();

        this.bridge.start();
        new NavigationWatcher(() => this.requestReconcile()).start(signal);

        // The one subscription, made before any session reads its settings:
        // a change heard while a read is out lands on top of its answer, and
        // every later one reaches the session on the route.
        const unsubscribe = this.config.onChanged((changes) => {
            for (const heard of this.reads) {
                Object.assign(heard, changes);
            }
            this.activeSession?.applySettings(changes);
        });
        signal.addEventListener('abort', unsubscribe, { once: true });

        this.requestReconcile();
        this.logger.info('Content orchestrator started');
    }

    private onBridgeEvent(event: CapturedEvent): void {
        const classification = this.descriptor.classifyBridgeEvent(event);
        if (!classification) {
            return;
        }
        if (classification.kind === 'subtitle') {
            this.cache.publish(classification.videoId, event);
            this.requestReconcile();
            return;
        }
        if (classification.kind === 'spoken-language') {
            if (this.activeSession?.videoId === classification.videoId) {
                this.activeSession.updateSpokenLanguage(
                    classification.language
                );
            }
            return;
        }
        if (classification.kind === 'appearance') {
            this.platformLook = this.descriptor.parsePlatformLook(
                classification.appearance
            );
            if (!this.platformLook) {
                this.logger.warn('Platform subtitle appearance not understood');
            }
            this.activeSession?.updatePlatformLook(this.platformLook);
            return;
        }
        const session = this.activeSession;
        if (
            session &&
            (classification.videoId === null ||
                classification.videoId === session.videoId)
        ) {
            session.onPlatformEvent(event);
        }
    }

    /** Serialized, latest-wins: a fast A→B→A cannot interleave teardown
     *  and startup. */
    requestReconcile(): void {
        if (this.tornDown) {
            return;
        }
        if (this.reconciling) {
            this.pendingReconcile = true;
            return;
        }
        this.reconciling = true;
        try {
            this.reconcile();
        } finally {
            this.reconciling = false;
        }
        if (this.pendingReconcile) {
            this.pendingReconcile = false;
            this.requestReconcile();
        }
    }

    /** The route's videoId decides which single session exists; a session
     *  ends only when the route leaves its video, so the memory it hands on
     *  always describes a different video's player. */
    private reconcile(): void {
        const desired = this.descriptor.parseVideoIdFromUrl(location.href);
        const active = this.activeSession;
        if (active && active.videoId === desired) {
            return;
        }
        if (active) {
            const reason: SessionEndReason = desired
                ? 'navigation'
                : 'left-player-page';
            this.handoff = active.end(reason);
            this.activeSession = null;
        }
        if (!desired) {
            return;
        }
        void this.startSession(desired);
    }

    private async startSession(videoId: string): Promise<void> {
        const heard: Partial<SettingsValues> = {};
        this.reads.add(heard);
        let stored: Partial<SettingsValues>;
        try {
            stored = await this.config.getMultiple(SESSION_SETTINGS_KEYS);
        } finally {
            this.reads.delete(heard);
        }
        // The route may have moved on while settings were loading.
        if (
            this.tornDown ||
            this.activeSession ||
            this.descriptor.parseVideoIdFromUrl(location.href) !== videoId
        ) {
            return;
        }
        const values = { ...stored, ...heard };
        this.sessionCounter += 1;
        const session = new PlayerSession({
            id: this.sessionCounter,
            videoId,
            descriptor: this.descriptor,
            config: this.config,
            bridge: this.bridge,
            cache: this.cache,
            uiRoot: this.uiRoot,
            handoff: this.handoff,
            platformLook: this.platformLook,
            settings: values as ContentSettings,
            languageSettings: toLanguageSettings(values),
            interaction: values as InteractionSettings,
            onNavigationMismatch: () => this.requestReconcile(),
            onContextInvalidated: () => this.teardown('context-invalidated'),
        });
        this.activeSession = session;
        this.handoff = null;
        session.start();
    }

    teardown(reason: SessionEndReason): void {
        if (this.tornDown) {
            return;
        }
        this.tornDown = true;
        this.logger.info('Content orchestrator tearing down', { reason });
        this.activeSession?.end(reason);
        this.activeSession = null;
        this.bridge.close();
        this.controller.abort();
        this.cache.clear();
    }
}
