import { SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import type { Translate } from '../hooks/useI18n';
import {
    languageLabelKey,
    languageName,
    NATIVE_LANGUAGE_NAMES,
} from '../languageLabels';

/** A subtitle language menu naming each language in its own words and in
 *  the page's language, or, `short` for a narrow menu, in its own words
 *  only. A language stored that the menu does not offer, from a backup or
 *  another computer, is still shown as the one picked. */
export function LanguageSelect({
    t,
    id,
    value,
    onChange,
    labelledBy,
    short = false,
}: {
    t: Translate;
    id: string;
    value: string;
    onChange: (language: string) => void;
    labelledBy?: string;
    short?: boolean;
}) {
    const name = languageName(t, value);
    return (
        <select
            id={id}
            className="field big-field"
            value={value}
            aria-labelledby={labelledBy}
            onChange={(event) => onChange(event.target.value)}
        >
            {!(SUBTITLE_LANGUAGES as readonly string[]).includes(value) && (
                <option value={value}>
                    {name === value ? value : `${name} · ${value}`}
                </option>
            )}
            {SUBTITLE_LANGUAGES.map((code) => {
                const local = t(languageLabelKey(code));
                const native = NATIVE_LANGUAGE_NAMES[code];
                return (
                    <option key={code} value={code}>
                        {short || native === local
                            ? native
                            : `${native} · ${local}`}
                    </option>
                );
            })}
        </select>
    );
}
