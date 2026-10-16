import { useRef, type ReactNode } from 'react';
import {
    SETTING_BOUNDS,
    validateSetting,
    type SettingsValues,
} from '@/config/schema';
import { configService } from '@/config/service';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import { keyEntry, usableCredential } from '@/shared/keyOrigins';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import { useChoice } from '../../design/useChoice';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { CommittedField } from '../controls/CommittedField';
import { GEMINI_MODELS, OPENAI_MODELS } from '../explanations/models';
import { OpenAIHostPermission } from '../explanations/OpenAIHostPermission';
import { useHostPermission } from '../hooks/useHostPermission';
import { useFeedback } from '../shell/feedback';
import { SharedTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

const AI_SERVICES = {
    openai: {
        nameKey: 'setupServiceOpenAI',
        keyPage: 'https://platform.openai.com/api-keys',
        keyHelpKey: 'setupOpenAIKeyHelp',
        placeholder: 'sk-…',
    },
    gemini: {
        nameKey: 'setupServiceGemini',
        keyPage: 'https://aistudio.google.com/apikey',
        keyHelpKey: 'setupGeminiKeyHelp',
        placeholder: 'AIza…',
    },
} as const;

/** The illustration clicks a word in an English line; its explanation is in
 *  the page's language. */
const SAMPLE_WORD = 'cats and dogs';

const CONTEXT_TYPE_LABELS: Record<ContextType, string> = {
    linguistic: 'explainTypeMeaning',
    cultural: 'explainTypeCulture',
    historical: 'explainTypeHistory',
};

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
    const service = AI_SERVICES[provider];
    const apiKey =
        provider === 'openai'
            ? usableCredential('openaiApiKey', settings)
            : settings.geminiApiKey;
    // A custom OpenAI address works only once Chrome lets DualSub reach it.
    const access = useHostPermission(settings.openaiBaseUrl);
    const blocked = provider === 'openai' && access.permitted === false;
    // Explanations need a key the service can be reached with, and at least
    // one kind of explanation to give.
    const ready =
        apiKey.trim() !== '' &&
        (provider !== 'openai' || access.permitted === true) &&
        settings.aiContextTypes.length > 0;
    const enabled = settings.aiContextEnabled;
    const enableSwitch = useRef<HTMLButtonElement | null>(null);

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
        feedback.apply(() =>
            configService.updateSetting('aiContextTypes', (types) =>
                CONTEXT_TYPES.filter((candidate) =>
                    candidate === type ? checked : types.includes(candidate)
                )
            )
        );

    return (
        <section className="section" aria-labelledby="explain-title">
            <h1 id="explain-title" tabIndex={-1}>
                {t('navExplanations')}
            </h1>
            <p className="lead">{t('explainLead')}</p>
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
                        <div className="label" id="explain-switch">
                            {t('explainTitle')}
                        </div>
                        <div className="help">
                            {t(
                                !ready
                                    ? 'explainStatusSetup'
                                    : enabled
                                      ? 'explainStatusOn'
                                      : 'explainStatusOff'
                            )}
                        </div>
                    </div>
                    <Switch
                        ref={enableSwitch}
                        checked={enabled}
                        labelledBy="explain-switch"
                        disabled={!enabled && !ready}
                        onChange={(on) =>
                            save(
                                { aiContextEnabled: on },
                                {
                                    message: t(
                                        on
                                            ? 'toastExplainOn'
                                            : 'toastExplainOff'
                                    ),
                                }
                            )
                        }
                    />
                </div>
            </div>

            <div className="card">
                <h2 className="label">
                    {t(ready ? 'explainSetupDone' : 'explainSetupTitle')}
                </h2>
                <p className="help">{t('explainSetupHelp')}</p>
                <ol className="steps">
                    <li>
                        <div>
                            <div className="strong" id="explain-service">
                                {t('setupChooseService')}
                            </div>
                            <div
                                className="segmented"
                                role="group"
                                aria-labelledby="explain-service"
                            >
                                {(['gemini', 'openai'] as const).map((id) => (
                                    <button
                                        key={id}
                                        type="button"
                                        aria-pressed={provider === id}
                                        onClick={() =>
                                            void save(
                                                { aiContextProvider: id },
                                                'quiet'
                                            )
                                        }
                                    >
                                        {t(AI_SERVICES[id].nameKey)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </li>
                    <li>
                        <div>
                            <div className="strong">{t('setupGetKey')}</div>
                            <p className="help">{t(service.keyHelpKey)}</p>
                            <a
                                className="button"
                                href={service.keyPage}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t('setupOpenKeyPage', t(service.nameKey))}
                                <Icon name="external" />
                            </a>
                        </div>
                    </li>
                    <li>
                        <div className="grow">
                            <label className="strong" htmlFor="explain-key">
                                {t('setupPasteKey')}
                            </label>
                            <div className="inline wrap">
                                <input
                                    type="password"
                                    id="explain-key"
                                    className="field grow"
                                    autoComplete="off"
                                    placeholder={service.placeholder}
                                    value={apiKey}
                                    onChange={(event) => {
                                        const key = event.target.value;
                                        void (provider === 'openai'
                                            ? save(
                                                  keyEntry(
                                                      'openaiApiKey',
                                                      key,
                                                      settings.openaiBaseUrl
                                                  ),
                                                  'quiet'
                                              )
                                            : save(
                                                  { geminiApiKey: key },
                                                  'quiet'
                                              ));
                                    }}
                                />
                                {!enabled && (
                                    <button
                                        type="button"
                                        className="button primary"
                                        disabled={!ready}
                                        onClick={() =>
                                            void save(
                                                { aiContextEnabled: true },
                                                { message: t('toastExplainOn') }
                                            ).then((saved) => {
                                                if (saved) {
                                                    enableSwitch.current?.focus();
                                                }
                                            })
                                        }
                                    >
                                        {t('explainTurnOn')}
                                    </button>
                                )}
                            </div>
                            {blocked && (
                                <>
                                    <p className="help">
                                        {t('explainAllowHost')}
                                    </p>
                                    <OpenAIHostPermission
                                        t={t}
                                        baseUrl={settings.openaiBaseUrl}
                                        valid
                                        onAnswer={access.recheck}
                                    />
                                </>
                            )}
                            <p className="help">{t('explainKeyStays')}</p>
                        </div>
                    </li>
                </ol>
            </div>

            <div className="card">
                <h2 className="label" id="explain-types">
                    {t('explainTypesTitle')}
                </h2>
                <div
                    className="checks"
                    role="group"
                    aria-labelledby="explain-types"
                >
                    {CONTEXT_TYPES.map((type) => (
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
                {settings.aiContextTypes.length === 0 && (
                    <p className="status-line error" role="alert">
                        {t('aiContextTypesRequired')}
                    </p>
                )}
            </div>

            <div className="card" id="explain-reading">
                <h2 className="label">{t('explainReadingTitle')}</h2>
                <div className="row">
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
                <div className="row">
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
                                <div className="control">
                                    <label htmlFor="openaiBaseUrl">
                                        {t('setupAddress')}
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
                        <div className="control">
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
