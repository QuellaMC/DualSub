import type { Translate } from '../hooks/useI18n';

/** Selectable subtitle languages, each keyed to its catalog label. */
export const SUBTITLE_LANGUAGES = [
    'en',
    'es',
    'fr',
    'de',
    'it',
    'pt',
    'ja',
    'ko',
    'zh-CN',
    'zh-TW',
    'ru',
    'ar',
    'hi',
] as const;

export function languageLabelKey(code: string): string {
    return `lang_${code.replace('-', '_')}`;
}

function LanguageSelect({
    id,
    label,
    value,
    onChange,
    t,
}: {
    id: string;
    label: string;
    value: string;
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
                {SUBTITLE_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                        {t(languageLabelKey(code))}
                    </option>
                ))}
            </select>
        </div>
    );
}

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
                onChange={onOriginalChange}
                t={t}
            />
            <LanguageSelect
                id="targetLanguage"
                label={t('targetLanguageLabel')}
                value={targetLanguage}
                onChange={onTargetChange}
                t={t}
            />
        </div>
    );
}
