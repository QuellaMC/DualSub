// disneyplus-dualsub-chrome-extension/popup/popup.js
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

    // Default settings for the extension
    const defaultSettings = {
        subtitlesEnabled: true,
        useNativeSubtitles: true,
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
        subtitleTimeOffset: 0.3,
        subtitleLayoutOrder: 'original_top',
        subtitleLayoutOrientation: 'column',
        subtitleFontSize: 1.1,
        subtitleGap: 0.3,
        appearanceAccordionOpen: false,
        uiLanguage: 'en',
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
        const settingsToLoad = Object.keys(defaultSettings);
        const items = await chrome.storage.sync.get(settingsToLoad);

        // Load translations first to populate dropdowns correctly
        const uiLang = items.uiLanguage || defaultSettings.uiLanguage;
        loadedTranslations = await loadTranslations(uiLang);

        // Populate UI with loaded or default settings
        enableSubtitlesToggle.checked =
            items.subtitlesEnabled !== undefined
                ? items.subtitlesEnabled
                : defaultSettings.subtitlesEnabled;
        useNativeSubtitlesToggle.checked =
            items.useNativeSubtitles !== undefined
                ? items.useNativeSubtitles
                : defaultSettings.useNativeSubtitles;
        subtitleTimeOffsetInput.value =
            items.subtitleTimeOffset !== undefined
                ? items.subtitleTimeOffset
                : defaultSettings.subtitleTimeOffset;

        const fontSize =
            items.subtitleFontSize !== undefined
                ? items.subtitleFontSize
                : defaultSettings.subtitleFontSize;
        subtitleFontSizeInput.value = fontSize;
        subtitleFontSizeValue.textContent = `${parseFloat(fontSize).toFixed(1)}vw`;
        updateSliderProgress(subtitleFontSizeInput);

        const gap =
            items.subtitleGap !== undefined
                ? items.subtitleGap
                : defaultSettings.subtitleGap;
        subtitleGapInput.value = gap;
        subtitleGapValue.textContent = `${parseFloat(gap).toFixed(1)}em`;
        updateSliderProgress(subtitleGapInput);

        appearanceAccordion.open =
            items.appearanceAccordionOpen ||
            defaultSettings.appearanceAccordionOpen;

        // Populate dropdowns now that translations are loaded
        updateUILanguage();
        originalLanguageSelect.value =
            items.originalLanguage || defaultSettings.originalLanguage;
        targetLanguageSelect.value =
            items.targetLanguage || defaultSettings.targetLanguage;
        subtitleLayoutOrderSelect.value =
            items.subtitleLayoutOrder || defaultSettings.subtitleLayoutOrder;
        subtitleLayoutOrientationSelect.value =
            items.subtitleLayoutOrientation ||
            defaultSettings.subtitleLayoutOrientation;
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

    function sendMessageToContentScript(action, payload) {
        chrome.tabs.query(
            { active: true, currentWindow: true },
            function (tabs) {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(
                        tabs[0].id,
                        { action, ...payload },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                // Don't show an error if the content script just isn't on the page.
                                if (
                                    !chrome.runtime.lastError.message.includes(
                                        'Receiving end does not exist'
                                    )
                                ) {
                                    console.warn(
                                        `Popup: Error sending '${action}' message:`,
                                        chrome.runtime.lastError.message
                                    );
                                    const errorMsg =
                                        loadedTranslations[
                                            'statusSettingNotApplied'
                                        ]?.message ||
                                        `Setting not applied. Refresh page.`;
                                    showStatus(errorMsg);
                                }
                            } else if (response?.success) {
                                console.log(
                                    `Popup: Action '${action}' sent successfully.`
                                );
                            }
                        }
                    );
                } else {
                    console.warn(
                        `Popup: No active tab found to send '${action}' message.`
                    );
                }
            }
        );
    }

    // --- Event Listeners ---
    enableSubtitlesToggle.addEventListener('change', function () {
        const enabled = this.checked;
        chrome.storage.sync.set({ subtitlesEnabled: enabled });
        const statusKey = enabled ? 'statusDualEnabled' : 'statusDualDisabled';
        const statusText =
            loadedTranslations[statusKey]?.message ||
            (enabled ? 'Dual subtitles enabled.' : 'Dual subtitles disabled.');
        showStatus(statusText);
        sendMessageToContentScript('toggleSubtitles', { enabled });
    });

    useNativeSubtitlesToggle.addEventListener('change', function () {
        const useNative = this.checked;
        chrome.storage.sync.set({ useNativeSubtitles: useNative });
        const statusKey = useNative
            ? 'statusSmartTranslationEnabled'
            : 'statusSmartTranslationDisabled';
        const statusText =
            loadedTranslations[statusKey]?.message ||
            (useNative
                ? 'Smart translation enabled.'
                : 'Smart translation disabled.');
        showStatus(statusText);
        sendMessageToContentScript('changeUseNativeSubtitles', {
            useNativeSubtitles: useNative,
        });
    });

    originalLanguageSelect.addEventListener('change', function () {
        const lang = this.value;
        chrome.storage.sync.set({ originalLanguage: lang });
        const statusPrefix =
            loadedTranslations['statusOriginalLanguage']?.message ||
            'Original language: ';
        const statusText = `${statusPrefix}${this.options[this.selectedIndex].text}`;
        showStatus(statusText);
        sendMessageToContentScript('changeOriginalLanguage', {
            originalLanguage: lang,
        });
    });

    targetLanguageSelect.addEventListener('change', function () {
        const lang = this.value;
        chrome.storage.sync.set({ targetLanguage: lang });
        const statusPrefix =
            loadedTranslations['statusLanguageSetTo']?.message ||
            'Language set to: ';
        showStatus(`${statusPrefix}${this.options[this.selectedIndex].text}`);
        sendMessageToContentScript('changeLanguage', { targetLanguage: lang });
    });

    subtitleTimeOffsetInput.addEventListener('change', function () {
        let offset = parseFloat(this.value);
        if (isNaN(offset)) {
            const invalidMsg =
                loadedTranslations['statusInvalidOffset']?.message ||
                'Invalid offset, reverting.';
            showStatus(invalidMsg);
            chrome.storage.sync.get('subtitleTimeOffset', (items) => {
                this.value =
                    items.subtitleTimeOffset ??
                    defaultSettings.subtitleTimeOffset;
            });
            return;
        }
        offset = parseFloat(offset.toFixed(2));
        this.value = offset;
        chrome.storage.sync.set({ subtitleTimeOffset: offset });
        const statusPrefix =
            loadedTranslations['statusTimeOffset']?.message || 'Time offset: ';
        showStatus(`${statusPrefix}${offset}s.`);
        sendMessageToContentScript('changeTimeOffset', { timeOffset: offset });
    });

    subtitleLayoutOrderSelect.addEventListener('change', function () {
        const layoutOrder = this.value;
        chrome.storage.sync.set({ subtitleLayoutOrder: layoutOrder });
        const statusText =
            loadedTranslations['statusDisplayOrderUpdated']?.message ||
            `Display order updated.`;
        showStatus(statusText);
        sendMessageToContentScript('changeLayoutOrder', { layoutOrder });
    });

    subtitleLayoutOrientationSelect.addEventListener('change', function () {
        const layoutOrientation = this.value;
        chrome.storage.sync.set({
            subtitleLayoutOrientation: layoutOrientation,
        });
        const statusText =
            loadedTranslations['statusLayoutOrientationUpdated']?.message ||
            `Layout orientation updated.`;
        showStatus(statusText);
        sendMessageToContentScript('changeLayoutOrientation', {
            layoutOrientation,
        });
    });

    subtitleFontSizeInput.addEventListener('input', function () {
        subtitleFontSizeValue.textContent = `${parseFloat(this.value).toFixed(1)}vw`;
        updateSliderProgress(this);
    });
    subtitleFontSizeInput.addEventListener('change', function () {
        const fontSize = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleFontSize: fontSize });
        const statusPrefix =
            loadedTranslations['statusFontSize']?.message || 'Font size: ';
        showStatus(`${statusPrefix}${fontSize.toFixed(1)}vw.`);
        sendMessageToContentScript('changeFontSize', { fontSize });
    });

    subtitleGapInput.addEventListener('input', function () {
        subtitleGapValue.textContent = `${parseFloat(this.value).toFixed(1)}em`;
        updateSliderProgress(this);
    });
    subtitleGapInput.addEventListener('change', function () {
        const gap = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleGap: gap });
        const statusPrefix =
            loadedTranslations['statusVerticalGap']?.message ||
            'Vertical gap: ';
        showStatus(`${statusPrefix}${gap.toFixed(1)}em.`);
        sendMessageToContentScript('changeGap', { gap });
    });

    appearanceAccordion.addEventListener('toggle', function () {
        chrome.storage.sync.set({ appearanceAccordionOpen: this.open });
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
    chrome.storage.onChanged.addListener(async (changes, namespace) => {
        if (namespace === 'sync' && changes.uiLanguage) {
            const newLang =
                changes.uiLanguage.newValue || defaultSettings.uiLanguage;
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
