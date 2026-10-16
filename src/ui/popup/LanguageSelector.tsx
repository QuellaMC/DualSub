import { AUTO_LANGUAGE, SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import type { Translate } from '../hooks/useI18n';
import { languageLabelKey } from '../languageLabels';

function LanguageSelect({
    id,
    label,
    value,
    choices,
    onChange,
    t,
}: {
    id: string;
    label: string;
    value: string;
    choices: readonly string[];
    onChange: (code: string) => void;
    t: Translate;
}) {
    return (
        <div className="setting-item">
            <label htmlFor={id}>{label}</label>
            <select
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                {choices.map((code) => (
                    <option key={code} value={code}>
                        {t(languageLabelKey(code))}
                    </option>
                ))}
            </select>
        </div>
    );
}

const ORIGINAL_LANGUAGE_CHOICES = [AUTO_LANGUAGE, ...SUBTITLE_LANGUAGES];

export function LanguageSelector({
    t,
    originalLanguage,
    targetLanguage,
    onOriginalChange,
    onTargetChange,
}: {
    t: Translate;
    originalLanguage: string;
    targetLanguage: string;
    onOriginalChange: (code: string) => void;
    onTargetChange: (code: string) => void;
}) {
    return (
        <div className="card">
            <LanguageSelect
                id="originalLanguage"
                label={t('originalLanguageLabel')}
                value={originalLanguage}
                choices={ORIGINAL_LANGUAGE_CHOICES}
                onChange={onOriginalChange}
                t={t}
            />
            <LanguageSelect
                id="targetLanguage"
                label={t('targetLanguageLabel')}
                value={targetLanguage}
                choices={SUBTITLE_LANGUAGES}
                onChange={onTargetChange}
                t={t}
            />
        </div>
    );
}
