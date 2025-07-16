// disneyplus-dualsub-chrome-extension/popup/popup.js
import { configService } from '../services/configService.js';
import Logger from '../utils/logger.js';

document.addEventListener('DOMContentLoaded', function () {
    // Initialize popup logger
    const popupLogger = Logger.create('Popup', configService);
    
    // Initialize logging level from configuration
    (async () => {
        try {
            const loggingLevel = await configService.get('loggingLevel');
            popupLogger.updateLevel(loggingLevel);
            popupLogger.info('Popup logger initialized', { level: loggingLevel });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            popupLogger.updateLevel(Logger.LEVELS.INFO);
            popupLogger.warn('Failed to load logging level from config, using INFO level', error);
        }
    })();

    // Listen for logging level changes
    configService.onChanged((changes) => {
        if ('loggingLevel' in changes) {
            popupLogger.updateLevel(changes.loggingLevel);
            popupLogger.info('Logging level updated from configuration change', { 
                newLevel: changes.loggingLevel 
            });
        }
    });

    // UI Element References
    const enableSubtitlesToggle = document.getElementById('enableSubtitles');
    const useNativeSubtitlesToggle =
        document.getElementById('useNativeSubtitles');
    const originalLanguageSelect = document.getElementById('originalLanguage');
    const targetLanguageSelect = document.getElementById('targetLanguage');
    const subtitleTimeOffsetInput =
        document.getElementById('subtitleTimeOffset');
    const subtitleLayoutOrderSelect = document.getElementById(
        'subtitleLayoutOrder'
    );
    const subtitleLayoutOrientationSelect = document.getElementById(
        'subtitleLayoutOrientation'
    );
    const subtitleFontSizeInput = document.getElementById('subtitleFontSize');
    const subtitleFontSizeValue = document.getElementById(
        'subtitleFontSizeValue'
    );
    const subtitleGapInput = document.getElementById('subtitleGap');
    const subtitleGapValue = document.getElementById('subtitleGapValue');
    const statusMessage = document.getElementById('statusMessage');
    const openOptionsPageButton = document.getElementById('openOptionsPage');
    const openGithubLinkButton = document.getElementById('openGithubLink');
    const appearanceAccordion = document.querySelector('.accordion-card');

    // Caches for performance
    let loadedTranslations = {};
    const translationsCache = {};
    let statusTimeoutId = null; // Track status message timeout

    // Language and layout options mapping
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
    const layoutOrderOptions = {
        original_top: 'displayOrderOriginalFirst',
        translation_top: 'displayOrderTranslationFirst',
    };
    const layoutOrientationOptions = {
        column: 'layoutTopBottom',
        row: 'layoutLeftRight',
    };

    const updateSliderProgress = (sliderElement) => {
        const value = sliderElement.value;
        const min = sliderElement.min || 0;
        const max = sliderElement.max || 100;
        const percentage = ((value - min) / (max - min)) * 100;
        sliderElement.style.backgroundSize = `${percentage}% 100%`;
    };

    const populateDropdown = (selectElement, options, currentValue) => {
        selectElement.innerHTML = ''; // Clear existing options
        for (const value in options) {
            const i18nKey = options[value];
            const localizedName =
                (loadedTranslations[i18nKey] &&
                    loadedTranslations[i18nKey].message) ||
                value;
            const option = document.createElement('option');
            option.value = value;
            option.textContent = localizedName;
            selectElement.appendChild(option);
        }
        if (currentValue) selectElement.value = currentValue;
    };

    const loadSettings = async () => {
        try {
            // Get all settings from the configuration service
            const settings = await configService.getAll();

            // Load translations first to populate dropdowns correctly
            const uiLang = settings.uiLanguage;
            loadedTranslations = await loadTranslations(uiLang);

            // Populate UI with loaded settings
            enableSubtitlesToggle.checked = settings.subtitlesEnabled;
            useNativeSubtitlesToggle.checked = settings.useNativeSubtitles;
            subtitleTimeOffsetInput.value = settings.subtitleTimeOffset;

            const fontSize = settings.subtitleFontSize;
            subtitleFontSizeInput.value = fontSize;
            subtitleFontSizeValue.textContent = `${parseFloat(fontSize).toFixed(1)}vw`;
            updateSliderProgress(subtitleFontSizeInput);

            const gap = settings.subtitleGap;
            subtitleGapInput.value = gap;
            subtitleGapValue.textContent = `${parseFloat(gap).toFixed(1)}em`;
            updateSliderProgress(subtitleGapInput);

            appearanceAccordion.open = settings.appearanceAccordionOpen;

            // Populate dropdowns now that translations are loaded
            updateUILanguage();
            originalLanguageSelect.value = settings.originalLanguage;
            targetLanguageSelect.value = settings.targetLanguage;
            subtitleLayoutOrderSelect.value = settings.subtitleLayoutOrder;
            subtitleLayoutOrientationSelect.value =
                settings.subtitleLayoutOrientation;
        } catch (error) {
            popupLogger.error('Error loading settings', error, { component: 'loadSettings' });
            showStatus(
                'Failed to load settings. Please try refreshing the popup.',
                5000
            );
        }
    };

    const showStatus = (message, duration = 3000) => {
        // Clear any existing timeout to prevent interference
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
        }

        statusMessage.textContent = message;
        statusTimeoutId = setTimeout(() => {
            statusMessage.textContent = '';
            statusTimeoutId = null;
        }, duration);
    };

    /**
     * Sends immediate config change message to content scripts for instant visual feedback.
     * This works alongside the storage change mechanism as a fallback for immediate updates.
     * @param {Object} changes - Object containing the changed config keys and their new values
     */
    const sendImmediateConfigUpdate = (changes) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs
                    .sendMessage(tabs[0].id, {
                        action: 'configChanged',
                        changes: changes,
                    })
                    .catch((error) => {
                        // Fail silently - the storage change mechanism should handle it as fallback
                        popupLogger.debug(
                            'Direct message failed, relying on storage events',
                            { error: error.message, component: 'sendImmediateConfigUpdate' }
                        );
                    });
            }
        });
    };

    // --- Event Listeners ---
    enableSubtitlesToggle.addEventListener('change', async function () {
        try {
            const enabled = this.checked;
            await configService.set('subtitlesEnabled', enabled);
            const statusKey = enabled
                ? 'statusDualEnabled'
                : 'statusDualDisabled';
            const statusText =
                loadedTranslations[statusKey]?.message ||
                (enabled
                    ? 'Dual subtitles enabled.'
                    : 'Dual subtitles disabled.');
            showStatus(statusText);

            // Send immediate update for instant visual feedback and proper cleanup
            sendImmediateConfigUpdate({ subtitlesEnabled: enabled });
        } catch (error) {
            popupLogger.error('Error toggling subtitles', error, { enabled, component: 'enableSubtitlesToggle' });
            showStatus('Failed to update subtitle setting. Please try again.');
        }
    });

    useNativeSubtitlesToggle.addEventListener('change', async function () {
        try {
            const useNative = this.checked;
            await configService.set('useNativeSubtitles', useNative);
            const statusKey = useNative
                ? 'statusSmartTranslationEnabled'
                : 'statusSmartTranslationDisabled';
            const statusText =
                loadedTranslations[statusKey]?.message ||
                (useNative
                    ? 'Smart translation enabled.'
                    : 'Smart translation disabled.');
            showStatus(statusText);

            // Send immediate update for instant visual feedback and proper cleanup
            sendImmediateConfigUpdate({ useNativeSubtitles: useNative });
        } catch (error) {
            popupLogger.error('Error toggling native subtitles', error, { useNative, component: 'useNativeSubtitlesToggle' });
            showStatus(
                'Failed to update smart translation setting. Please try again.'
            );
        }
    });

    originalLanguageSelect.addEventListener('change', async function () {
        try {
            const lang = this.value;
            await configService.set('originalLanguage', lang);
            const statusPrefix =
                loadedTranslations['statusOriginalLanguage']?.message ||
                'Original language: ';
            const statusText = `${statusPrefix}${this.options[this.selectedIndex].text}`;
            showStatus(statusText);

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ originalLanguage: lang });
        } catch (error) {
            popupLogger.error('Error setting original language', error, { lang, component: 'originalLanguageSelect' });
            showStatus('Failed to update original language. Please try again.');
        }
    });

    targetLanguageSelect.addEventListener('change', async function () {
        try {
            const lang = this.value;
            await configService.set('targetLanguage', lang);
            const statusPrefix =
                loadedTranslations['statusLanguageSetTo']?.message ||
                'Language set to: ';
            showStatus(
                `${statusPrefix}${this.options[this.selectedIndex].text}`
            );

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ targetLanguage: lang });
        } catch (error) {
            popupLogger.error('Error setting target language', error, { lang, component: 'targetLanguageSelect' });
            showStatus('Failed to update target language. Please try again.');
        }
    });

    subtitleTimeOffsetInput.addEventListener('change', async function () {
        try {
            let offset = parseFloat(this.value);
            if (isNaN(offset)) {
                const invalidMsg =
                    loadedTranslations['statusInvalidOffset']?.message ||
                    'Invalid offset, reverting.';
                showStatus(invalidMsg);
                try {
                    const currentOffset =
                        await configService.get('subtitleTimeOffset');
                    this.value = currentOffset;
                } catch (error) {
                    popupLogger.error(
                        'Error loading subtitle time offset',
                        error,
                        { component: 'subtitleTimeOffsetInput' }
                    );
                }
                return;
            }
            offset = parseFloat(offset.toFixed(2));
            this.value = offset;
            await configService.set('subtitleTimeOffset', offset);
            const statusPrefix =
                loadedTranslations['statusTimeOffset']?.message ||
                'Time offset: ';
            showStatus(`${statusPrefix}${offset}s.`);

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ subtitleTimeOffset: offset });
        } catch (error) {
            popupLogger.error('Error setting time offset', error, { offset, component: 'subtitleTimeOffsetInput' });
            showStatus('Failed to update time offset. Please try again.');
        }
    });

    subtitleLayoutOrderSelect.addEventListener('change', async function () {
        try {
            const layoutOrder = this.value;
            await configService.set('subtitleLayoutOrder', layoutOrder);
            const statusText =
                loadedTranslations['statusDisplayOrderUpdated']?.message ||
                `Display order updated.`;
            showStatus(statusText);

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ subtitleLayoutOrder: layoutOrder });
        } catch (error) {
            popupLogger.error('Error setting layout order', error, { layoutOrder, component: 'subtitleLayoutOrderSelect' });
            showStatus('Failed to update display order. Please try again.');
        }
    });

    subtitleLayoutOrientationSelect.addEventListener(
        'change',
        async function () {
            try {
                const layoutOrientation = this.value;
                await configService.set(
                    'subtitleLayoutOrientation',
                    layoutOrientation
                );
                const statusText =
                    loadedTranslations['statusLayoutOrientationUpdated']
                        ?.message || `Layout orientation updated.`;
                showStatus(statusText);

                // Send immediate update for instant visual feedback
                sendImmediateConfigUpdate({
                    subtitleLayoutOrientation: layoutOrientation,
                });
            } catch (error) {
                popupLogger.error(
                    'Error setting layout orientation',
                    error,
                    { layoutOrientation, component: 'subtitleLayoutOrientationSelect' }
                );
                showStatus(
                    'Failed to update layout orientation. Please try again.'
                );
            }
        }
    );

    subtitleFontSizeInput.addEventListener('input', function () {
        subtitleFontSizeValue.textContent = `${parseFloat(this.value).toFixed(1)}vw`;
        updateSliderProgress(this);
    });
    subtitleFontSizeInput.addEventListener('change', async function () {
        try {
            const fontSize = parseFloat(this.value);
            await configService.set('subtitleFontSize', fontSize);
            const statusPrefix =
                loadedTranslations['statusFontSize']?.message || 'Font size: ';
            showStatus(`${statusPrefix}${fontSize.toFixed(1)}vw.`);

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ subtitleFontSize: fontSize });
        } catch (error) {
            popupLogger.error('Error setting font size', error, { fontSize, component: 'subtitleFontSizeInput' });
            showStatus('Failed to update font size. Please try again.');
        }
    });

    subtitleGapInput.addEventListener('input', function () {
        subtitleGapValue.textContent = `${parseFloat(this.value).toFixed(1)}em`;
        updateSliderProgress(this);
    });
    subtitleGapInput.addEventListener('change', async function () {
        try {
            const gap = parseFloat(this.value);
            await configService.set('subtitleGap', gap);
            const statusPrefix =
                loadedTranslations['statusVerticalGap']?.message ||
                'Vertical gap: ';
            showStatus(`${statusPrefix}${gap.toFixed(1)}em.`);

            // Send immediate update for instant visual feedback
            sendImmediateConfigUpdate({ subtitleGap: gap });
        } catch (error) {
            popupLogger.error('Error setting subtitle gap', error, { gap, component: 'subtitleGapInput' });
            showStatus('Failed to update subtitle gap. Please try again.');
        }
    });

    appearanceAccordion.addEventListener('toggle', async function () {
        await configService.set('appearanceAccordionOpen', this.open);
    });

    openOptionsPageButton.addEventListener('click', () =>
        chrome.runtime.openOptionsPage()
    );
    openGithubLinkButton.addEventListener('click', () =>
        chrome.tabs.create({ url: 'https://github.com/QuellaMC/DualSub' })
    );

    // --- Language and Initialization ---
    const loadTranslations = async function (langCode) {
        // Convert hyphens to underscores for folder structure (zh-CN -> zh_CN)
        const normalizedLangCode = langCode.replace('-', '_');
        if (translationsCache[normalizedLangCode])
            return translationsCache[normalizedLangCode];

        const translationsPath = chrome.runtime.getURL(
            `_locales/${normalizedLangCode}/messages.json`
        );
        try {
            const response = await fetch(translationsPath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const translations = await response.json();
            translationsCache[normalizedLangCode] = translations;
            return translations;
        } catch (error) {
            popupLogger.warn(
                `Could not load '${normalizedLangCode}' translations, falling back to English`,
                { normalizedLangCode, error: error.message, component: 'loadTranslations' }
            );
            // Fallback to English
            const fallbackPath = chrome.runtime.getURL(
                `_locales/en/messages.json`
            );
            try {
                const fallbackResponse = await fetch(fallbackPath);
                const translations = await fallbackResponse.json();
                translationsCache['en'] = translations;
                return translations;
            } catch (fatalError) {
                popupLogger.error(
                    'Fatal: Failed to load any translations, including English',
                    fatalError,
                    { component: 'loadTranslations' }
                );
                return {};
            }
        }
    };

    const updateUILanguage = function () {
        // Apply translations to all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach((elem) => {
            const key = elem.getAttribute('data-i18n');
            if (loadedTranslations[key]?.message) {
                if (elem.tagName === 'SUMMARY') {
                    // Preserve the dropdown arrow
                    elem.childNodes[0].nodeValue =
                        loadedTranslations[key].message + ' ';
                } else {
                    elem.textContent = loadedTranslations[key].message;
                }
            }
        });
        // Repopulate dropdowns with translated text
        populateDropdown(
            originalLanguageSelect,
            supportedLanguages,
            originalLanguageSelect.value
        );
        populateDropdown(
            targetLanguageSelect,
            supportedLanguages,
            targetLanguageSelect.value
        );
        populateDropdown(
            subtitleLayoutOrderSelect,
            layoutOrderOptions,
            subtitleLayoutOrderSelect.value
        );
        populateDropdown(
            subtitleLayoutOrientationSelect,
            layoutOrientationOptions,
            subtitleLayoutOrientationSelect.value
        );
    };

    // Listen for language changes from other parts of the extension (e.g., options page)
    configService.onChanged(async (changes) => {
        if (changes.uiLanguage) {
            const newLang = changes.uiLanguage;
            popupLogger.info(
                `Detected UI language change to '${newLang}'. Reloading UI.`,
                { newLang, component: 'uiLanguageChange' }
            );
            loadedTranslations = await loadTranslations(newLang);
            updateUILanguage();
        }
    });

    // Initial setup
    loadSettings();
});
