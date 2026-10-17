import { Icon } from '../../design/Icon';
import type { Translate } from '../../hooks/useI18n';
import { useDeepLCheck } from '../hooks/useDeepLCheck';
import { TestResultDisplay } from '../TestResultDisplay';
import type { SaveSettings } from '../types';

const DEEPL_KEYS_PAGE = 'https://www.deepl.com/your-account/keys';

export function DeepLProviderCard({
    t,
    apiKey,
    plan,
    save,
}: {
    t: Translate;
    apiKey: string;
    plan: 'free' | 'pro';
    save: SaveSettings;
}) {
    const check = useDeepLCheck(t, apiKey, plan);

    return (
        <div className="card" id="deepl-card" aria-labelledby="deepl-setup">
            <h2 className="label" id="deepl-setup">
                {t('translationDeepLSetupTitle')}
            </h2>
            <ol className="steps">
                <li>
                    <div>
                        <div className="strong">
                            {t('translationDeepLGetKey')}
                        </div>
                        <p className="help">{t('translationDeepLKeyHelp')}</p>
                        <a
                            className="button"
                            href={DEEPL_KEYS_PAGE}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t('translationDeepLOpen')}
                            <Icon name="external" />
                        </a>
                    </div>
                </li>
                <li>
                    <div>
                        <div className="strong" id="deepl-plan">
                            {t('translationDeepLPlan')}
                        </div>
                        <div
                            className="segmented"
                            role="group"
                            aria-labelledby="deepl-plan"
                        >
                            {(['free', 'pro'] as const).map((choice) => (
                                <button
                                    key={choice}
                                    type="button"
                                    aria-pressed={plan === choice}
                                    onClick={() =>
                                        void save(
                                            { deeplApiPlan: choice },
                                            'quiet'
                                        )
                                    }
                                >
                                    {t(
                                        choice === 'free'
                                            ? 'apiPlanFree'
                                            : 'apiPlanPro'
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </li>
                <li>
                    <div className="grow">
                        <label className="strong" htmlFor="deeplApiKey">
                            {t('setupPasteKey')}
                        </label>
                        <div className="inline wrap">
                            <input
                                type="password"
                                id="deeplApiKey"
                                className="field grow"
                                autoComplete="off"
                                placeholder={t(
                                    'translationDeepLKeyPlaceholder'
                                )}
                                value={apiKey}
                                onChange={(event) =>
                                    void save(
                                        { deeplApiKey: event.target.value },
                                        'quiet'
                                    )
                                }
                            />
                            <button
                                type="button"
                                className="button primary"
                                onClick={check.run}
                                disabled={check.testing || !apiKey}
                            >
                                {check.testing
                                    ? t('testingButton')
                                    : t('setupCheckKey')}
                            </button>
                        </div>
                        <TestResultDisplay result={check.result} />
                    </div>
                </li>
            </ol>
        </div>
    );
}
