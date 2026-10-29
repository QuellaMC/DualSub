import { useRef, useState, type ReactNode } from 'react';
import {
    SETTING_BOUNDS,
    validateSetting,
    type SettingsValues,
} from '@/config/schema';
import { configService } from '@/config/service';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import { keyEntry, usableCredential } from '@/shared/keyOrigins';
import { credentialEntered } from '@/shared/providers';
import { AI_SERVICES, AiKeySteps } from '../../AiKeySteps';
import { Switch } from '../../design/Switch';
import { useChoice } from '../../design/useChoice';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { CommittedField } from '../controls/CommittedField';
import { GEMINI_MODELS, OPENAI_MODELS } from '../explanations/models';
import { OpenAIHostPermission } from '../explanations/OpenAIHostPermission';
import { useHostPermission } from '../../hooks/useHostPermission';
import { useFeedback } from '../shell/feedback';
import { SharedTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

/** The illustration clicks a word in an English line; its explanation is in
 *  the page's language. */
const SAMPLE_WORD = 'cats and dogs';

/** The kinds of explanation, meaning first, as the page lists them. */
const CONTEXT_TYPE_LABELS: Record<ContextType, string> = {
    linguistic: 'explainTypeMeaning',
    cultural: 'explainTypeCulture',
    historical: 'explainTypeHistory',
};
const LISTED_CONTEXT_TYPES = Object.keys(CONTEXT_TYPE_LABELS) as ContextType[];

const PANEL_THEMES: readonly {
    id: SettingsValues['sidePanelTheme'];
    labelKey: string;
}[] = [
    { id: 'auto', labelKey: 'explainThemeAuto' },
    { id: 'light', labelKey: 'explainThemeLight' },
    { id: 'dark', labelKey: 'explainThemeDark' },
];

function isPanelTheme(
    value: string
): value is SettingsValues['sidePanelTheme'] {
    return PANEL_THEMES.some((theme) => theme.id === value);
}

/** One kind of explanation to ask for; it shows the choice just made, so a
 *  second quick click takes back the first. */
function KindCheck({
    checked,
    onChange,
    children,
}: {
    checked: boolean;
    onChange: (checked: boolean) => Promise<unknown>;
    children: ReactNode;
}) {
    const [shown, toggle] = useChoice(checked, onChange);
    return (
        <label className="check">
            <input type="checkbox" checked={shown} onChange={toggle} />
            {children}
        </label>
    );
}

export function ExplanationsSection({
    t,
    settings,
    save,
    advanced,
}: SectionProps & { advanced: boolean }) {
    const feedback = useFeedback();
    const provider = settings.aiContextProvider;
    const apiKey =
        provider === 'openai'
            ? usableCredential('openaiApiKey', settings)
            : settings.geminiApiKey;
    // A custom OpenAI address works only once Chrome lets DualSub reach it.
    const access = useHostPermission(settings.openaiBaseUrl);
    const blocked = provider === 'openai' && access.permitted === false;
    const keyIn = credentialEntered(apiKey);
    // Done hands focus to the Change key button that takes its place.
    const focusChange = useRef(false);
    // The steps open while there is no key, or no access to its address,
    // and stay open while one is typed in, until it is done.
    const [stepsOpen, setStepsOpen] = useState(!keyIn);
    if ((!keyIn || blocked) && !stepsOpen) {
        setStepsOpen(true);
    }

    const baseUrl = useCommittedTextField({
        value: settings.openaiBaseUrl,
        validate: (draft) => validateSetting('openaiBaseUrl', draft),
        onCommit: (draft) => save({ openaiBaseUrl: draft }, 'quiet'),
    });
    const openaiModel = useCommittedTextField({
        value: settings.openaiModel,
        validate: (draft) => validateSetting('openaiModel', draft),
        onCommit: (draft) => save({ openaiModel: draft }, 'quiet'),
    });
    /** A number field over `key`, shown in units of `unit` stored values
     *  (the timeout is stored in milliseconds and shown in seconds). */
    const numeric = (
        key:
            | 'aiContextTimeout'
            | 'aiContextRateLimit'
            | 'aiContextRetryAttempts',
        unit = 1
    ) => ({
        value: String(settings[key] / unit),
        validate: (draft: string) =>
            draft.trim() !== '' && validateSetting(key, Number(draft) * unit),
        onCommit: (draft: string) =>
            save({ [key]: Number(draft) * unit }, 'quiet'),
    });
    const timeout = useCommittedTextField(numeric('aiContextTimeout', 1000));
    const rateLimit = useCommittedTextField(numeric('aiContextRateLimit'));
    const retries = useCommittedTextField(numeric('aiContextRetryAttempts'));
    const geminiListed = GEMINI_MODELS.some(
        (model) => model.id === settings.geminiModel
    );

    /** Each box changes the stored list, so quick clicks each build on the
     *  last. */
    const setContextType = (
        type: ContextType,
        checked: boolean
    ): Promise<boolean> =>
        feedback.apply(async () => {
            await configService.updateSetting('aiContextTypes', (types) =>
                CONTEXT_TYPES.filter((candidate) =>
                    candidate === type ? checked : types.includes(candidate)
                )
            );
            return undefined;
        });

    return (
        <section className="section" aria-labelledby="explain-title">
            <h1 id="explain-title" className="sr-only" tabIndex={-1}>
                {t('navExplanations')}
            </h1>
            <SharedTag />

            <div className="card" id="explanations">
                <div className="illustration" aria-hidden="true">
                    <div className="illustration-video" lang="en">
                        <span>
                            It’s raining <mark>{SAMPLE_WORD}</mark> out there.
                        </span>
                    </div>
                    <div className="illustration-panel">
                        <div className="strong" lang="en">
                            {SAMPLE_WORD}
                        </div>
                        <div className="help">{t('explainSampleMeaning')}</div>
                    </div>
                </div>
                <div className="row">
                    <div className="grow">
                        <div className="label" id="explain-lookup">
                            {t('explainLookupTitle')}
                        </div>
                        <div className="help">
                            {t(
                                settings.wordLookupEnabled
                                    ? 'explainLookupOn'
                                    : 'explainLookupOff'
                            )}
                        </div>
                    </div>
                    <Switch
                        checked={settings.wordLookupEnabled}
                        labelledBy="explain-lookup"
                        onChange={(on) =>
                            save(
                                { wordLookupEnabled: on },
                                {
                                    message: t(
                                        on ? 'toastLookupOn' : 'toastLookupOff'
                                    ),
                                }
                            )
                        }
                    />
                </div>
            </div>

            {!stepsOpen ? (
                <div className="card" id="explain-ai">
                    <div className="row">
                        <div className="grow">
                            <h2 className="label">
                                {t(
                                    'explainSetUpWith',
                                    t(AI_SERVICES[provider].nameKey)
                                )}
                            </h2>
                            <p className="help">{t('explainKeySaved')}</p>
                        </div>
                        <button
                            ref={(button) => {
                                if (button && focusChange.current) {
                                    focusChange.current = false;
                                    button.focus();
                                }
                            }}
                            type="button"
                            id="explain-change-key"
                            className="button"
                            aria-expanded={false}
                            onClick={() => setStepsOpen(true)}
                        >
                            {t('explainChangeKey')}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="card" id="explain-ai">
                    <h2 className="label">{t('explainWithAi')}</h2>
                    <p className="help">{t('explainSetupHelp')}</p>
                    <AiKeySteps
                        t={t}
                        idPrefix="explain"
                        service={provider}
                        onService={(id) =>
                            void save({ aiContextProvider: id }, 'quiet')
                        }
                        keyValue={apiKey}
                        onKey={(key) =>
                            void save(
                                provider === 'openai'
                                    ? keyEntry(
                                          'openaiApiKey',
                                          key,
                                          settings.openaiBaseUrl
                                      )
                                    : { geminiApiKey: key },
                                'quiet'
                            )
                        }
                        action={
                            keyIn &&
                            !blocked && (
                                <button
                                    type="button"
                                    className="button primary"
                                    onClick={() => {
                                        focusChange.current = true;
                                        setStepsOpen(false);
                                    }}
                                >
                                    {t('commonDone')}
                                </button>
                            )
                        }
                    >
                        {blocked && (
                            <>
                                <p className="help">{t('explainAllowHost')}</p>
                                <OpenAIHostPermission
                                    t={t}
                                    baseUrl={settings.openaiBaseUrl}
                                    valid
                                    onAnswer={access.recheck}
                                />
                            </>
                        )}
                    </AiKeySteps>
                </div>
            )}

            <div className="card" id="explain-kinds">
                <h2 className="label" id="explain-types">
                    {t('explainTypesTitle')}
                </h2>
                <div
                    className="checks"
                    role="group"
                    aria-labelledby="explain-types"
                >
                    {LISTED_CONTEXT_TYPES.map((type) => (
                        <KindCheck
                            key={type}
                            checked={settings.aiContextTypes.includes(type)}
                            onChange={(checked) =>
                                setContextType(type, checked)
                            }
                        >
                            {t(CONTEXT_TYPE_LABELS[type])}
                        </KindCheck>
                    ))}
                </div>
            </div>

            <div className="card" id="explain-reading">
                <h2 className="label">{t('explainReadingTitle')}</h2>
                <div className="row" id="explain-pause-row">
                    <span className="strong grow" id="explain-pause">
                        {t('explainPauseTitle')}
                    </span>
                    <Switch
                        checked={settings.sidePanelAutoPauseVideo}
                        labelledBy="explain-pause"
                        onChange={(pause) =>
                            save({ sidePanelAutoPauseVideo: pause }, 'quiet')
                        }
                    />
                </div>
                <div className="row" id="explain-open-row">
                    <span className="strong grow" id="explain-open">
                        {t('explainOpenTitle')}
                    </span>
                    <Switch
                        checked={settings.sidePanelAutoOpen}
                        labelledBy="explain-open"
                        onChange={(open) =>
                            save({ sidePanelAutoOpen: open }, 'quiet')
                        }
                    />
                </div>
                <div className="row">
                    <label className="strong grow" htmlFor="explain-theme">
                        {t('explainThemeTitle')}
                    </label>
                    <select
                        id="explain-theme"
                        className="field"
                        value={settings.sidePanelTheme}
                        onChange={(event) => {
                            if (isPanelTheme(event.target.value)) {
                                void save(
                                    { sidePanelTheme: event.target.value },
                                    'quiet'
                                );
                            }
                        }}
                    >
                        {PANEL_THEMES.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                                {t(theme.labelKey)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {advanced && (
                <div className="card" id="explain-limits">
                    <h2 className="label">
                        {t('explainLimitsTitle')}{' '}
                        <span className="tag advanced">
                            {t('commonAdvanced')}
                        </span>
                    </h2>
                    <div className="controls-grid">
                        {provider === 'openai' ? (
                            <>
                                <div className="control">
                                    <label htmlFor="openaiModel">
                                        {t('setupModel')}
                                    </label>
                                    <CommittedField
                                        t={t}
                                        id="openaiModel"
                                        field={openaiModel}
                                        list="openai-models"
                                        className="wide mono"
                                    />
                                    <datalist id="openai-models">
                                        {OPENAI_MODELS.map((model) => (
                                            <option
                                                key={model.id}
                                                value={model.id}
                                                label={model.name}
                                            />
                                        ))}
                                    </datalist>
                                </div>
                                <div className="control" id="explain-address">
                                    <label htmlFor="openaiBaseUrl">
                                        {t('explainAddress')}
                                    </label>
                                    <CommittedField
                                        t={t}
                                        id="openaiBaseUrl"
                                        field={baseUrl}
                                        type="url"
                                        className="wide mono"
                                        placeholder="https://api.openai.com/v1"
                                    />
                                    <OpenAIHostPermission
                                        t={t}
                                        baseUrl={baseUrl.value}
                                        valid={baseUrl.valid}
                                        onAnswer={access.recheck}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="control">
                                <label htmlFor="geminiModel">
                                    {t('setupModel')}
                                </label>
                                <select
                                    id="geminiModel"
                                    className="field wide"
                                    value={settings.geminiModel}
                                    onChange={(event) =>
                                        void save(
                                            { geminiModel: event.target.value },
                                            'quiet'
                                        )
                                    }
                                >
                                    {!geminiListed && (
                                        <option value={settings.geminiModel}>
                                            {settings.geminiModel}
                                        </option>
                                    )}
                                    {GEMINI_MODELS.map((model) => (
                                        <option key={model.id} value={model.id}>
                                            {model.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="control">
                            <label htmlFor="explain-timeout">
                                {t('explainTimeout')}
                            </label>
                            <CommittedField
                                t={t}
                                id="explain-timeout"
                                field={timeout}
                                type="number"
                                min={SETTING_BOUNDS.aiContextTimeout.min / 1000}
                                max={SETTING_BOUNDS.aiContextTimeout.max / 1000}
                                className="mono narrow"
                            />
                        </div>
                        <div className="control">
                            <label htmlFor="explain-rate">
                                {t('explainRateLimit')}
                            </label>
                            <CommittedField
                                t={t}
                                id="explain-rate"
                                field={rateLimit}
                                type="number"
                                min={SETTING_BOUNDS.aiContextRateLimit.min}
                                max={SETTING_BOUNDS.aiContextRateLimit.max}
                                className="mono narrow"
                            />
                        </div>
                        <div className="control">
                            <label htmlFor="explain-retries">
                                {t('explainRetries')}
                            </label>
                            <CommittedField
                                t={t}
                                id="explain-retries"
                                field={retries}
                                type="number"
                                min={SETTING_BOUNDS.aiContextRetryAttempts.min}
                                max={SETTING_BOUNDS.aiContextRetryAttempts.max}
                                className="mono narrow"
                            />
                        </div>
                        <div className="control" id="explain-cache-control">
                            <span className="control-label" id="explain-cache">
                                {t('explainCache')}
                            </span>
                            <Switch
                                checked={settings.aiContextCacheEnabled}
                                labelledBy="explain-cache"
                                onChange={(cache) =>
                                    save(
                                        { aiContextCacheEnabled: cache },
                                        'quiet'
                                    )
                                }
                            />
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
