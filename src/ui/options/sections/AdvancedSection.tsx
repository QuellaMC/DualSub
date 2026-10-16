import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
    CREDENTIAL_SETUP,
    getDefaultValue,
    isSettingsKey,
    sameSettingValue,
    SENSITIVE_KEYS,
    SETTINGS_KEYS,
    validateSetting,
    prepareSettingValue,
    type SettingsKey,
    type SettingsValues,
} from '@/config/schema';
import { configService } from '@/config/service';
import { useFeedback } from '../shell/feedback';
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

/** What a reset leaves while everything else goes back to the recommended
 *  values: what is not backed up, how the page itself reads, and the
 *  setup of every key that stays, so a kept key never goes to a host it was
 *  not set up for. A setup without a key is reset with the rest. */
function keptOnReset(settings: SectionProps['settings']): Set<SettingsKey> {
    const kept = new Set<SettingsKey>([
        ...NOT_BACKED_UP,
        'uiLanguage',
        'showAdvancedSettings',
    ]);
    for (const [credential, setup] of Object.entries(CREDENTIAL_SETUP)) {
        if (settings[credential as keyof typeof CREDENTIAL_SETUP] !== '') {
            for (const key of setup) {
                kept.add(key);
            }
        }
    }
    return kept;
}

const LOGGING_LEVELS = [
    { level: 0, labelKey: 'advancedLoggingOff' },
    { level: 1, labelKey: 'advancedLoggingErrors' },
    { level: 2, labelKey: 'advancedLoggingWarnings' },
    { level: 3, labelKey: 'advancedLoggingNormal' },
    { level: 4, labelKey: 'advancedLoggingEverything' },
] as const;

/** Everything stored but what stays out of backups, as one JSON
 *  document. */
async function readStoredSettings(): Promise<Partial<SettingsValues>> {
    const { values } = await configService.readAllResultStrict();
    return Object.fromEntries(
        Object.entries(values).filter(
            ([key]) => !NOT_BACKED_UP.includes(key as SettingsKey)
        )
    );
}

/** The settings a backup file holds, ready to write: every non-sensitive
 *  one it names. Null for a file that is not a settings object, or holds a
 *  value this version cannot use for a setting it knows: loading the rest
 *  would restore the backup only in part. */
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
        if (!validateSetting(key, value)) {
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
    const [stored, setStored] = useState<Partial<SettingsValues> | null>(null);
    /** The backup waiting to be applied, kept whole: what it would change
     *  is counted against the stored settings as they are now. */
    const [backup, setBackup] = useState<Partial<SettingsValues> | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const fileInput = useRef<HTMLInputElement | null>(null);
    const chooseFile = useRef<HTMLButtonElement | null>(null);
    const resetButton = useRef<HTMLButtonElement | null>(null);
    const cancelReset = useRef<HTMLButtonElement | null>(null);
    const wasConfirming = useRef(false);
    const json = stored ? JSON.stringify(stored, null, 2) : '';

    useEffect(() => {
        let active = true;
        const refresh = (): void => {
            void readStoredSettings().then(
                (values) => {
                    if (active) {
                        setStored(values);
                    }
                },
                () => undefined
            );
        };
        refresh();
        const stop = configService.onChanged(refresh);
        return () => {
            active = false;
            stop();
        };
    }, []);

    useEffect(() => {
        if (confirmReset) {
            cancelReset.current?.focus();
        } else if (wasConfirming.current) {
            resetButton.current?.focus();
        }
        wasConfirming.current = confirmReset;
    }, [confirmReset]);

    /** Write `changes`, with an Undo that puts back what they replaced. */
    const replaceSettings = (
        changes: Partial<SettingsValues>,
        message: string
    ): void => {
        let before: Partial<SettingsValues> = {};
        void feedback.apply(
            async () => {
                before = await configService.getMultiple(Object.keys(changes));
                try {
                    await configService.setMultiple(changes);
                } catch (error) {
                    // One storage area may have taken its part; put it back.
                    await configService
                        .setMultiple(before)
                        .catch(() => undefined);
                    throw error;
                }
            },
            message,
            () => configService.setMultiple(before)
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
                            void file.text().then((text) => {
                                const values = backupValues(text);
                                setLoadError(values === null);
                                setBackup(values);
                            });
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
                                    replaceSettings(backup, t('toastLoaded'));
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
                                    const defaults: Record<string, unknown> =
                                        {};
                                    const kept = keptOnReset(settings);
                                    for (const key of SETTINGS_KEYS) {
                                        if (!kept.has(key)) {
                                            defaults[key] =
                                                getDefaultValue(key);
                                        }
                                    }
                                    replaceSettings(defaults, t('toastReset'));
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
