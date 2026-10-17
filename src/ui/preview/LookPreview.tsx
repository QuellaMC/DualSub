import { Scene } from './Scene';
import { useSubtitleBlock, type SampleBlock } from './useSubtitleBlock';

/** A mock video picture carrying one subtitle block where the viewer's
 *  position puts it. */
export function LookPreview({
    label,
    ...block
}: SampleBlock & { label: string }) {
    const [, attach] = useSubtitleBlock(block);
    return (
        <div className="screen" ref={attach} role="img" aria-label={label}>
            <Scene />
        </div>
    );
}
