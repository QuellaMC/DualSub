// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    TimelineLocator,
    findPlayPauseButton,
    querySelectorDeep,
    readTimelineTime,
} from './controlsDom';

function mountPlayer(valueNow = 42): void {
    document.body.innerHTML = '';
    const player = document.createElement('disney-web-player-ui');
    const overlay = document.createElement('main-app-controls-overlay');
    const overlayShadow = overlay.attachShadow({ mode: 'open' });
    const progress = document.createElement('progress-bar');
    const progressShadow = progress.attachShadow({ mode: 'open' });
    const slider = document.createElement('div');
    slider.className = 'progress-bar__seekable-range';
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-valuenow', String(valueNow));
    slider.setAttribute('aria-valuemax', '3600');
    progressShadow.appendChild(slider);
    overlayShadow.appendChild(progress);

    const toggle = document.createElement('toggle-play-pause');
    const toggleShadow = toggle.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Play';
    toggleShadow.appendChild(button);
    player.appendChild(toggle);

    document.body.append(player, overlay);
}

describe('controlsDom', () => {
    beforeEach(() => {
        mountPlayer();
    });

    it('locates the timeline slider through nested shadow roots and caches it', () => {
        const locator = new TimelineLocator();
        const timeline = locator.locate();
        expect(timeline?.getAttribute('aria-valuenow')).toBe('42');
        expect(readTimelineTime(timeline)).toBe(42);
        expect(locator.locate()).toBe(timeline);
    });

    it('drops the cache when the element disconnects', () => {
        const locator = new TimelineLocator();
        const first = locator.locate();
        mountPlayer(7);
        expect(locator.locate()).not.toBe(first);
        expect(readTimelineTime(locator.locate())).toBe(7);
    });

    it('finds the play/pause button inside the toggle shadow root', () => {
        const button = findPlayPauseButton();
        expect(button?.textContent).toBe('Play');
    });

    it('querySelectorDeep searches every open shadow root', () => {
        expect(
            querySelectorDeep('.progress-bar__seekable-range')
        ).not.toBeNull();
        expect(querySelectorDeep('.does-not-exist')).toBeNull();
    });
});
