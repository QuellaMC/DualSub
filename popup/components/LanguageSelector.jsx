import React from 'react';

export function LanguageSelector({
    t,
    originalLanguage,
    targetLanguage,
    onOriginalChange,
    onTargetChange,
}) {
    const supportedLanguages = {
        en: 'lang_en',
        es: 'lang_es',
        fr: 'lang_fr',
        de: 'lang_de',
        it: 'lang_it',
        pt: 'lang_pt',
        ja: 'lang_ja',
        ko: 'lang_ko',
        'zh-CN': 'lang_zh_CN',
        'zh-TW': 'lang_zh_TW',
        ru: 'lang_ru',
        ar: 'lang_ar',
        hi: 'lang_hi',
    };

    return (
        <div className="card">
            <div className="setting-item">
                <label htmlFor="originalLanguage">
                    {t('originalLanguageLabel', 'Original Language')}
                </label>
                <select
                    id="originalLanguage"
                    value={originalLanguage}
                    onChange={(e) => onOriginalChange(e.target.value)}
                >
                    {Object.entries(supportedLanguages).map(([code, key]) => (
                        <option key={code} value={code}>
                            {t(key, code)}
                        </option>
                    ))}
                </select>
            </div>
            <div className="setting-item">
                <label htmlFor="targetLanguage">
                    {t('targetLanguageLabel', 'Translate to')}
                </label>
                <select
                    id="targetLanguage"
                    value={targetLanguage}
                    onChange={(e) => onTargetChange(e.target.value)}
                >
                    {Object.entries(supportedLanguages).map(([code, key]) => (
                        <option key={code} value={code}>
                            {t(key, code)}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}
