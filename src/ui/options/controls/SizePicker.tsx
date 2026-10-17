import { namedSize, TEXT_SIZES } from '../../adjustments';
import type { Translate } from '../../hooks/useI18n';

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
                    aria-pressed={namedSize(scale) === size}
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
