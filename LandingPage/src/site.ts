export const CHROME_WEB_STORE_URL =
    'https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj';
export const GITHUB_URL = 'https://github.com/QuellaMC/DualSub';
export const DOCS_URL = `${GITHUB_URL}/tree/main/docs/en`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const NEW_ISSUE_URL = `${GITHUB_URL}/issues/new/choose`;
export const PRIVACY_POLICY_URL = `${GITHUB_URL}/blob/main/PRIVACY_POLICY.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;

/** The popup's Translate to choices (src/ui/popup/LanguageSelector.tsx). */
export const SUBTITLE_LANGUAGES = [
    'English',
    'Spanish',
    'French',
    'German',
    'Italian',
    'Portuguese',
    'Japanese',
    'Korean',
    'Chinese (Simp)',
    'Chinese (Trad)',
    'Russian',
    'Arabic',
    'Hindi',
] as const;

/** The extension's interface locales (public/_locales), named in their own language. */
export const INTERFACE_LANGUAGES = [
    { name: 'English', lang: 'en' },
    { name: 'Español', lang: 'es' },
    { name: '日本語', lang: 'ja' },
    { name: '한국어', lang: 'ko' },
    { name: '中文 (简体)', lang: 'zh-CN' },
    { name: '中文 (繁體)', lang: 'zh-TW' },
] as const;

/** Every in-page link targets one of these, so a link cannot outlive its section. */
export type SectionId =
    | 'how-it-works'
    | 'popup'
    | 'customize'
    | 'ai-context'
    | 'engines'
    | 'platforms'
    | 'privacy'
    | 'faq';

export interface SectionLink {
    readonly id: SectionId;
    readonly label: string;
}

export function sectionHref(id: SectionId): string {
    return `#${id}`;
}
