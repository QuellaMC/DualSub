// disneyplus-dualsub-chrome-extension/popup/popup.js
document.addEventListener('DOMContentLoaded', function () {
    // Element references
    const enableSubtitlesToggle = document.getElementById('enableSubtitles');
    const targetLanguageSelect = document.getElementById('targetLanguage');
    const subtitleTimeOffsetInput = document.getElementById('subtitleTimeOffset');
    const subtitleLayoutOrderSelect = document.getElementById('subtitleLayoutOrder');
    const subtitleLayoutOrientationSelect = document.getElementById('subtitleLayoutOrientation');
    const subtitleFontSizeInput = document.getElementById('subtitleFontSize');
    const subtitleFontSizeValue = document.getElementById('subtitleFontSizeValue');
    const subtitleGapInput = document.getElementById('subtitleGap');
    const subtitleGapValue = document.getElementById('subtitleGapValue');
    const translationBatchSizeInput = document.getElementById('translationBatchSize');
    const translationBatchSizeValue = document.getElementById('translationBatchSizeValue');
    const translationDelayInput = document.getElementById('translationDelay');
    const translationDelayValue = document.getElementById('translationDelayValue');
    const translationProviderSelect = document.getElementById('translationProvider');
    const statusMessage = document.getElementById('statusMessage');
    const uiLanguageSelect = document.getElementById('uiLanguage');

    let loadedTranslations = {}; // To store the currently active translations
    const translationsCache = {}; // Cache for all loaded language files

    // Collapsible sections
    const collapsibleLegends = document.querySelectorAll('.settings-group > .collapsible-legend');

    // State for collapsible sections (e.g., which ones are open)
    const initialCollapsibleState = {
        translationSettings: false, // Default to collapsed
        subtitleAppearanceTiming: false // Default to collapsed
    };
    let collapsibleStates = { ...initialCollapsibleState };

    // Available Translation Providers
    const availableProviders = {
        'google': 'Google Translate (Free)',
        'microsoft_edge_auth': 'Microsoft Translate (Free)'
    };

    // Default settings
    const defaultSettings = {
        subtitlesEnabled: true,
        targetLanguage: 'zh-CN',
        selectedProvider: 'google',
        subtitleTimeOffset: 0,
        subtitleLayoutOrder: 'original_top',
        subtitleLayoutOrientation: 'column',
        subtitleFontSize: 1.1,
        subtitleGap: 0.3,
        translationBatchSize: 3,
        translationDelay: 150,
        collapsibleStates: initialCollapsibleState,
        uiLanguage: 'en'
    };

    function populateProviderDropdown() {
        for (const providerId in availableProviders) {
            const option = document.createElement('option');
            option.value = providerId;
            option.textContent = availableProviders[providerId];
            translationProviderSelect.appendChild(option);
        }
    }

    function applyCollapsibleStates() {
        collapsibleLegends.forEach((legend, index) => {
            const fieldset = legend.parentElement;
            const stateKey = index === 0 ? 'translationSettings' : 'subtitleAppearanceTiming';
            if (collapsibleStates[stateKey]) {
                fieldset.classList.remove('collapsed');
            } else {
                fieldset.classList.add('collapsed');
            }
        });
    }

    function loadSettings() {
        chrome.storage.sync.get(Object.keys(defaultSettings), function (items) {
            enableSubtitlesToggle.checked = items.subtitlesEnabled !== undefined ? items.subtitlesEnabled : defaultSettings.subtitlesEnabled;
            targetLanguageSelect.value = items.targetLanguage || defaultSettings.targetLanguage;

            const selectedProvider = items.selectedProvider || defaultSettings.selectedProvider;
            if (availableProviders[selectedProvider]) {
                translationProviderSelect.value = selectedProvider;
            } else {
                translationProviderSelect.value = defaultSettings.selectedProvider;
            }

            subtitleTimeOffsetInput.value = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : defaultSettings.subtitleTimeOffset;
            subtitleLayoutOrderSelect.value = items.subtitleLayoutOrder || defaultSettings.subtitleLayoutOrder;
            subtitleLayoutOrientationSelect.value = items.subtitleLayoutOrientation || defaultSettings.subtitleLayoutOrientation;

            const fontSize = items.subtitleFontSize !== undefined ? items.subtitleFontSize : defaultSettings.subtitleFontSize;
            subtitleFontSizeInput.value = fontSize;
            subtitleFontSizeValue.textContent = `${parseFloat(fontSize).toFixed(1)}vw`;

            const gap = items.subtitleGap !== undefined ? items.subtitleGap : defaultSettings.subtitleGap;
            subtitleGapInput.value = gap;
            subtitleGapValue.textContent = `${parseFloat(gap).toFixed(1)}em`;

            const batchSize = items.translationBatchSize !== undefined ? items.translationBatchSize : defaultSettings.translationBatchSize;
            translationBatchSizeInput.value = batchSize;
            translationBatchSizeValue.textContent = batchSize;

            const delay = items.translationDelay !== undefined ? items.translationDelay : defaultSettings.translationDelay;
            translationDelayInput.value = delay;
            translationDelayValue.textContent = `${delay}ms`;

            collapsibleStates = items.collapsibleStates || { ...initialCollapsibleState };
            applyCollapsibleStates();

            // Load and apply UI language
            const currentUILanguage = items.uiLanguage || defaultSettings.uiLanguage;
            uiLanguageSelect.value = currentUILanguage;
            // updateUILanguage is now called after translations are loaded in init()
        });
    }

    function showStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.className = isError ? 'error' : 'success';
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = '';
        }, 3000);
    }

    function sendMessageToContentScript(action, value, settingKey) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                const messagePayload = { action: action };
                if (settingKey) {
                  messagePayload[settingKey] = value;
                } else {
                  messagePayload.enabled = value; // Specific for toggleSubtitles
                }

                chrome.tabs.sendMessage(tabs[0].id, messagePayload, function(response) {
                    if (chrome.runtime.lastError) {
                        console.warn(`Popup: Error sending ${action} message for ${settingKey || 'toggle'}:`, chrome.runtime.lastError.message);
                        if (!chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                             showStatus(`Setting not applied. Refresh Disney+ tab.`, true);
                        }
                    } else if (response && response.success) {
                        console.log(`Popup: ${action} for ${settingKey || 'toggle'} sent. New value:`, value);
                    } else {
                         console.warn(`Popup: Content script did not respond successfully to ${action} for ${settingKey || 'toggle'}. Response:`, response);
                    }
                });
            } else {
                console.warn(`Popup: No active tab found to send ${action} message.`);
            }
        });
    }

    // Event Listeners for UI elements
    enableSubtitlesToggle.addEventListener('change', function () {
        const enabled = enableSubtitlesToggle.checked;
        chrome.storage.sync.set({ subtitlesEnabled: enabled }, () => {
            let statusMessageKey = enabled ? "statusDualEnabled" : "statusDualDisabled";
            let statusMessageText = loadedTranslations[statusMessageKey]?.message;
            
            if (!statusMessageText) {
                // Fallback if the key is missing
                console.warn(`${statusMessageKey} key missing from loaded translations. Using hardcoded fallback.`);
                statusMessageText = enabled ? "Dual subtitles enabled." : "Dual subtitles disabled.";
            }
            showStatus(statusMessageText);
            sendMessageToContentScript("toggleSubtitles", enabled, "enabled");
        });
    });

    targetLanguageSelect.addEventListener('change', function () {
        const lang = targetLanguageSelect.value;
        chrome.storage.sync.set({ targetLanguage: lang }, () => {
            showStatus(`Target language: ${targetLanguageSelect.options[targetLanguageSelect.selectedIndex].text}.`);
            sendMessageToContentScript("changeLanguage", lang, "targetLanguage");
        });
    });

    subtitleTimeOffsetInput.addEventListener('change', function() {
        let offset = parseFloat(subtitleTimeOffsetInput.value);
        if (isNaN(offset)) {
            showStatus('Invalid time offset. Reverting.', true);
            chrome.storage.sync.get('subtitleTimeOffset', (items) => {
                subtitleTimeOffsetInput.value = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : defaultSettings.subtitleTimeOffset;
            });
            return;
        }
        offset = parseFloat(offset.toFixed(2)); // Ensure two decimal places for consistency
        subtitleTimeOffsetInput.value = offset;

        chrome.storage.sync.set({ subtitleTimeOffset: offset }, () => {
            showStatus(`Time offset: ${offset}s.`);
            sendMessageToContentScript("changeTimeOffset", offset, "timeOffset");
        });
    });

    subtitleLayoutOrderSelect.addEventListener('change', function() {
        const layoutOrder = subtitleLayoutOrderSelect.value;
        chrome.storage.sync.set({ subtitleLayoutOrder: layoutOrder }, () => {
            showStatus(`Display order updated.`);
            sendMessageToContentScript("changeLayoutOrder", layoutOrder, "layoutOrder");
        });
    });

    subtitleLayoutOrientationSelect.addEventListener('change', function() {
        const layoutOrientation = subtitleLayoutOrientationSelect.value;
        chrome.storage.sync.set({ subtitleLayoutOrientation: layoutOrientation }, () => {
            showStatus(`Layout orientation updated.`);
            sendMessageToContentScript("changeLayoutOrientation", layoutOrientation, "layoutOrientation");
        });
    });

    subtitleFontSizeInput.addEventListener('input', function() {
        subtitleFontSizeValue.textContent = `${parseFloat(this.value).toFixed(1)}vw`;
    });
    subtitleGapInput.addEventListener('input', function() {
        subtitleGapValue.textContent = `${parseFloat(this.value).toFixed(1)}em`;
    });
    translationBatchSizeInput.addEventListener('input', function() {
        translationBatchSizeValue.textContent = this.value;
    });
    translationDelayInput.addEventListener('input', function() {
        translationDelayValue.textContent = `${this.value}ms`;
    });

    subtitleFontSizeInput.addEventListener('change', function() {
        const fontSize = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleFontSize: fontSize }, () => {
            showStatus(`Subtitle size: ${fontSize.toFixed(1)}vw.`);
            sendMessageToContentScript("changeFontSize", fontSize, "fontSize");
        });
    });

    subtitleGapInput.addEventListener('change', function() {
        const gap = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleGap: gap }, () => {
            showStatus(`Subtitle gap: ${gap.toFixed(1)}em.`);
            sendMessageToContentScript("changeGap", gap, "gap");
        });
    });

    translationBatchSizeInput.addEventListener('change', function() {
        const batchSize = parseInt(this.value);
        chrome.storage.sync.set({ translationBatchSize: batchSize }, () => {
            showStatus(`Translation batch size: ${batchSize}.`);
            sendMessageToContentScript("changeBatchSize", batchSize, "batchSize");
        });
    });

    translationDelayInput.addEventListener('change', function() {
        const delay = parseInt(this.value);
        chrome.storage.sync.set({ translationDelay: delay }, () => {
            showStatus(`Translation delay: ${delay}ms.`);
            sendMessageToContentScript("changeDelay", delay, "delay");
        });
    });

    translationProviderSelect.addEventListener('change', function() {
        const providerId = this.value;
        chrome.storage.sync.set({ selectedProvider: providerId }, () => {
            const providerName = translationProviderSelect.options[translationProviderSelect.selectedIndex].text;
            showStatus(`Provider: ${providerName}.`);
            // Send message to background script to update its internal state
            chrome.runtime.sendMessage({ action: "changeProvider", providerId: providerId }, function(response) {
                if (chrome.runtime.lastError) {
                    console.warn(`Popup: Error sending changeProvider message to background:`, chrome.runtime.lastError.message);
                    showStatus(`Error switching provider.`, true);
                } else if (response && response.success) {
                    console.log(`Popup: changeProvider message sent to background. Response: ${response.message}`);
                } else {
                    console.warn(`Popup: Background script did not respond successfully to changeProvider. Response:`, response);
                    showStatus(`Provider change not confirmed by background.`, true);
                }
            });
        });
    });

    // Setup for collapsible sections
    collapsibleLegends.forEach((legend, index) => {
        legend.addEventListener('click', function () {
            const fieldset = this.parentElement;
            fieldset.classList.toggle('collapsed');
            const stateKey = index === 0 ? 'translationSettings' : 'subtitleAppearanceTiming';
            collapsibleStates[stateKey] = !fieldset.classList.contains('collapsed');
            chrome.storage.sync.set({ collapsibleStates: collapsibleStates });
        });
    });

    // Helper function to load translation files
    async function loadTranslations(langCode) {
        const normalizedLangCode = langCode.replace('-', '_');

        if (translationsCache[normalizedLangCode]) {
            console.log(`Using cached translations for: ${normalizedLangCode}`);
            return translationsCache[normalizedLangCode];
        }

        const translationsPath = chrome.runtime.getURL(`_locales/${normalizedLangCode}/messages.json`);
        
        try {
            const response = await fetch(translationsPath);
            if (response.ok) {
                const translations = await response.json();
                translationsCache[normalizedLangCode] = translations;
                console.log(`Translations fetched and cached for: ${normalizedLangCode}`);
                return translations;
            }
        } catch (error) {
            console.error(`Error fetching primary language ${normalizedLangCode}:`, error);
        }

        console.warn(`Translation file for ${normalizedLangCode} not found. Falling back to English.`);
        const fallbackLangCode = 'en';

        if (translationsCache[fallbackLangCode]) {
            console.log(`Using cached translations for fallback: ${fallbackLangCode}`);
            return translationsCache[fallbackLangCode];
        }
        
        try {
            const fallbackPath = chrome.runtime.getURL(`_locales/${fallbackLangCode}/messages.json`);
            const fallbackResponse = await fetch(fallbackPath);
            if (!fallbackResponse.ok) {
                throw new Error(`Failed to load English fallback translations (status: ${fallbackResponse.status})`);
            }
            const fallbackTranslations = await fallbackResponse.json();
            translationsCache[fallbackLangCode] = fallbackTranslations;
            console.log(`Translations fetched and cached for fallback: ${fallbackLangCode}`);
            return fallbackTranslations;
        } catch (error) {
            console.error(`Fatal: Failed to load any translations, including English fallback:`, error);
            return {};
        }
    }

    // Add this new event listener for UI language changes
    uiLanguageSelect.addEventListener('change', async function () {
        const newLang = uiLanguageSelect.value;

        await new Promise(resolve => {
            chrome.storage.sync.set({ uiLanguage: newLang }, resolve);
        });

        loadedTranslations = await loadTranslations(newLang);

        updateUILanguage(newLang); 

        const langName = uiLanguageSelect.options[uiLanguageSelect.selectedIndex].text;
        // Get the translated status message template
        let statusMessagePrefix = loadedTranslations.statusLanguageSetTo?.message;
        if (!statusMessagePrefix) {
            // Fallback if the key is somehow missing
            console.warn("statusLanguageSetTo key missing from loaded translations. Using hardcoded fallback.");
            statusMessagePrefix = (newLang === 'zh-CN' || newLang === 'zh_CN') ? "语言切换成： " : "Language set to: ";
        }
        showStatus(statusMessagePrefix + langName);
    });

    // Function to update UI text based on language
    function updateUILanguage(lang) {
        if (Object.keys(loadedTranslations).length === 0) {
            console.warn("Translations not loaded yet, cannot update UI language.");
            return;
        }
        const currentTranslation = loadedTranslations;
        if (Object.keys(currentTranslation).length === 0) {
            console.error("No translations available (currentTranslation object is empty). UI will not be updated.");
            return;
        }

        const i18nMap = {
            h1Title: { selector: '.container > h1', fallback: 'Disney+ Dual Subtitles' },
            enableSubtitlesLabel: { selector: 'label[for="enableSubtitles"]', fallback: 'Enable Dual Subtitles:' },
            translationSettingsLegend: { selector: '#translation-settings .legend-text', fallback: 'Translation Settings' },
            providerLabel: { selector: 'label[for="translationProvider"]', fallback: 'Provider:' },
            targetLanguageLabel: { selector: 'label[for="targetLanguage"]', fallback: 'Translate to:' },
            batchSizeLabel: { selector: 'label[for="translationBatchSize"]', fallback: 'Batch Size:' },
            requestDelayLabel: { selector: 'label[for="translationDelay"]', fallback: 'Request Delay (ms):' },
            subtitleAppearanceTimingLegend: { selector: '#appearance-settings .legend-text', fallback: 'Subtitle Appearance & Timing' },
            displayOrderLabel: { selector: 'label[for="subtitleLayoutOrder"]', fallback: 'Display Order:' },
            layoutLabel: { selector: 'label[for="subtitleLayoutOrientation"]', fallback: 'Layout:' },
            fontSizeLabel: { selector: 'label[for="subtitleFontSize"]', fallback: 'Font Size:' },
            verticalGapLabel: { selector: 'label[for="subtitleGap"]', fallback: 'Vertical Gap:' },
            timeOffsetLabel: { selector: 'label[for="subtitleTimeOffset"]', fallback: 'Time Offset (sec):' },
            uiLanguageLabel: { selector: 'label[for="uiLanguage"]', fallback: 'Language:' },
        };

        for (const key in i18nMap) {
            const { selector, fallback } = i18nMap[key];
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = currentTranslation[key]?.message || fallback;
            } else {
                console.warn(`i18n mapping: Could not find element with selector '${selector}' for key '${key}'.`);
            }
        }

        // Handle special cases that don't fit the simple selector/textContent pattern
        document.title = currentTranslation.pageTitle?.message || 'Disney+ Dual Subtitles';
        
    }

    // Initial load function
    async function init() {
        let langToLoad = defaultSettings.uiLanguage;
        try {
            const items = await new Promise(resolve => chrome.storage.sync.get('uiLanguage', resolve));
            if (items.uiLanguage) {
                langToLoad = items.uiLanguage;
            }
            uiLanguageSelect.value = langToLoad;

            loadedTranslations = await loadTranslations(langToLoad);

        } catch (error) {
            console.error("Error during initialization sequence:", error);
        }
        
        populateProviderDropdown();
        loadSettings();
        
        // loadedTranslations will be English, but newLang (in updateUILanguage) will still be the originally requested lang.
        updateUILanguage(langToLoad); 
    }

    init();
});