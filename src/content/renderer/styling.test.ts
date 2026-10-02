// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { STANDARD_PLACEMENT } from './cueSelect';
import { getDefaultValue } from '@/config/schema';
import {
    customLook,
    DUALSUB_LOOK,
    hexWithOpacity,
    resolveLook,
    type SubtitleLook,
} from './looks';
import {
    applyBlockStyle,
    createBlockElements,
    fontSizePx,
    type DisplaySettings,
} from './styling';

const display: DisplaySettings = {
    style: 'dualsub',
    customLook: DUALSUB_LOOK,
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
        expect(resolveLook(display, BOLD_PRESET, captured)).toBe(DUALSUB_LOOK);
        expect(
            resolveLook({ ...display, style: 'platform' }, BOLD_PRESET, null)
        ).toBe(BOLD_PRESET);
        expect(
            resolveLook(
                { ...display, style: 'platform' },
                BOLD_PRESET,
                captured
            )
        ).toBe(captured);
    });

    it('draws the custom style from the display', () => {
        const own = customLook({
            ...getDefaultValue('subtitleCustomLook'),
            bold: true,
        });
        expect(
            resolveLook({ style: 'custom', customLook: own }, BOLD_PRESET, null)
        ).toBe(own);
    });
});

describe('customLook', () => {
    it('is the DualSub look at its defaults', () => {
        expect(customLook(getDefaultValue('subtitleCustomLook'))).toEqual(
            DUALSUB_LOOK
        );
        expect(DUALSUB_LOOK.background).toBe('rgba(0, 0, 0, 0.6)');
        expect(DUALSUB_LOOK.fontFamily).toBe('inherit');
    });

    it('maps the typography choices to CSS', () => {
        const look = customLook({
            font: 'small-caps',
            bold: true,
            originalColor: '#ffff00',
            translatedColor: '#ff00ff',
            edge: 'outline',
            backgroundColor: '#102030',
            backgroundOpacity: 1,
        });
        expect(look).toMatchObject({
            fontVariant: 'small-caps',
            fontWeight: 'bold',
            originalColor: '#ffff00',
            translatedColor: '#ff00ff',
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
            DUALSUB_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.original.style.fontSize).toBe('20px');
        expect(elements.translated.style.fontSize).toBe('20px');
        expect(elements.original.style.fontWeight).toBe('normal');
        expect(elements.original.style.color).not.toBe(
            elements.translated.style.color
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
            DUALSUB_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(elements.container.children[0]).toBe(elements.original);
        expect(elements.container.style.flexDirection).toBe('column');

        applyBlockStyle(
            elements,
            { ...display, order: 'translation_top', orientation: 'row' },
            DUALSUB_LOOK,
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
            DUALSUB_LOOK,
            1000,
            STANDARD_PLACEMENT
        );
        expect(parseFloat(elements.container.style.bottom)).toBeCloseTo(
            17.4,
            1
        );
        expect(elements.container.style.top).toBe('auto');
        expect(elements.container.style.transform).toBe('translateX(-50%)');

        applyBlockStyle(elements, display, DUALSUB_LOOK, 1000, {
            kind: 'line',
            line: 0.1481,
            lineAlign: 'start',
        });
        expect(elements.container.style.top).toBe('14.81%');
        expect(elements.container.style.bottom).toBe('auto');
        expect(elements.container.style.transform).toBe(
            'translateX(-50%) translateY(0)'
        );

        applyBlockStyle(elements, display, DUALSUB_LOOK, 1000, {
            kind: 'line',
            line: 0.7,
            lineAlign: 'end',
        });
        expect(elements.container.style.transform).toBe(
            'translateX(-50%) translateY(-100%)'
        );
    });
});
