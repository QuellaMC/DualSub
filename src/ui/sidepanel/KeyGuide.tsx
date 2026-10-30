import { useState } from 'react';
import { configService } from '@/config/service';
import { keyEntry } from '@/shared/keyOrigins';
import { AiKeySteps, type AiService } from '../AiKeySteps';
import { Icon } from '../design/Icon';
import type { Translate } from '../hooks/useI18n';

/**
 * The way to an AI key from inside the panel, shown when explaining needs
 * one. The key is written only when the viewer asks to check it, and never
 * read back: the background tells the panel whether it works.
 */
export function KeyGuide({
    t,
    service,
    openaiBaseUrl,
    refused,
    busy,
    onService,
    onExplain,
    onDismiss,
}: {
    t: Translate;
    service: AiService;
    openaiBaseUrl: string;
    /** The service turned down the key that was tried. */
    refused: boolean;
    busy: boolean;
    onService: (service: AiService) => void;
    onExplain: () => void;
    onDismiss: () => void;
}) {
    const [draft, setDraft] = useState('');
    const check = async (): Promise<void> => {
        const key = draft.trim();
        await configService.setMultiple(
            service === 'openai'
                ? keyEntry('openaiApiKey', key, openaiBaseUrl)
                : { geminiApiKey: key }
        );
        onExplain();
    };
    return (
        <div className="ai key-guide">
            <div className="key-guide-head">
                <h3>{t('sidepanelKeyGuideTitle')}</h3>
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('sidepanelNotNow')}
                    title={t('sidepanelNotNow')}
                    onClick={onDismiss}
                >
                    <Icon name="close" />
                </button>
            </div>
            <p className="help">{t('explainSetupHelp')}</p>
            {refused && (
                <p className="status-line error" role="alert">
                    {t('sidepanelKeyRefused')}
                </p>
            )}
            <AiKeySteps
                t={t}
                idPrefix="panel"
                service={service}
                onService={onService}
                keyValue={draft}
                onKey={setDraft}
                action={
                    <button
                        type="button"
                        className="button primary"
                        disabled={busy || draft.trim() === ''}
                        onClick={() => void check()}
                    >
                        {t('sidepanelCheckAndExplain')}
                    </button>
                }
            />
        </div>
    );
}
