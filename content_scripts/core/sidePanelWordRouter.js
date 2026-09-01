import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from '../shared/messaging.js';
import {
    buildSidePanelWordIntentMessage,
    parseSidePanelContentSelectionSnapshotResponse,
} from '../shared/protocol/messageProtocol.js';

export class SidePanelWordRouter {
    constructor(isCurrent, onError = () => {}) {
        this.isCurrent = isCurrent;
        this.onError = onError;
        this.initialized = false;
        this.destroyed = false;
        this.useSidePanel = false;
        this.autoOpen = true;
        this.autoPauseVideo = true;
        this.onStorageChanged = null;
    }

    async initialize() {
        if (this.initialized) return true;
        if (this.destroyed || !this.isCurrent()) return false;
        await this.refreshSettings();
        if (this.destroyed || !this.isCurrent()) return false;

        this.onStorageChanged = (changes, area) => {
            if (
                area === 'sync' &&
                (changes.sidePanelUseSidePanel ||
                    changes.sidePanelAutoOpen ||
                    changes.sidePanelAutoPauseVideo)
            ) {
                void this.refreshSettings();
            }
        };
        chrome.storage.onChanged.addListener(this.onStorageChanged);
        this.initialized = true;
        return true;
    }

    async refreshSettings() {
        try {
            const settings = await chrome.storage.sync.get([
                'sidePanelUseSidePanel',
                'sidePanelAutoOpen',
                'sidePanelAutoPauseVideo',
            ]);
            this.useSidePanel = settings.sidePanelUseSidePanel !== false;
            this.autoOpen = settings.sidePanelAutoOpen !== false;
            this.autoPauseVideo = settings.sidePanelAutoPauseVideo !== false;
        } catch {
            this.useSidePanel = false;
            this.autoOpen = false;
            this.autoPauseVideo = false;
        }
    }

    notifyWordIntent(onExplicitFailure) {
        if (
            this.destroyed ||
            !this.initialized ||
            !this.useSidePanel ||
            !this.isCurrent()
        ) {
            return false;
        }
        const message = buildSidePanelWordIntentMessage({
            autoOpen: this.autoOpen,
            pauseVideo: this.autoPauseVideo,
        });
        void sendRuntimeMessageWithRetry(message, {
            retries: 2,
            baseDelayMs: 120,
            canDispatch: () => !this.destroyed && this.isCurrent(),
        }).then(
            (response) => {
                if (
                    parseSidePanelContentSelectionSnapshotResponse(response)
                        ?.status === 'rejected'
                ) {
                    onExplicitFailure?.();
                }
            },
            (error) => {
                if (isProvenMessagingNonDelivery(error)) {
                    onExplicitFailure?.();
                } else {
                    this.onError();
                }
            }
        );
        return true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.onStorageChanged) {
            chrome.storage.onChanged.removeListener(this.onStorageChanged);
            this.onStorageChanged = null;
        }
        this.initialized = false;
    }
}
