// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { selectBestVideo } from './adapter';

function fakeVideo(options: {
    visible: boolean;
    readyState: number;
    playing: boolean;
}): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'getBoundingClientRect', {
        value: () =>
            options.visible
                ? { width: 1280, height: 720 }
                : { width: 0, height: 0 },
    });
    Object.defineProperty(video, 'readyState', { value: options.readyState });
    Object.defineProperty(video, 'paused', { value: !options.playing });
    Object.defineProperty(video, 'currentTime', {
        value: options.playing ? 30 : 0,
    });
    return video;
}

describe('selectBestVideo', () => {
    it('prefers the visible, loaded, playing element', () => {
        const preview = fakeVideo({
            visible: false,
            readyState: 0,
            playing: false,
        });
        const main = fakeVideo({ visible: true, readyState: 4, playing: true });
        expect(selectBestVideo([preview, main])).toBe(main);
        expect(selectBestVideo([main, preview])).toBe(main);
    });

    it('returns the only candidate or null', () => {
        const only = fakeVideo({
            visible: false,
            readyState: 0,
            playing: false,
        });
        expect(selectBestVideo([only])).toBe(only);
        expect(selectBestVideo([])).toBeNull();
    });
});
