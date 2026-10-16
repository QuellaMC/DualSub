import { AUTO_LANGUAGE, SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import type { Translate } from '../hooks/useI18n';
import { languageLabelKey, NATIVE_LANGUAGE_NAMES } from '../languageLabels';

/** A subtitle language menu naming each language in its own words and in
 *  the page's language; `automatic` offers following the audio first. */
export function LanguageSelect({
    t,
    id,
    value,
    onChange,
    labelledBy,
    automatic = false,
}: {
    t: Translate;
    id: string;
    value: string;
    onChange: (language: string) => void;
    labelledBy?: string;
    automatic?: boolean;
}) {
    return (
        <select
            id={id}
            className="field big-field"
            value={value}
            aria-labelledby={labelledBy}
            onChange={(event) => onChange(event.target.value)}
        >
            {automatic && (
                <option value={AUTO_LANGUAGE}>
                    {t(languageLabelKey(AUTO_LANGUAGE))}
                </option>
            )}
            {SUBTITLE_LANGUAGES.map((code) => {
                const local = t(languageLabelKey(code));
                const native = NATIVE_LANGUAGE_NAMES[code];
                return (
                    <option key={code} value={code}>
                        {native === local ? native : `${native} · ${local}`}
                    </option>
                );
            })}
        </select>
    );
}
