import { browserTargetLanguage } from '@/shared/subtitleLanguages';
import type { Translate } from '../../hooks/useI18n';

/** Says the language picked is the browser's, as DualSub picks it first. */
export function FromBrowserTag({
    t,
    language,
}: {
    t: Translate;
    language: string;
}) {
    return language === browserTargetLanguage() ? (
        <span>
            <span className="tag ok">{t('startFromBrowser')}</span>
        </span>
    ) : null;
}
