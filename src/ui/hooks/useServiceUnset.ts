import type { SettingsValues } from '@/config/schema';
import { isSameLanguage } from '@/shared/languageNormalization';
import { missingCredentials } from '@/shared/providers';
import { AUTO_LANGUAGE } from '@/shared/subtitleLanguages';
import { useHostPermission } from './useHostPermission';
import { useNow } from './useNow';

/** The settings that say whether the chosen translation service is set
 *  up; its credentials are among them, so they are read with the
 *  sensitive ones. */
export const SERVICE_SETUP_KEYS = [
    'selectedProvider',
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'openaiCompatibleBaseUrl',
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
    'vertexTokenExpiresAt',
] as const;

/** Whether the chosen translation service still needs setting up: a
 *  credential is missing or ran out, or Chrome may not reach an AI service
 *  at its own address. */
export function useServiceUnset(
    settings: Pick<SettingsValues, (typeof SERVICE_SETUP_KEYS)[number]>
): boolean {
    const provider = settings.selectedProvider;
    const access = useHostPermission(settings.openaiCompatibleBaseUrl);
    const now = useNow([settings.vertexTokenExpiresAt]);
    return (
        missingCredentials(provider, settings, now).length > 0 ||
        (provider === 'openai_compatible' && access.permitted === false)
    );
}

/** Whether the languages picked ever call on a translation service: not
 *  when the video's line is fixed to the viewer's own language, where one
 *  line shows. */
export function callsForTranslation(
    settings: Pick<SettingsValues, 'originalLanguage' | 'targetLanguage'>
): boolean {
    return (
        settings.originalLanguage === AUTO_LANGUAGE ||
        !isSameLanguage(settings.originalLanguage, settings.targetLanguage)
    );
}

/** Whether DualSub translates nothing where it runs, though its languages
 *  call for translation: the chosen service still needs setting up, and
 *  fallback is off, so no free one covers. */
export function translationStopped(
    working: boolean,
    unset: boolean,
    settings: Pick<
        SettingsValues,
        'translationFallback' | 'originalLanguage' | 'targetLanguage'
    >
): boolean {
    return (
        working &&
        unset &&
        !settings.translationFallback &&
        callsForTranslation(settings)
    );
}
