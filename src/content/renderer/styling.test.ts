// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DUALSUB_LOOK, PLATFORM_LOOKS, resolveLook } from './looks';
import {
    applyDisplaySettings,
    createSubtitleElements,
    fontSizePx,
    type DisplaySettings,
} from './styling';

const display: DisplaySettings = {
    style: 'dualsub',
    fontScale: 1,
    gap: 0.3,
    verticalPosition: 2.8,
    orientation: 'column',
    order: 'original_top',
    timeOffset: 0,
};

describe('resolveLook', () => {
    it('picks the DualSub look or the platform preset', () => {
        expect(resolveLook('dualsub', 'netflix')).toBe(DUALSUB_LOOK);
        expect(resolveLook('dualsub', 'disneyplus')).toBe(DUALSUB_LOOK);
        expect(resolveLook('platform', 'netflix')).toBe(PLATFORM_LOOKS.netflix);
        expect(resolveLook('platform', 'disneyplus')).toBe(
            PLATFORM_LOOKS.disneyplus
        );
    });

    it('every look sizes text as a plausible fraction of the video', () => {
        for (const look of [DUALSUB_LOOK, ...Object.values(PLATFORM_LOOKS)]) {
            expect(look.sizeRatio).toBeGreaterThan(0.01);
            expect(look.sizeRatio).toBeLessThan(0.08);
        }
    });
});

describe('fontSizePx', () => {
    it('multiplies the look ratio by the video height and the scale', () => {
        expect(fontSizePx(DUALSUB_LOOK, display, 1000)).toBe(20);
        expect(
            fontSizePx(DUALSUB_LOOK, { ...display, fontScale: 1.5 }, 1000)
        ).toBe(30);
        expect(
            fontSizePx(DUALSUB_LOOK, { ...display, fontScale: 0.5 }, 333)
        ).toBe(3.33);
    });
});

describe('applyDisplaySettings', () => {
    it('paints the look and size onto both slots', () => {
        const elements = createSubtitleElements();
        applyDisplaySettings(elements, display, DUALSUB_LOOK, 1000);
        expect(elements.original.style.fontSize).toBe('20px');
        expect(elements.translated.style.fontSize).toBe('20px');
        expect(elements.original.style.fontWeight).toBe('normal');
        expect(elements.original.style.color).not.toBe(
            elements.translated.style.color
        );

        applyDisplaySettings(elements, display, PLATFORM_LOOKS.netflix, 1000);
        expect(elements.original.style.fontWeight).toBe('bold');
        expect(elements.original.style.backgroundColor).toBe('transparent');
        expect(elements.translated.style.backgroundColor).toBe('transparent');
    });

    it('orders and lays out the slots per the display', () => {
        const elements = createSubtitleElements();
        applyDisplaySettings(elements, display, DUALSUB_LOOK, 1000);
        expect(elements.container.children[0]).toBe(elements.original);
        expect(elements.container.style.flexDirection).toBe('column');

        applyDisplaySettings(
            elements,
            { ...display, order: 'translation_top', orientation: 'row' },
            DUALSUB_LOOK,
            1000
        );
        expect(elements.container.children[0]).toBe(elements.translated);
        expect(elements.container.style.flexDirection).toBe('row');
    });
});
