import type { Translate } from './hooks/useI18n';

/** The named text sizes, smallest first; the glyph shows each at a size a
 *  viewer can compare at a glance. */
export const TEXT_SIZES = [
    { scale: 0.8, labelKey: 'sizeSmall', glyphPx: 12 },
    { scale: 1, labelKey: 'sizeMedium', glyphPx: 15 },
    { scale: 1.3, labelKey: 'sizeLarge', glyphPx: 18 },
    { scale: 1.6, labelKey: 'sizeExtraLarge', glyphPx: 22 },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

/** The named size `scale` is; none for a scale set exactly. */
export function namedSize(scale: number): TextSize | undefined {
    return TEXT_SIZES.find((size) => Math.abs(size.scale - scale) < 0.001);
}

/** The nearest named size bigger (1) or smaller (-1) than `scale`; none
 *  past the last. */
export function nextSize(
    scale: number,
    direction: 1 | -1
): TextSize | undefined {
    const sizes = direction === 1 ? TEXT_SIZES : [...TEXT_SIZES].reverse();
    return sizes.find((size) => direction * (size.scale - scale) > 0.001);
}

/** Each press of Earlier or Later moves the subtitles this far. A positive
 *  offset shows subtitles earlier: the renderer adds it to the playback
 *  time before choosing a line. */
export const NUDGE_SECONDS = 0.5;

export function roundSeconds(seconds: number): number {
    return Math.round(seconds * 100) / 100;
}

/** An offset in words: on time, or how far earlier or later. */
export function timingLabel(t: Translate, offset: number): string {
    return offset === 0
        ? t('timingOnTime')
        : t(
              offset > 0 ? 'timingEarlierBy' : 'timingLaterBy',
              Math.abs(offset).toFixed(1)
          );
}

/** Each move of the position buttons, on the 0.1–9.9 position scale. */
export const POSITION_STEP = 0.7;
/** Each press of an arrow key on the subtitles themselves: finer than a
 *  button, coarser with Shift. */
export const POSITION_KEY_STEPS = { fine: 0.3, coarse: 1 } as const;
export const POSITION_BOUNDS = { min: 0.1, max: 9.9 } as const;

export function clampPosition(value: number): number {
    return (
        Math.round(
            Math.min(
                POSITION_BOUNDS.max,
                Math.max(POSITION_BOUNDS.min, value)
            ) * 10
        ) / 10
    );
}

type PositionBand = 'bottom' | 'usual' | 'lower' | 'middle';

/** The part of the picture the subtitles sit in. */
function positionBand(position: number): PositionBand {
    if (position < 1.4) {
        return 'bottom';
    }
    if (position < 3.6) {
        return 'usual';
    }
    return position < 6.3 ? 'lower' : 'middle';
}

const POSITION_LABEL_KEYS: Record<PositionBand, string> = {
    bottom: 'lookPositionBottom',
    usual: 'lookPositionUsual',
    lower: 'lookPositionLower',
    middle: 'lookPositionMiddle',
};

const POSITION_WORD_KEYS: Record<PositionBand, string> = {
    bottom: 'positionLowest',
    usual: 'positionUsual',
    lower: 'positionHigher',
    middle: 'positionMiddle',
};

/** The picture height the subtitles sit at, described in words. */
export function positionLabelKey(position: number): string {
    return POSITION_LABEL_KEYS[positionBand(position)];
}

/** The same height in a word, for a control with little room. */
export function positionWordKey(position: number): string {
    return POSITION_WORD_KEYS[positionBand(position)];
}
