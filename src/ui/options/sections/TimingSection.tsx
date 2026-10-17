import { validateSetting } from '@/config/schema';
import { NUDGE_SECONDS, roundSeconds, timingLabel } from '../../adjustments';
import { Icon } from '../../design/Icon';
import { Interpolate } from '../../design/Interpolate';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import type { Translate } from '../../hooks/useI18n';
import { CommittedField } from '../controls/CommittedField';
import { SiteTag, useSiteDraft } from '../shell/scopeContext';
import type { SectionProps } from '../types';

/** When a sample stretch of video speaks, in seconds. */
const SPEECH = [
    { start: 0.4, end: 1.9 },
    { start: 2.5, end: 4.3 },
    { start: 4.8, end: 5.8 },
] as const;

/** The seconds of video the timeline spans. */
const SPAN_SECONDS = 6.4;

/** Each stretch of speech as a waveform: bars that swell to its middle. */
const WAVES = SPEECH.map((stretch, index) => {
    const count = Math.max(6, Math.round((stretch.end - stretch.start) * 14));
    return {
        ...stretch,
        bars: Array.from({ length: count }, (_, bar) => {
            const swell = 0.3 + 0.7 * Math.sin((Math.PI * (bar + 0.5)) / count);
            const wobble =
                0.55 + 0.45 * Math.abs(Math.sin(bar * 2.1 + index * 1.3));
            return Math.round(18 + 78 * swell * wobble);
        }),
    };
});

function spanPercent(seconds: number): string {
    return `${(seconds / SPAN_SECONDS) * 100}%`;
}

/** The voice and the subtitles side by side, the subtitles shifted by
 *  `offset` seconds. */
function Timeline({ t, offset }: { t: Translate; offset: number }) {
    return (
        <div
            className="timeline"
            role="img"
            aria-label={
                offset === 0
                    ? t('timingTimelineOnTime')
                    : t(
                          offset > 0
                              ? 'timingTimelineEarlier'
                              : 'timingTimelineLater',
                          Math.abs(offset).toFixed(1)
                      )
            }
        >
            <div className="timeline-labels">
                <span>{t('timingVoice')}</span>
                <span>{t('timingSubtitles')}</span>
            </div>
            <div className="timeline-tracks">
                <div className="timeline-row">
                    {WAVES.map((wave) => (
                        <span
                            key={wave.start}
                            className="timeline-wave"
                            style={{
                                left: spanPercent(wave.start),
                                width: spanPercent(wave.end - wave.start),
                            }}
                        >
                            {wave.bars.map((height, bar) => (
                                <span
                                    key={bar}
                                    style={{ height: `${height}%` }}
                                />
                            ))}
                        </span>
                    ))}
                </div>
                <div className="timeline-row">
                    {SPEECH.map((stretch) => (
                        <span
                            key={stretch.start}
                            className="timeline-subtitle"
                            style={{
                                left: spanPercent(stretch.start - offset),
                                width: spanPercent(stretch.end - stretch.start),
                            }}
                        />
                    ))}
                </div>
                <span className="timeline-playhead" />
            </div>
        </div>
    );
}

export function TimingSection({
    t,
    settings,
    save,
    advanced,
}: SectionProps & { advanced: boolean }) {
    // Each press builds on the last one shown, saved or not.
    const draft = useSiteDraft(
        'subtitleTimeOffset',
        roundSeconds(settings.subtitleTimeOffset),
        (value, notice) => save({ subtitleTimeOffset: value }, notice)
    );
    const offset = draft.value;
    const exact = useCommittedTextField({
        value: String(offset),
        validate: (value) =>
            value.trim() !== '' &&
            validateSetting('subtitleTimeOffset', Number(value)),
        onCommit: (value) => {
            draft.set(roundSeconds(Number(value)), 'quiet');
            return true;
        },
    });
    /** A button builds on an exact shift typed but not yet entered, which
     *  the field would otherwise enter over the button's change later. */
    const shift = (seconds: number, messageKey: string): void => {
        void exact.commit();
        draft.update((current) => roundSeconds(current + seconds), {
            message: t(messageKey, NUDGE_SECONDS),
        });
    };

    return (
        <section className="section" aria-labelledby="timing-title">
            <h1 id="timing-title" className="sr-only" tabIndex={-1}>
                {t('navTiming')}
            </h1>

            <Timeline t={t} offset={offset} />

            <div className="card" id="timing">
                <h2 className="sr-only">{t('timingTitle')}</h2>
                <div className="timing">
                    <button
                        type="button"
                        className="button big"
                        onClick={() => shift(NUDGE_SECONDS, 'toastEarlier')}
                    >
                        <Icon name="earlier" />
                        {t('timingEarlier')}
                    </button>
                    <div className="timing-number" aria-live="polite">
                        {timingLabel(t, offset)}
                    </div>
                    <button
                        type="button"
                        className="button big"
                        onClick={() => shift(-NUDGE_SECONDS, 'toastLater')}
                    >
                        {t('timingLater')}
                        <Icon name="later" />
                    </button>
                </div>
                <div className="center">
                    <button
                        type="button"
                        className="button quiet"
                        disabled={offset === 0}
                        onClick={() => {
                            void exact.commit();
                            draft.set(0, { message: t('toastOnTime') });
                        }}
                    >
                        {t('timingReset')}
                    </button>
                </div>
                <SiteTag keys={['subtitleTimeOffset']} />
            </div>

            <p className="help">{t('timingTipHelp')}</p>

            {advanced && (
                <div className="card" id="timing-exact">
                    <div className="row">
                        <div className="grow">
                            <label
                                className="label"
                                htmlFor="timing-exact-field"
                            >
                                {t('timingExactTitle')}{' '}
                                <span className="tag advanced">
                                    {t('commonAdvanced')}
                                </span>
                            </label>
                            <div className="help">
                                <Interpolate text={t('timingExactHelp')}>
                                    <span className="mono">
                                        subtitleTimeOffset
                                    </span>
                                </Interpolate>
                            </div>
                        </div>
                        <div className="stack">
                            <CommittedField
                                t={t}
                                id="timing-exact-field"
                                field={exact}
                                type="number"
                                step="0.1"
                                className="mono narrow"
                            />
                        </div>
                    </div>
                    <SiteTag keys={['subtitleTimeOffset']} />
                </div>
            )}
        </section>
    );
}
