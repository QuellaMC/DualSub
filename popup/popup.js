// disneyplus-dualsub-chrome-extension/popup/popup.js
import { configService } from '../services/configService.js';

document.addEventListener('DOMContentLoaded', function () {
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



    function updateSliderProgress(sliderElement) {
        const value = sliderElement.value;
        const min = sliderElement.min || 0;
        const max = sliderElement.max || 100;
        const percentage = ((value - min) / (max - min)) * 100;
        sliderElement.style.backgroundSize = `${percentage}% 100%`;
    }

    function populateDropdown(selectElement, options, currentValue) {
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
    }

    async function loadSettings() {
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
            subtitleLayoutOrientationSelect.value = settings.subtitleLayoutOrientation;
        } catch (error) {
            console.error('Popup: Error loading settings:', error);
        }
    }

    function showStatus(message, duration = 3000) {
        // Clear any existing timeout to prevent interference
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
        }

        statusMessage.textContent = message;
        statusTimeoutId = setTimeout(() => {
            statusMessage.textContent = '';
            statusTimeoutId = null;
        }, duration);
    }

    /**
     * Sends immediate config change message to content scripts for instant visual feedback.
     * This works alongside the storage change mechanism as a fallback for immediate updates.
     * @param {Object} changes - Object containing the changed config keys and their new values
     */
    function sendImmediateConfigUpdate(changes) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { 
                    action: 'configChanged',
                    changes: changes
                }).catch(error => {
                    // Fail silently - the storage change mechanism should handle it as fallback
                    console.log('Popup: Direct message failed, relying on storage events:', error);
                });
            }
        });
    }


    // --- Event Listeners ---
    enableSubtitlesToggle.addEventListener('change', async function () {
        const enabled = this.checked;
        await configService.set('subtitlesEnabled', enabled);
        const statusKey = enabled ? 'statusDualEnabled' : 'statusDualDisabled';
        const statusText =
            loadedTranslations[statusKey]?.message ||
            (enabled ? 'Dual subtitles enabled.' : 'Dual subtitles disabled.');
        showStatus(statusText);
    });

    useNativeSubtitlesToggle.addEventListener('change', async function () {
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
    });

    originalLanguageSelect.addEventListener('change', async function () {
        const lang = this.value;
        await configService.set('originalLanguage', lang);
        const statusPrefix =
            loadedTranslations['statusOriginalLanguage']?.message ||
            'Original language: ';
        const statusText = `${statusPrefix}${this.options[this.selectedIndex].text}`;
        showStatus(statusText);
    });

    targetLanguageSelect.addEventListener('change', async function () {
        const lang = this.value;
        await configService.set('targetLanguage', lang);
        const statusPrefix =
            loadedTranslations['statusLanguageSetTo']?.message ||
            'Language set to: ';
        showStatus(`${statusPrefix}${this.options[this.selectedIndex].text}`);
    });

    subtitleTimeOffsetInput.addEventListener('change', async function () {
        let offset = parseFloat(this.value);
        if (isNaN(offset)) {
            const invalidMsg =
                loadedTranslations['statusInvalidOffset']?.message ||
                'Invalid offset, reverting.';
            showStatus(invalidMsg);
            try {
                const currentOffset = await configService.get('subtitleTimeOffset');
                this.value = currentOffset;
            } catch (error) {
                console.error('Popup: Error loading subtitle time offset:', error);
            }
            return;
        }
        offset = parseFloat(offset.toFixed(2));
        this.value = offset;
        await configService.set('subtitleTimeOffset', offset);
        const statusPrefix =
            loadedTranslations['statusTimeOffset']?.message || 'Time offset: ';
        showStatus(`${statusPrefix}${offset}s.`);
    });

    subtitleLayoutOrderSelect.addEventListener('change', async function () {
        const layoutOrder = this.value;
        await configService.set('subtitleLayoutOrder', layoutOrder);
        const statusText =
            loadedTranslations['statusDisplayOrderUpdated']?.message ||
            `Display order updated.`;
        showStatus(statusText);
        
        // Send immediate update for instant visual feedback
        sendImmediateConfigUpdate({ subtitleLayoutOrder: layoutOrder });
    });

    subtitleLayoutOrientationSelect.addEventListener('change', async function () {
        const layoutOrientation = this.value;
        await configService.set('subtitleLayoutOrientation', layoutOrientation);
        const statusText =
            loadedTranslations['statusLayoutOrientationUpdated']?.message ||
            `Layout orientation updated.`;
        showStatus(statusText);
        
        // Send immediate update for instant visual feedback
        sendImmediateConfigUpdate({ subtitleLayoutOrientation: layoutOrientation });
    });

    subtitleFontSizeInput.addEventListener('input', function () {
        subtitleFontSizeValue.textContent = `${parseFloat(this.value).toFixed(1)}vw`;
        updateSliderProgress(this);
    });
    subtitleFontSizeInput.addEventListener('change', async function () {
        const fontSize = parseFloat(this.value);
        await configService.set('subtitleFontSize', fontSize);
        const statusPrefix =
            loadedTranslations['statusFontSize']?.message || 'Font size: ';
        showStatus(`${statusPrefix}${fontSize.toFixed(1)}vw.`);
        
        // Send immediate update for instant visual feedback
        sendImmediateConfigUpdate({ subtitleFontSize: fontSize });
    });

    subtitleGapInput.addEventListener('input', function () {
        subtitleGapValue.textContent = `${parseFloat(this.value).toFixed(1)}em`;
        updateSliderProgress(this);
    });
    subtitleGapInput.addEventListener('change', async function () {
        const gap = parseFloat(this.value);
        await configService.set('subtitleGap', gap);
        const statusPrefix =
            loadedTranslations['statusVerticalGap']?.message ||
            'Vertical gap: ';
        showStatus(`${statusPrefix}${gap.toFixed(1)}em.`);
        
        // Send immediate update for instant visual feedback
        sendImmediateConfigUpdate({ subtitleGap: gap });
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
    async function loadTranslations(langCode) {
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
            console.warn(
                `Could not load '${normalizedLangCode}' translations, falling back to English. Error:`,
                error
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
                console.error(
                    `Fatal: Failed to load any translations, including English.`,
                    fatalError
                );
                return {};
            }
        }
    }

    function updateUILanguage() {
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
    }

    // Listen for language changes from other parts of the extension (e.g., options page)
    configService.onChanged(async (changes) => {
        if (changes.uiLanguage) {
            const newLang = changes.uiLanguage;
            console.log(
                `Popup: Detected UI language change to '${newLang}'. Reloading UI.`
            );
            loadedTranslations = await loadTranslations(newLang);
            updateUILanguage();
        }
    });

    // Initial setup
    loadSettings();
});
