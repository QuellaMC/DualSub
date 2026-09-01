import { describe, expect, jest, test } from '@jest/globals';
import {
    AI_CONTEXT_SIGNAL_TYPES,
    createAIContextChannel,
} from '../core/AIContextChannel.js';

const wordIntent = () => ({
    action: 'toggle',
    renderRevision: 1,
    wordIndex: 0,
    word: 'bonjour',
    sourceLanguage: 'fr',
    targetLanguage: 'en',
});

describe('AIContextChannel', () => {
    test('exposes the signal names used by the AI-context collaborators', () => {
        expect(AI_CONTEXT_SIGNAL_TYPES).toEqual({
            WORD_INTENT: 'WORD_INTENT',
            SUBTITLE_CHANGED: 'SUBTITLE_CHANGED',
            SELECTION_SNAPSHOT: 'SELECTION_SNAPSHOT',
            ANALYSIS_REQUEST: 'ANALYSIS_REQUEST',
            ANALYSIS_CANCEL: 'ANALYSIS_CANCEL',
            ANALYSIS_SETTLED: 'ANALYSIS_SETTLED',
        });
    });

    test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])(
        'rejects invalid lifecycle generation %#',
        (lifecycleGeneration) => {
            expect(() =>
                createAIContextChannel({ lifecycleGeneration })
            ).toThrow(TypeError);
        }
    );

    test('publishes a lifecycle envelope to subscribers of one signal', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 7 });
        const listener = jest.fn();
        const otherListener = jest.fn();
        const payload = wordIntent();

        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, listener);
        channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            otherListener
        );

        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, payload)
        ).toBe(1);
        expect(listener).toHaveBeenCalledWith({
            type: AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT,
            lifecycleGeneration: 7,
            payload,
        });
        expect(otherListener).not.toHaveBeenCalled();
    });

    test('rejects unknown signals and non-function subscribers', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 1 });

        expect(channel.publish('UNKNOWN', {})).toBe(0);
        expect(() => channel.subscribe('UNKNOWN', () => {})()).not.toThrow();
        expect(() =>
            channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, null)()
        ).not.toThrow();
    });

    test('applies subscription changes to the next publication', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 2 });
        const calls = [];
        const sharedListener = () => calls.push('shared');
        let removeSecond;

        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, () => {
            calls.push('first');
            removeSecond();
            channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, () => {
                calls.push('late');
            });
        });
        removeSecond = channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT,
            sharedListener
        );
        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, sharedListener);

        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, wordIntent())
        ).toBe(3);
        expect(calls).toEqual(['first', 'shared', 'shared']);

        calls.length = 0;
        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, wordIntent())
        ).toBe(3);
        expect(calls).toEqual(['first', 'shared', 'late']);
    });

    test('isolates subscriber failures', async () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 3 });
        const finalListener = jest.fn();

        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED, () => {
            throw new Error('sync failure');
        });
        channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED,
            async () => {
                throw new Error('async failure');
            }
        );
        channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED,
            finalListener
        );

        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED, {
                requestId: 1,
                outcome: 'succeeded',
            })
        ).toBe(3);
        await Promise.resolve();
        expect(finalListener).toHaveBeenCalledTimes(1);
    });

    test('destroy revokes the channel immediately and is idempotent', () => {
        const channel = createAIContextChannel({ lifecycleGeneration: 4 });
        const calls = [];

        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL, () => {
            calls.push('destroy');
            channel.destroy();
        });
        channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL, () => {
            calls.push('late');
        });

        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL, {
                requestId: 1,
                reason: 'user',
            })
        ).toBe(1);
        expect(calls).toEqual(['destroy']);

        channel.destroy();
        expect(
            channel.publish(AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL, {})
        ).toBe(0);
        expect(() =>
            channel.subscribe(
                AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL,
                () => {}
            )()
        ).not.toThrow();
    });
});
