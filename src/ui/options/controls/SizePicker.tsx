import type { Translate } from '../../hooks/useI18n';

const TEXT_SIZES = [
    { scale: 0.8, labelKey: 'sizeSmall', samplePx: 16 },
    { scale: 1, labelKey: 'sizeMedium', samplePx: 21 },
    { scale: 1.3, labelKey: 'sizeLarge', samplePx: 27 },
    { scale: 1.6, labelKey: 'sizeExtraLarge', samplePx: 33 },
] as const;

/** Four named sizes; a scale set exactly in fine-tuning selects none. */
export function SizePicker({
    t,
    scale,
    onPick,
    labelledBy,
}: {
    t: Translate;
    scale: number;
    onPick: (scale: number, label: string) => void;
    labelledBy: string;
}) {
    return (
        <div className="sizes" role="group" aria-labelledby={labelledBy}>
            {TEXT_SIZES.map((size) => (
                <button
                    key={size.labelKey}
                    type="button"
                    className="size"
                    aria-pressed={Math.abs(scale - size.scale) < 0.001}
                    onClick={() => onPick(size.scale, t(size.labelKey))}
                >
                    <span
                        className="size-sample"
                        style={{ fontSize: `${size.samplePx}px` }}
                        aria-hidden="true"
                    >
                        Aa
                    </span>
                    <span>{t(size.labelKey)}</span>
                </button>
            ))}
        </div>
    );
}
