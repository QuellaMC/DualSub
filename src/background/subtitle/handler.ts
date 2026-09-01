import { createLogger } from '@/shared/logger';
import type { MessageRouter } from '@/messaging/router';
import {
    fetchVtt,
    type FetchVttResponse,
} from '@/messaging/contracts/fetchVtt';
import { whenServiceReady } from '../readiness';
import { authorizeSubtitleRequest } from './policy';
import {
    SUBTITLE_REQUEST_REJECTED_RESPONSE,
    SubtitleFlightTable,
} from './flights';
import {
    DisneySubtitleError,
    processSubtitleRequest,
    type SubtitleProcessingResult,
} from './service';
import { isCallerAbortError } from './parsers/netflix';

const logger = createLogger('SubtitleHandler');

function toSuccessResponse(result: SubtitleProcessingResult): FetchVttResponse {
    return {
        success: true,
        vttText: result.vttText,
        targetVttText: result.useNativeTarget ? result.targetVttText : null,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        useNativeTarget: result.useNativeTarget,
        selectedLanguage: result.selectedLanguage,
    };
}

function toFailureResponse(error: unknown): FetchVttResponse {
    if (isCallerAbortError(error)) {
        return SUBTITLE_REQUEST_REJECTED_RESPONSE;
    }
    if (error instanceof DisneySubtitleError) {
        return {
            success: false,
            error: 'Subtitle processing failed. Some subtitles may not be available.',
            stage: error.stage,
            errorCode: error.errorCode,
        };
    }
    return {
        success: false,
        error: 'Subtitle processing failed. Some subtitles may not be available.',
    };
}

export function registerSubtitleHandlers(router: MessageRouter): {
    destroy: () => void;
} {
    const flights = new SubtitleFlightTable();

    router.handle(fetchVtt, (request, sender) => {
        if (sender.role !== 'content') {
            return SUBTITLE_REQUEST_REJECTED_RESPONSE;
        }
        let snapshot;
        try {
            snapshot = authorizeSubtitleRequest(request, sender);
        } catch {
            logger.warn('Subtitle request rejected', { stage: 'authorize' });
            return SUBTITLE_REQUEST_REJECTED_RESPONSE;
        }

        return flights.admit(snapshot, async (signal) => {
            await whenServiceReady('subtitle');
            if (signal.aborted) {
                return SUBTITLE_REQUEST_REJECTED_RESPONSE;
            }
            try {
                return toSuccessResponse(
                    await processSubtitleRequest(snapshot, { signal })
                );
            } catch (error) {
                logger.error('Subtitle processing failed', null, {
                    stage: 'process',
                    source: snapshot.source,
                });
                return toFailureResponse(error);
            }
        });
    });

    return { destroy: () => flights.destroy() };
}
