// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
    DUALSUB_LOOK,
    forLanguage,
    resolveLook,
    type SubtitleLook,
} from './looks';
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

const BOLD_PRESET: SubtitleLook = {
    ...DUALSUB_LOOK,
    fontWeight: 'bold',
    background: 'transparent',
};

describe('resolveLook', () => {
    it("uses the platform preset, or the viewer's reported look over it", () => {
        const captured = { ...DUALSUB_LOOK, fontWeight: '600' };
        expect(resolveLook('dualsub', BOLD_PRESET, captured)).toBe(
            DUALSUB_LOOK
        );
        expect(resolveLook('platform', BOLD_PRESET, null)).toBe(BOLD_PRESET);
        expect(resolveLook('platform', BOLD_PRESET, captured)).toBe(captured);
    });
});

describe('forLanguage', () => {
    it("applies a platform's per-language adjustments by normalized code", () => {
        const look: SubtitleLook = {
            ...DUALSUB_LOOK,
            languageOverrides: {
                'zh-CN': { fontWeight: '600' },
                th: { fontWeight: 'normal', fontFamily: 'Thai' },
            },
        };
        expect(forLanguage(look, 'zh-Hans').fontWeight).toBe('600');
        expect(forLanguage(look, 'en')).toBe(look);
        expect(forLanguage(look, 'th-TH')).toMatchObject({
            fontFamily: 'Thai',
            fontWeight: 'normal',
        });
    });
});

describe('fontSizePx', () => {
    it('is a fixed fraction of the picture height times the scale', () => {
        expect(fontSizePx(display, 1000)).toBe(20);
        expect(fontSizePx({ ...display, fontScale: 1.5 }, 1000)).toBe(30);
        expect(fontSizePx({ ...display, fontScale: 0.5 }, 333)).toBe(3.33);
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

        applyDisplaySettings(
            elements,
            display,
            { ...BOLD_PRESET, fontVariant: 'small-caps' },
            1000
        );
        expect(elements.original.style.fontWeight).toBe('bold');
        expect(elements.original.style.fontVariant).toBe('small-caps');
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
