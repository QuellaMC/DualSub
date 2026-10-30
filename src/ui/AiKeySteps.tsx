import type { ReactNode } from 'react';
import type { SettingsValues } from '@/config/schema';
import type { Translate } from './hooks/useI18n';

export type AiService = SettingsValues['aiContextProvider'];

/** Where each AI service hands out keys, and how its keys look. */
export const AI_SERVICES = {
    gemini: {
        nameKey: 'setupServiceGemini',
        keyPage: 'https://aistudio.google.com/apikey',
        keyPageKey: 'setupOpenAIStudio',
        keyHelpKey: 'setupGeminiKeyHelp',
        placeholder: 'AIza…',
    },
    openai: {
        nameKey: 'setupServiceOpenAI',
        keyPage: 'https://platform.openai.com/api-keys',
        keyPageKey: 'setupOpenOpenAI',
        keyHelpKey: 'setupOpenAIKeyHelp',
        placeholder: 'sk-…',
    },
} as const satisfies Record<AiService, unknown>;

const SERVICE_ORDER = ['gemini', 'openai'] as const;

/**
 * The three steps to an AI key: choose a service, get a key from it, paste
 * it here. The settings page and the side panel show the same steps; each
 * decides when a pasted key is saved and what follows it.
 */
export function AiKeySteps({
    t,
    idPrefix,
    service,
    onService,
    keyValue,
    onKey,
    action,
    children,
}: {
    t: Translate;
    /** Keeps the ids unique on the page that shows the steps. */
    idPrefix: string;
    service: AiService;
    onService: (service: AiService) => void;
    keyValue: string;
    onKey: (key: string) => void;
    /** Beside the key field, such as the button that uses the key. */
    action?: ReactNode;
    /** Under the key field, such as a permission the address needs. */
    children?: ReactNode;
}) {
    const chosen = AI_SERVICES[service];
    return (
        <ol className="steps">
            <li>
                <div>
                    <div className="strong" id={`${idPrefix}-service`}>
                        {t('explainChooseService')}
                    </div>
                    <div
                        className="segmented"
                        role="group"
                        aria-labelledby={`${idPrefix}-service`}
                    >
                        {SERVICE_ORDER.map((id) => (
                            <button
                                key={id}
                                id={`${idPrefix}-provider-${id}`}
                                type="button"
                                aria-pressed={service === id}
                                onClick={() => onService(id)}
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
                    <p className="help">{t(chosen.keyHelpKey)}</p>
                    <a
                        className="button"
                        href={chosen.keyPage}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t(chosen.keyPageKey)}
                    </a>
                </div>
            </li>
            <li>
                <div className="grow">
                    <label className="strong" htmlFor={`${idPrefix}-key`}>
                        {t('setupPasteKey')}
                    </label>
                    <div className="inline wrap">
                        <input
                            type="password"
                            id={`${idPrefix}-key`}
                            className="field grow"
                            autoComplete="off"
                            placeholder={chosen.placeholder}
                            value={keyValue}
                            onChange={(event) => onKey(event.target.value)}
                        />
                        {action}
                    </div>
                    {children}
                </div>
            </li>
        </ol>
    );
}
