// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { STANDARD_PLACEMENT } from './cueSelect';
import { getDefaultValue } from '@/config/schema';
import {
    customLook,
    hexWithOpacity,
    resolveLook,
    type SubtitleLook,
} from './looks';

const DEFAULT_LOOK = customLook(getDefaultValue('subtitleCustomLook'));
import {
    applyBlockStyle,
    createBlockElements,
    fontSizePx,
    type DisplaySettings,
} from './styling';

const display: DisplaySettings = {
    style: 'custom',
    customLook: DEFAULT_LOOK,
    translationColor: '#00ffff',
    fontScale: 1,
    gap: 0.3,
    verticalPosition: 2.8,
    orientation: 'column',
    order: 'original_top',
    timeOffset: 0,
};

const BOLD_PRESET: SubtitleLook = {
    ...DEFAULT_LOOK,
    fontWeight: 'bold',
    background: 'transparent',
};

describe('resolveLook', () => {
    it("draws the platform preset, or the viewer's reported look over it", () => {
        const captured = { ...DEFAULT_LOOK, fontWeight: '600' };
        const platform = { ...display, style: 'platform' as const };
        expect(resolveLook(platform, BOLD_PRESET, null)).toBe(BOLD_PRESET);
        expect(resolveLook(platform, BOLD_PRESET, captured)).toBe(captured);
    });

    it('draws the custom style from the display', () => {
        expect(resolveLook(display, BOLD_PRESET, null)).toBe(DEFAULT_LOOK);
    });
});

describe('customLook', () => {
    it("is DualSub's own look at the defaults", () => {
        expect(DEFAULT_LOOK).toMatchObject({
            fontFamily: 'inherit',
            fontWeight: 'normal',
            originalColor: '#ffffff',
            background: 'rgba(0, 0, 0, 0.6)',
        });
    });

    it('maps the typography choices to CSS', () => {
        const look = customLook({
            font: 'small-caps',
            bold: true,
            originalColor: '#ffff00',
            edge: 'outline',
            backgroundColor: '#102030',
            backgroundOpacity: 1,
        });
        expect(look).toMatchObject({
            fontVariant: 'small-caps',
            fontWeight: 'bold',
            originalColor: '#ffff00',
            textShadow: 'none',
            textStroke: '1.5px black',
            background: '#102030',
        });
        expect(hexWithOpacity('#102030', 0.25)).toBe('rgba(16, 32, 48, 0.25)');
    });
});

describe('fontSizePx', () => {
    it('is a fixed fraction of the picture height times the scale', () => {
        expect(fontSizePx(display, 1000)).toBe(20);
        expect(fontSizePx({ ...display, fontScale: 1.5 }, 1000)).toBe(30);
        expect(fontSizePx({ ...display, fontScale: 0.5 }, 333)).toBe(3.33);
    });
});

describe('applyBlockStyle', () => {
    it('paints the look and size onto both slots', () => {
        const elements = createBlockElements('standard');
        applyBlockStyle(
            elements,
            display,
            DEFAULT_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.original.style.fontSize).toBe('20px');
        expect(elements.translated.style.fontSize).toBe('20px');
        expect(elements.original.style.fontWeight).toBe('normal');
        expect(elements.original.style.color).not.toBe(
            elements.translated.style.color
        );
        // The translation line takes the display's color in every look.
        applyBlockStyle(
            elements,
            { ...display, translationColor: '#ff00ff' },
            BOLD_PRESET,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.translated.style.color).toMatch(
            /#ff00ff|rgb\(255, 0, 255\)/
        );

        applyBlockStyle(
            elements,
            display,
            { ...BOLD_PRESET, fontVariant: 'small-caps' },
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.original.style.fontWeight).toBe('bold');
        expect(elements.original.style.fontVariant).toBe('small-caps');
        expect(elements.original.style.backgroundColor).toBe('transparent');
        expect(elements.translated.style.backgroundColor).toBe('transparent');
    });

    it('orders and lays out the slots per the display', () => {
        const elements = createBlockElements('standard');
        applyBlockStyle(
            elements,
            display,
            DEFAULT_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.container.children[0]).toBe(elements.original);
        expect(elements.container.style.flexDirection).toBe('column');

        applyBlockStyle(
            elements,
            { ...display, order: 'translation_top', orientation: 'row' },
            DEFAULT_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.container.children[0]).toBe(elements.translated);
        expect(elements.container.style.flexDirection).toBe('row');
    });

    it("places the standard block at the viewer's position and a positioned block on its line", () => {
        const elements = createBlockElements('standard');
        expect(elements.container.dataset.block).toBe('standard');
        applyBlockStyle(
            elements,
            display,
            DEFAULT_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(parseFloat(elements.container.style.bottom)).toBeCloseTo(
            17.4,
            1
        );
        expect(elements.container.style.top).toBe('auto');
        expect(elements.container.style.transform).toBe('translateX(-50%)');

        applyBlockStyle(elements, display, DEFAULT_LOOK, 1000, {
            kind: 'line',
            line: 0.1481,
            lineAlign: 'start',
        });
        expect(elements.container.style.top).toBe('14.81%');
        expect(elements.container.style.bottom).toBe('auto');
        expect(elements.container.style.transform).toBe(
            'translateX(-50%) translateY(0)'
        );

        applyBlockStyle(elements, display, DEFAULT_LOOK, 1000, {
            kind: 'line',
            line: 0.7,
            lineAlign: 'end',
        });
        expect(elements.container.style.transform).toBe(
            'translateX(-50%) translateY(-100%)'
        );
    });
});
