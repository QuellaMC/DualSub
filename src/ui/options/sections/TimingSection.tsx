import { validateSetting } from '@/config/schema';
import { Icon } from '../../design/Icon';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { CommittedField } from '../controls/CommittedField';
import { useDraft } from '../controls/useDraft';
import { SiteTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

/** Each press of Earlier or Later moves the subtitles this far. */
const NUDGE_SECONDS = 0.5;

function roundSeconds(seconds: number): number {
    return Math.round(seconds * 100) / 100;
}

/** A positive offset shows subtitles earlier: the renderer adds it to the
 *  playback time before choosing a line. */
export function TimingSection({
    t,
    settings,
    save,
    advanced,
}: SectionProps & { advanced: boolean }) {
    // Each press builds on the last one shown, saved or not.
    const draft = useDraft(
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
    const shift = (seconds: number, messageKey: string): void =>
        draft.set(roundSeconds(offset + seconds), {
            message: t(messageKey, NUDGE_SECONDS),
        });

    return (
        <section className="section" aria-labelledby="timing-title">
            <h1 id="timing-title" tabIndex={-1}>
                {t('navTiming')}
            </h1>
            <p className="lead">{t('timingLead')}</p>

            <div className="card" id="timing">
                <h2 className="label">{t('timingTitle')}</h2>
                <div className="timing">
                    <button
                        type="button"
                        className="button big"
                        onClick={() => shift(NUDGE_SECONDS, 'toastEarlier')}
                    >
                        <Icon name="earlier" />
                        {t('timingEarlier')}
                    </button>
                    <div className="timing-value" aria-live="polite">
                        <div className="timing-number">
                            {offset === 0
                                ? t('timingOnTime')
                                : t(
                                      offset > 0
                                          ? 'timingEarlierBy'
                                          : 'timingLaterBy',
                                      Math.abs(offset).toFixed(1)
                                  )}
                        </div>
                        <div className="help">
                            {t(
                                offset === 0
                                    ? 'timingOnTimeHelp'
                                    : offset > 0
                                      ? 'timingEarlierHelp'
                                      : 'timingLaterHelp'
                            )}
                        </div>
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
                        onClick={() =>
                            draft.set(0, { message: t('toastOnTime') })
                        }
                    >
                        {t('timingReset')}
                    </button>
                </div>
                <SiteTag keys={['subtitleTimeOffset']} />
            </div>

            <div className="card">
                <h2 className="label">{t('timingTipTitle')}</h2>
                <p className="help">{t('timingTipHelp')}</p>
            </div>

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
                            <div className="help">{t('timingExactHelp')}</div>
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
