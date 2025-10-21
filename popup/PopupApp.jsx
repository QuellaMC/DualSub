import React, { useState, useEffect, useRef } from 'react';
import {
    useSettings,
    useTranslation,
    useChromeMessage,
    useLogger,
} from './hooks/index.js';
import { Header } from './components/Header.jsx';
import { SettingToggle } from './components/SettingToggle.jsx';
import { LanguageSelector } from './components/LanguageSelector.jsx';
import { AppearanceSettings } from './components/AppearanceSettings.jsx';
import { StatusMessage } from './components/StatusMessage.jsx';

export function PopupApp() {
    const { settings, updateSetting, loading, error } = useSettings();
    const { t, loading: translationsLoading } = useTranslation(
        settings.uiLanguage || 'en'
    );
    const { sendImmediateConfigUpdate } = useChromeMessage();
    const logger = useLogger('Popup');

    const [statusMessage, setStatusMessage] = useState('');
    const statusTimeoutRef = useRef(null);

    const showStatus = (message, duration = 3000) => {
        if (statusTimeoutRef.current) {
            clearTimeout(statusTimeoutRef.current);
        }

        setStatusMessage(message);
        statusTimeoutRef.current = setTimeout(() => {
            setStatusMessage('');
            statusTimeoutRef.current = null;
        }, duration);
    };

    useEffect(() => {
        return () => {
            if (statusTimeoutRef.current) {
                clearTimeout(statusTimeoutRef.current);
            }
        };
    }, []);

    // Show error if settings failed to load
    useEffect(() => {
        if (error && logger) {
            logger.error('Error loading settings', error, {
                component: 'loadSettings',
            });
            showStatus(
                'Failed to load settings. Please try refreshing the popup.',
                5000
            );
        }
    }, [error, logger]);

    const handleToggleSubtitles = async (enabled) => {
        try {
            await updateSetting('subtitlesEnabled', enabled);
            const statusKey = enabled
                ? 'statusDualEnabled'
                : 'statusDualDisabled';
            const statusText = t(
                statusKey,
                enabled ? 'Dual subtitles enabled.' : 'Dual subtitles disabled.'
            );
            showStatus(statusText);
            sendImmediateConfigUpdate({ subtitlesEnabled: enabled });
        } catch (error) {
            if (logger) {
                logger.error('Error toggling subtitles', error, {
                    enabled,
                    component: 'enableSubtitlesToggle',
                });
            }
            showStatus('Failed to update subtitle setting. Please try again.');
        }
    };

    const handleToggleNativeSubtitles = async (useOfficial) => {
        try {
            await updateSetting('useNativeSubtitles', useOfficial);
            await updateSetting('useOfficialTranslations', useOfficial);

            const statusKey = useOfficial
                ? 'statusSmartTranslationEnabled'
                : 'statusSmartTranslationDisabled';
            const statusText = t(
                statusKey,
                useOfficial
                    ? 'Official subtitles enabled.'
                    : 'Official subtitles disabled.'
            );
            showStatus(statusText);

            sendImmediateConfigUpdate({
                useNativeSubtitles: useOfficial,
                useOfficialTranslations: useOfficial,
            });
        } catch (error) {
            if (logger) {
                logger.error('Error toggling official subtitles', error, {
                    useOfficial,
                    component: 'useNativeSubtitlesToggle',
                });
            }
            showStatus(
                'Failed to update official subtitles setting. Please try again.'
            );
        }
    };

    const handleOriginalLanguageChange = async (lang) => {
        try {
            await updateSetting('originalLanguage', lang);
            const statusText = `${t('statusOriginalLanguage', 'Original language: ')}${t(`lang_${lang.replace('-', '_')}`, lang)}`;
            showStatus(statusText);
            sendImmediateConfigUpdate({ originalLanguage: lang });
        } catch (error) {
            if (logger) {
                logger.error('Error setting original language', error, {
                    lang,
                    component: 'originalLanguageSelect',
                });
            }
            showStatus('Failed to update original language. Please try again.');
        }
    };

    const handleTargetLanguageChange = async (lang) => {
        try {
            await updateSetting('targetLanguage', lang);
            const statusText = `${t('statusLanguageSetTo', 'Language set to: ')}${t(`lang_${lang.replace('-', '_')}`, lang)}`;
            showStatus(statusText);
            sendImmediateConfigUpdate({ targetLanguage: lang });
        } catch (error) {
            if (logger) {
                logger.error('Error setting target language', error, {
                    lang,
                    component: 'targetLanguageSelect',
                });
            }
            showStatus('Failed to update target language. Please try again.');
        }
    };

    const handleLayoutOrderChange = async (layoutOrder) => {
        try {
            await updateSetting('subtitleLayoutOrder', layoutOrder);
            showStatus(
                t('statusDisplayOrderUpdated', 'Display order updated.')
            );
            sendImmediateConfigUpdate({ subtitleLayoutOrder: layoutOrder });
        } catch (error) {
            if (logger) {
                logger.error('Error setting layout order', error, {
                    layoutOrder,
                    component: 'subtitleLayoutOrderSelect',
                });
            }
            showStatus('Failed to update display order. Please try again.');
        }
    };

    const handleLayoutOrientationChange = async (layoutOrientation) => {
        try {
            await updateSetting('subtitleLayoutOrientation', layoutOrientation);
            showStatus(
                t(
                    'statusLayoutOrientationUpdated',
                    'Layout orientation updated.'
                )
            );
            sendImmediateConfigUpdate({
                subtitleLayoutOrientation: layoutOrientation,
            });
        } catch (error) {
            if (logger) {
                logger.error('Error setting layout orientation', error, {
                    layoutOrientation,
                    component: 'subtitleLayoutOrientationSelect',
                });
            }
            showStatus(
                'Failed to update layout orientation. Please try again.'
            );
        }
    };

    const handleFontSizeChange = (fontSize) => {
        // Real-time update without saving
        sendImmediateConfigUpdate({ subtitleFontSize: fontSize });
    };

    const handleFontSizeChangeEnd = async (fontSize) => {
        try {
            await updateSetting('subtitleFontSize', fontSize);
            showStatus(
                `${t('statusFontSize', 'Font size: ')}${fontSize.toFixed(1)}vw.`
            );
            sendImmediateConfigUpdate({ subtitleFontSize: fontSize });
        } catch (error) {
            if (logger) {
                logger.error('Error setting font size', error, {
                    fontSize,
                    component: 'subtitleFontSizeInput',
                });
            }
            showStatus('Failed to update font size. Please try again.');
        }
    };

    const handleGapChange = (gap) => {
        // Real-time update without saving
        sendImmediateConfigUpdate({ subtitleGap: gap });
    };

    const handleGapChangeEnd = async (gap) => {
        try {
            await updateSetting('subtitleGap', gap);
            showStatus(
                `${t('statusVerticalGap', 'Vertical gap: ')}${gap.toFixed(1)}em.`
            );
            sendImmediateConfigUpdate({ subtitleGap: gap });
        } catch (error) {
            if (logger) {
                logger.error('Error setting subtitle gap', error, {
                    gap,
                    component: 'subtitleGapInput',
                });
            }
            showStatus('Failed to update subtitle gap. Please try again.');
        }
    };

    const handleVerticalPositionChange = (verticalPosition) => {
        // Real-time update without saving
        sendImmediateConfigUpdate({
            subtitleVerticalPosition: verticalPosition,
        });
    };

    const handleVerticalPositionChangeEnd = async (verticalPosition) => {
        try {
            await updateSetting('subtitleVerticalPosition', verticalPosition);
            showStatus(
                `${t('statusVerticalPosition', 'Vertical position: ')}${verticalPosition.toFixed(1)}.`
            );
            sendImmediateConfigUpdate({
                subtitleVerticalPosition: verticalPosition,
            });
        } catch (error) {
            if (logger) {
                logger.error(
                    'Error setting subtitle vertical position',
                    error,
                    {
                        verticalPosition,
                        component: 'subtitleVerticalPositionInput',
                    }
                );
            }
            showStatus('Failed to update vertical position. Please try again.');
        }
    };

    const handleTimeOffsetChange = async (value) => {
        try {
            let offset = parseFloat(value);
            if (isNaN(offset)) {
                showStatus(
                    t('statusInvalidOffset', 'Invalid offset, reverting.')
                );
                return;
            }
            offset = parseFloat(offset.toFixed(2));
            await updateSetting('subtitleTimeOffset', offset);
            showStatus(`${t('statusTimeOffset', 'Time offset: ')}${offset}s.`);
            sendImmediateConfigUpdate({ subtitleTimeOffset: offset });
        } catch (error) {
            if (logger) {
                logger.error('Error setting time offset', error, {
                    offset: parseFloat(value),
                    component: 'subtitleTimeOffsetInput',
                });
            }
            showStatus('Failed to update time offset. Please try again.');
        }
    };

    const handleAccordionToggle = async (e) => {
        try {
            await updateSetting('appearanceAccordionOpen', e.target.open);
        } catch (error) {
            if (logger) {
                logger.error('Error saving accordion state', error, {
                    component: 'appearanceAccordion',
                });
            }
        }
    };

    const handleOpenOptions = () => {
        chrome.runtime.openOptionsPage();
    };

    const handleOpenGitHub = () => {
        chrome.tabs.create({ url: 'https://github.com/QuellaMC/DualSub' });
    };

    if (loading || translationsLoading) {
        return <div>Loading...</div>;
    }

    const {
        subtitlesEnabled = false,
        useOfficialTranslations,
        useNativeSubtitles,
        originalLanguage = 'en',
        targetLanguage = 'es',
        subtitleLayoutOrder = 'original_top',
        subtitleLayoutOrientation = 'column',
        subtitleFontSize = 1.1,
        subtitleGap = 0.3,
        subtitleVerticalPosition = 2.8,
        subtitleTimeOffset = 0.3,
        appearanceAccordionOpen = false,
    } = settings;

    // Use useOfficialTranslations if available, fallback to useNativeSubtitles
    const useOfficial =
        useOfficialTranslations !== undefined
            ? useOfficialTranslations
            : useNativeSubtitles;

    return (
        <>
            <Header
                t={t}
                onOpenOptions={handleOpenOptions}
                onOpenGitHub={handleOpenGitHub}
            />

            <SettingToggle
                id="enableSubtitles"
                label={t('enableSubtitlesLabel', 'Enable Dual Subtitles')}
                checked={subtitlesEnabled}
                onChange={handleToggleSubtitles}
            />

            <SettingToggle
                id="useNativeSubtitles"
                label={t(
                    'useNativeSubtitlesLabel',
                    'Use Official Subtitles When Available'
                )}
                checked={useOfficial}
                onChange={handleToggleNativeSubtitles}
            />

            <LanguageSelector
                t={t}
                originalLanguage={originalLanguage}
                targetLanguage={targetLanguage}
                onOriginalChange={handleOriginalLanguageChange}
                onTargetChange={handleTargetLanguageChange}
            />

            <AppearanceSettings
                t={t}
                isOpen={appearanceAccordionOpen}
                onToggle={handleAccordionToggle}
                layoutOrder={subtitleLayoutOrder}
                layoutOrientation={subtitleLayoutOrientation}
                fontSize={subtitleFontSize}
                gap={subtitleGap}
                verticalPosition={subtitleVerticalPosition}
                timeOffset={subtitleTimeOffset}
                onLayoutOrderChange={handleLayoutOrderChange}
                onLayoutOrientationChange={handleLayoutOrientationChange}
                onFontSizeChange={handleFontSizeChange}
                onFontSizeChangeEnd={handleFontSizeChangeEnd}
                onGapChange={handleGapChange}
                onGapChangeEnd={handleGapChangeEnd}
                onVerticalPositionChange={handleVerticalPositionChange}
                onVerticalPositionChangeEnd={handleVerticalPositionChangeEnd}
                onTimeOffsetChange={handleTimeOffsetChange}
            />

            <StatusMessage message={statusMessage} />
        </>
    );
}
