import type { SettingsValues } from '@/config/schema';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../hooks/useDraft';
import type { Translate } from '../hooks/useI18n';

export const OPTIONS_SETTINGS_KEYS = [
    'uiLanguage',
    'showAdvancedSettings',
    'subtitlesEnabled',
    'targetLanguage',
    'originalLanguage',
    'useOfficialTranslations',
    'pairOfficialTranslations',
    'subtitleStyle',
    'subtitleCustomLook',
    'subtitleTranslationColor',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleFollowPlacement',
    'subtitleLayoutOrder',
    'subtitleLayoutOrientation',
    'subtitleTimeOffset',
    'siteProfiles',
    'selectedProvider',
    'translationDelay',
    'translationFallback',
    'deeplApiKey',
    'deeplApiPlan',
    'openaiCompatibleApiKey',
    'openaiCompatibleApiKeyOrigin',
    'openaiCompatibleBaseUrl',
    'openaiCompatibleModel',
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
    'vertexTokenExpiresAt',
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
    'aiContextTimeout',
    'aiContextRateLimit',
    'aiContextCacheEnabled',
    'aiContextRetryAttempts',
    'openaiApiKey',
    'openaiApiKeyOrigin',
    'openaiBaseUrl',
    'openaiModel',
    'geminiApiKey',
    'geminiModel',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
    'sidePanelTheme',
    'loggingLevel',
] as const;

export type OptionsSettings = Pick<
    SettingsValues,
    (typeof OPTIONS_SETTINGS_KEYS)[number]
>;

/** Which sites the page is editing: all of them, or one site's own. */
export type Scope = 'all' | PlatformId;

/** Persist settings; resolves false (and the page shows its banner) on
 *  failure. Without feedback the save is quiet. */
export type SaveSettings = (
    changes: Partial<OptionsSettings>,
    feedback?: SaveFeedback
) => Promise<boolean>;

export interface SectionProps {
    readonly t: Translate;
    readonly settings: OptionsSettings;
    readonly save: SaveSettings;
}

export type TestTone = 'info' | 'success' | 'warning' | 'error';

export type TestResult = {
    readonly tone: TestTone;
    readonly message: string;
} | null;

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
