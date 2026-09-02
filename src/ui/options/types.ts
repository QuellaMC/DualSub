import type { SettingsValues } from '@/config/schema';
import type { Translate } from '../hooks/useI18n';

export const OPTIONS_SETTINGS_KEYS = [
    'uiLanguage',
    'hideOfficialSubtitles',
    'loggingLevel',
    'selectedProvider',
    'translationDelay',
    'deeplApiKey',
    'deeplApiPlan',
    'openaiCompatibleApiKey',
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
    'openaiBaseUrl',
    'openaiModel',
    'geminiApiKey',
    'geminiModel',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
    'sidePanelTheme',
] as const;

export type OptionsSettings = Pick<
    SettingsValues,
    (typeof OPTIONS_SETTINGS_KEYS)[number]
>;

/** Persist settings; resolves false (and the app shows its banner) on failure. */
export type SaveSettings = (
    changes: Partial<OptionsSettings>
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
