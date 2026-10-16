import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
    CREDENTIAL_SETUP,
    getDefaultValue,
    isSettingsKey,
    sameSettingValue,
    SENSITIVE_KEYS,
    SETTINGS_KEYS,
    siteProfilesUsable,
    validateSetting,
    prepareSettingValue,
    type SettingsKey,
    type SettingsValues,
} from '@/config/schema';
import { configService, type SettingsWrite } from '@/config/service';
import { usableCredential } from '@/shared/keyOrigins';
import { credentialEntered } from '@/shared/providers';
import { useSettings } from '../../hooks/useSettings';
import { confirmChange, useFeedback } from '../shell/feedback';
import type { SectionProps } from '../types';

/** Credentials, and what only means something with them (the token's
 *  expiry, the origin each key was entered for), never leave this
 *  computer in a backup. */
const NOT_BACKED_UP: readonly SettingsKey[] = [
    ...SENSITIVE_KEYS,
    'vertexTokenExpiresAt',
    'openaiCompatibleApiKeyOrigin',
    'openaiApiKeyOrigin',
];

const BACKED_UP = SETTINGS_KEYS.filter((key) => !NOT_BACKED_UP.includes(key));

/** What a reset leaves while everything else goes back to the recommended
 *  values: what is not backed up, how the page itself reads, and the
 *  setup of every usable key, so a kept key never goes to a host it was
 *  not set up for. A setup without a usable key is reset with the rest. */
function keptOnReset(stored: Partial<SettingsValues>): Set<SettingsKey> {
    const kept = new Set<SettingsKey>([
        ...NOT_BACKED_UP,
        'uiLanguage',
        'showAdvancedSettings',
    ]);
    for (const [credential, setup] of Object.entries(CREDENTIAL_SETUP)) {
        if (
            credentialEntered(
                usableCredential(
                    credential as keyof typeof CREDENTIAL_SETUP,
                    stored
                )
            )
        ) {
            for (const key of setup) {
                kept.add(key);
            }
        }
    }
    return kept;
}

/** Reset everything `keptOnReset` does not keep, judged by the keys stored
 *  when the reset writes: a key saved just before it keeps the setup it was
 *  entered with. */
function resetSettings(): Promise<SettingsWrite> {
    return configService.updateSettings(SETTINGS_KEYS, (stored) => {
        const kept = keptOnReset(stored);
        return Object.fromEntries(
            SETTINGS_KEYS.filter((key) => !kept.has(key)).map((key) => [
                key,
                getDefaultValue(key),
            ])
        );
    });
}

const LOGGING_LEVELS = [
    { level: 0, labelKey: 'advancedLoggingOff' },
    { level: 1, labelKey: 'advancedLoggingErrors' },
    { level: 2, labelKey: 'advancedLoggingWarnings' },
    { level: 3, labelKey: 'advancedLoggingNormal' },
    { level: 4, labelKey: 'advancedLoggingEverything' },
] as const;

/** The settings a backup file holds, ready to write: every non-sensitive
 *  one it names. Null for a file that is not a settings object, or holds a
 *  value this version cannot use for a setting it knows, a site's included:
 *  loading the rest would restore the backup only in part. */
function backupValues(text: string): Partial<SettingsValues> | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        return null;
    }
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!isSettingsKey(key) || NOT_BACKED_UP.includes(key)) {
            continue;
        }
        if (
            !validateSetting(key, value) ||
            (key === 'siteProfiles' &&
                !siteProfilesUsable(prepareSettingValue(key, value)))
        ) {
            return null;
        }
        values[key] = prepareSettingValue(key, value);
    }
    return values;
}

/** How many of `backup`'s settings differ from what is stored. */
function changeCount(
    backup: Partial<SettingsValues>,
    stored: Partial<SettingsValues>
): number {
    return Object.entries(backup).filter(
        ([key, value]) =>
            !sameSettingValue(value, stored[key as keyof SettingsValues])
    ).length;
}

function download(name: string, text: string): void {
    const url = URL.createObjectURL(
        new Blob([text], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

export function AdvancedSection({ t, settings, save }: SectionProps) {
    const feedback = useFeedback();
    /** What a backup holds; null until it is read in full. */
    const backedUp = useSettings(BACKED_UP);
    const stored = backedUp.settings;
    /** The backup waiting to be applied, kept whole: what it would change
     *  is counted against the stored settings as they are now. */
    const [backup, setBackup] = useState<Partial<SettingsValues> | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const fileInput = useRef<HTMLInputElement | null>(null);
    /** Counts the files chosen, so only the newest one's read shows. */
    const chosenFiles = useRef(0);
    const chooseFile = useRef<HTMLButtonElement | null>(null);
    const resetButton = useRef<HTMLButtonElement | null>(null);
    const cancelReset = useRef<HTMLButtonElement | null>(null);
    const wasConfirming = useRef(false);
    const json = stored ? JSON.stringify(stored, null, 2) : '';

    useEffect(() => {
        if (confirmReset) {
            cancelReset.current?.focus();
        } else if (wasConfirming.current) {
            resetButton.current?.focus();
        }
        wasConfirming.current = confirmReset;
    }, [confirmReset]);

    /** Start `write` when this change's turn comes, with an Undo that puts
     *  back what it replaced wherever nothing changed it since. It says
     *  what it did even when that changed nothing, with no Undo then. */
    const replaceSettings = (
        write: () => Promise<SettingsWrite>,
        message: string
    ): void => {
        void feedback.apply(
            async () =>
                confirmChange((await write()).change, message) ?? {
                    message,
                    undo: null,
                }
        );
    };

    const closeLoad = (): void => {
        setBackup(null);
        chooseFile.current?.focus();
    };

    const copy = (text: string, message: string): void => {
        navigator.clipboard.writeText(text).then(
            () => feedback.notify(message, 'done'),
            () => feedback.notify(t('advancedCopyFailed'), 'problem')
        );
    };

    const diagnosticReport = (): string =>
        [
            `DualSub ${browser.runtime.getManifest().version}`,
            navigator.userAgent,
            json,
        ].join('\n\n');

    return (
        <section className="section" aria-labelledby="advanced-title">
            <h1 id="advanced-title" tabIndex={-1}>
                {t('navAdvanced')}
            </h1>
            <p className="lead">{t('advancedLead')}</p>
            {backedUp.status === 'unavailable' && (
                <p role="alert" className="notice danger">
                    {t('settingsLoadFailed')}
                </p>
            )}

            <div className="card" id="backup">
                <h2 className="label">{t('advancedBackupTitle')}</h2>
                <div className="row">
                    <div className="grow">
                        <div className="strong">{t('advancedSaveFile')}</div>
                        <p className="help">{t('advancedSaveFileHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        disabled={!stored}
                        onClick={() =>
                            download('dualsub-settings.json', `${json}\n`)
                        }
                    >
                        {t('advancedDownload')}
                    </button>
                </div>
                <div className="row">
                    <div className="grow">
                        <div className="strong">{t('advancedLoadFile')}</div>
                        <p className="help">{t('advancedLoadFileHelp')}</p>
                    </div>
                    <button
                        ref={chooseFile}
                        type="button"
                        className="button"
                        disabled={!stored}
                        onClick={() => fileInput.current?.click()}
                    >
                        {t('advancedChooseFile')}
                    </button>
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".json,application/json"
                        hidden
                        aria-label={t('advancedLoadFile')}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file || !stored) {
                                return;
                            }
                            const chosen = ++chosenFiles.current;
                            setBackup(null);
                            setLoadError(false);
                            const show = (values: typeof backup): void => {
                                if (chosen === chosenFiles.current) {
                                    setLoadError(values === null);
                                    setBackup(values);
                                }
                            };
                            file.text().then(
                                (text) => show(backupValues(text)),
                                () => show(null)
                            );
                        }}
                    />
                </div>
                {loadError && (
                    <p className="status-line error" role="alert">
                        {t('advancedLoadUnreadable')}
                    </p>
                )}
                {backup && stored && (
                    <div className="notice" role="status">
                        <div className="grow">
                            {changeCount(backup, stored) === 0
                                ? t('advancedLoadNothing')
                                : t(
                                      'advancedLoadPreview',
                                      changeCount(backup, stored)
                                  )}
                        </div>
                        {changeCount(backup, stored) > 0 && (
                            <button
                                type="button"
                                className="button primary"
                                onClick={() => {
                                    closeLoad();
                                    replaceSettings(
                                        () => configService.setMultiple(backup),
                                        t('toastLoaded')
                                    );
                                }}
                            >
                                {t('advancedLoadApply')}
                            </button>
                        )}
                        <button
                            type="button"
                            className="button"
                            onClick={closeLoad}
                        >
                            {t('commonCancel')}
                        </button>
                    </div>
                )}
            </div>

            <div className="card" id="json">
                <div className="row">
                    <div className="grow">
                        <h2 className="label">{t('advancedJsonTitle')}</h2>
                        <p className="help">{t('advancedJsonHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        disabled={!stored}
                        onClick={() => copy(json, t('toastCopied'))}
                    >
                        {t('advancedCopy')}
                    </button>
                </div>
                <pre className="code" tabIndex={0}>
                    {json}
                </pre>
            </div>

            <div className="card" id="troubleshooting">
                <h2 className="label">{t('advancedTroubleshootingTitle')}</h2>
                <div className="row">
                    <label className="strong grow" htmlFor="logging-level">
                        {t('advancedLoggingTitle')}
                    </label>
                    <select
                        id="logging-level"
                        className="field"
                        value={settings.loggingLevel}
                        onChange={(event) =>
                            void save({
                                loggingLevel: Number(event.target.value),
                            })
                        }
                    >
                        {LOGGING_LEVELS.map(({ level, labelKey }) => (
                            <option key={level} value={level}>
                                {t(labelKey)}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="row">
                    <div className="grow">
                        <div className="strong">{t('advancedReportTitle')}</div>
                        <p className="help">{t('advancedReportHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        disabled={!stored}
                        onClick={() =>
                            copy(diagnosticReport(), t('toastReportCopied'))
                        }
                    >
                        {t('advancedReportCopy')}
                    </button>
                </div>
            </div>

            <div className="card" id="reset">
                <h2 className="label">{t('advancedResetTitle')}</h2>
                {confirmReset ? (
                    <div
                        className="row"
                        role="group"
                        aria-labelledby="reset-confirm"
                    >
                        <div className="strong grow" id="reset-confirm">
                            {t('advancedResetConfirm')}
                        </div>
                        <div className="inline">
                            <button
                                type="button"
                                className="button danger"
                                onClick={() => {
                                    setConfirmReset(false);
                                    replaceSettings(
                                        resetSettings,
                                        t('toastReset')
                                    );
                                }}
                            >
                                {t('advancedResetDo')}
                            </button>
                            <button
                                ref={cancelReset}
                                type="button"
                                className="button"
                                onClick={() => setConfirmReset(false)}
                            >
                                {t('commonCancel')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="row">
                        <p className="help grow">{t('advancedResetHelp')}</p>
                        <button
                            ref={resetButton}
                            type="button"
                            className="button"
                            onClick={() => setConfirmReset(true)}
                        >
                            {t('advancedResetButton')}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}
