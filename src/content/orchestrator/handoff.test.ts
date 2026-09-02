import { describe, expect, it } from 'vitest';
import type { PlatformHandoff } from '../platform/types';
import { carryHandoff } from './handoff';

const memory: PlatformHandoff = {
    mediaScope: { root: null, video: {} as HTMLVideoElement },
    platformScratch: {
        staleIdentity: { availId: 'a', playbackSessionId: 'p' },
    },
};

describe('carryHandoff', () => {
    it('hands memory across a video change, including leaving the player', () => {
        expect(carryHandoff(memory, '1', '2')).toBe(memory);
        expect(carryHandoff(memory, '1', null)).toBe(memory);
    });

    it('hands nothing to a restart on the same video', () => {
        expect(carryHandoff(memory, '1', '1')).toBeNull();
    });
});
