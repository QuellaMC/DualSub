import { createLogger, setLoggingLevel } from '@/shared/logger';
import { configService } from '@/config/service';
import { MessageRouter } from '@/messaging/router';
import { loggingLevelChanged } from '@/messaging/contracts/control';
import { IsolatedBridge } from '../bridge/IsolatedBridge';
import type { CapturedEvent } from '../bridge/protocol';
import { SubtitleEventCache } from '../bridge/SubtitleEventCache';
import type { PlatformDescriptor, PlatformHandoff } from '../platform/types';
import { UiRoot } from '../renderer/domLayer';
import { NavigationWatcher } from './NavigationWatcher';
import {
    CONTENT_SETTINGS_KEYS,
    FETCH_SETTINGS_KEYS,
    PlayerSession,
    type ContentSettings,
    type SessionEndReason,
} from './PlayerSession';

type ReconcileTrigger = 'boot' | 'navigation' | 'bridge-event' | 'config';

/**
 * Document root of the content side. Owns document-lifetime services (page
 * bridge, navigation watcher, overlay root, event cache) and runs the one
 * rule that replaces the old adoption flags: the route's videoId decides
 * which single PlayerSession exists.
 */
export class ContentOrchestrator {
    private readonly controller = new AbortController();
    private readonly logger;
    private readonly cache = new SubtitleEventCache();
    private readonly uiRoot: UiRoot;
    private readonly bridge: IsolatedBridge;
    private readonly router = new MessageRouter();
    private activeSession: PlayerSession | null = null;
    private handoff: PlatformHandoff | null = null;
    private sessionCounter = 0;
    private reconciling = false;
    private pendingReconcile: { force: boolean } | null = null;
    private tornDown = false;

    constructor(private readonly descriptor: PlatformDescriptor) {
        this.logger = createLogger(`Content:${descriptor.id}`);
        this.uiRoot = new UiRoot(this.controller.signal);
        this.bridge = new IsolatedBridge(descriptor.id, {
            onEvent: (event) => this.onBridgeEvent(event),
            logger: this.logger,
        });
    }

    start(): void {
        const { signal } = this.controller;

        this.router.handle(loggingLevelChanged, (request) => {
            setLoggingLevel(request.level);
            return { success: true as const };
        });
        this.router.listen();
        void configService.get('loggingLevel').then((level) => {
            if (!signal.aborted) {
                setLoggingLevel(level);
            }
        });

        this.bridge.start();
        new NavigationWatcher(() => this.requestReconcile('navigation')).start(
            signal
        );

        const unsubscribe = configService.onChanged((changes) => {
            if (FETCH_SETTINGS_KEYS.some((key) => changes[key] !== undefined)) {
                this.requestReconcile('config', { force: true });
            }
        });
        signal.addEventListener('abort', unsubscribe, { once: true });

        this.requestReconcile('boot');
        this.logger.info('Content orchestrator started');
    }

    private onBridgeEvent(event: CapturedEvent): void {
        const classification = this.descriptor.classifyBridgeEvent(event);
        if (!classification) {
            return;
        }
        if (classification.kind === 'subtitle') {
            this.cache.publish(classification.videoId, event);
            this.requestReconcile('bridge-event');
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
    requestReconcile(
        trigger: ReconcileTrigger,
        options: { force?: boolean } = {}
    ): void {
        if (this.tornDown) {
            return;
        }
        const force = options.force ?? false;
        if (this.reconciling) {
            this.pendingReconcile = {
                force: force || (this.pendingReconcile?.force ?? false),
            };
            return;
        }
        this.reconciling = true;
        try {
            this.reconcile(trigger, force);
        } finally {
            this.reconciling = false;
        }
        const pending = this.pendingReconcile;
        if (pending) {
            this.pendingReconcile = null;
            this.requestReconcile(trigger, pending);
        }
    }

    private reconcile(trigger: ReconcileTrigger, force: boolean): void {
        const desired = this.descriptor.parseVideoIdFromUrl(location.href);
        const active = this.activeSession;
        if (active && active.videoId === desired && !force) {
            return;
        }
        if (active) {
            const reason: SessionEndReason =
                trigger === 'config'
                    ? 'config-restart'
                    : desired
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
        const settings = await this.readContentSettings();
        // The route may have moved on while settings were loading.
        if (
            this.tornDown ||
            this.activeSession ||
            this.descriptor.parseVideoIdFromUrl(location.href) !== videoId
        ) {
            return;
        }
        this.sessionCounter += 1;
        const session = new PlayerSession({
            id: this.sessionCounter,
            videoId,
            descriptor: this.descriptor,
            bridge: this.bridge,
            cache: this.cache,
            uiRoot: this.uiRoot,
            handoff: this.handoff,
            settings,
            onNavigationMismatch: () => this.requestReconcile('navigation'),
            onContextInvalidated: () => this.teardown('context-invalidated'),
        });
        this.activeSession = session;
        this.handoff = null;
        session.start();
    }

    private async readContentSettings(): Promise<ContentSettings> {
        const values = await configService.getMultiple(CONTENT_SETTINGS_KEYS);
        return values as ContentSettings;
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
