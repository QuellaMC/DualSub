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

    let loadedTranslations = {}; // To store translations from JSON

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
            showStatus(`Dual subtitles ${enabled ? 'enabled' : 'disabled'}.`);
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

    // Add this new event listener for UI language changes
    uiLanguageSelect.addEventListener('change', async function () {
        const newLang = uiLanguageSelect.value;

        // 1. Save the new language preference. Wrap set in a Promise to await it.
        await new Promise(resolve => {
            chrome.storage.sync.set({ uiLanguage: newLang }, () => {
                // console.log(`UI language preference saved: ${newLang}`); // Optional: for debugging
                resolve();
            });
        });

        // 2. Fetch translations for the new language.
        try {
            let translationsPath = `/_locales/${newLang.replace('-', '_')}/messages.json`;
            let response = await fetch(translationsPath);

            if (!response.ok) {
                console.warn(`Translation file for ${newLang} not found (status: ${response.status}). Falling back to English.`);
                translationsPath = '/_locales/en/messages.json';
                response = await fetch(translationsPath);
                if (!response.ok) {
                    throw new Error(`Failed to load English fallback translations (status: ${response.status})`);
                }
            }
            
            loadedTranslations = await response.json(); // Update the global translations
            // console.log(`Translations loaded for ${newLang} (or fallback):`, loadedTranslations); // Optional: for debugging

            // 3. Update the UI with the newly loaded translations.
            updateUILanguage(newLang); 

            const langName = uiLanguageSelect.options[uiLanguageSelect.selectedIndex].text;
            showStatus(`language set to ${langName}.`);

        } catch (error) {
            console.error("Failed to load translations or update UI on language change:", error);
            showStatus("Error changing language.", true);
            // Attempt to revert to English UI as a safe fallback if changing language fails
            try {
                const enResponse = await fetch('/_locales/en/messages.json');
                if (enResponse.ok) {
                    loadedTranslations = await enResponse.json();
                    updateUILanguage('en'); 
                }
            } catch (fallbackError) {
                console.error("Failed to load fallback English translations after error:", fallbackError);
            }
        }
    });

    // Function to update UI text based on language
    function updateUILanguage(lang) {
        if (Object.keys(loadedTranslations).length === 0) {
            console.warn("Translations not loaded yet, cannot update UI language.");
            return;
        }
        // We no longer need loadedTranslations[lang] as the correct language file is loaded directly.
        // Defaulting to English is handled by loading 'en' if the specific lang file fails.
        const currentTranslation = loadedTranslations;

        if (Object.keys(currentTranslation).length === 0) {
            console.error("No translations available (currentTranslation object is empty). UI will not be updated.");
            return;
        }

        document.title = currentTranslation.pageTitle?.message || "Disney+ Dual Subtitles";
        document.querySelector('.container > h1').textContent = currentTranslation.h1Title?.message || "Disney+ Dual Subtitles";
        document.querySelector('label[for="enableSubtitles"]').textContent = currentTranslation.enableSubtitlesLabel?.message || "Enable Dual Subtitles:";
        document.querySelectorAll('.collapsible-legend')[0].childNodes[0].nodeValue = (currentTranslation.translationSettingsLegend?.message || "Translation Settings") + ' ';
        document.querySelector('label[for="translationProvider"]').textContent = currentTranslation.providerLabel?.message || "Provider:";
        document.querySelector('label[for="targetLanguage"]').textContent = currentTranslation.targetLanguageLabel?.message || "Translate to:";
        document.querySelector('label[for="translationBatchSize"]').textContent = currentTranslation.batchSizeLabel?.message || "Batch Size:";
        document.querySelector('label[for="translationDelay"]').textContent = currentTranslation.requestDelayLabel?.message || "Request Delay (ms):" ;
        document.querySelectorAll('.collapsible-legend')[1].childNodes[0].nodeValue = (currentTranslation.subtitleAppearanceTimingLegend?.message || "Subtitle Appearance & Timing") + ' ';
        document.querySelector('label[for="subtitleLayoutOrder"]').textContent = currentTranslation.displayOrderLabel?.message || "Display Order:";
        document.querySelector('label[for="subtitleLayoutOrientation"]').textContent = currentTranslation.layoutLabel?.message || "Layout:";
        document.querySelector('label[for="subtitleFontSize"]').textContent = currentTranslation.fontSizeLabel?.message || "Font Size:";
        document.querySelector('label[for="subtitleGap"]').textContent = currentTranslation.verticalGapLabel?.message || "Vertical Gap:";
        document.querySelector('label[for="subtitleTimeOffset"]').textContent = currentTranslation.timeOffsetLabel?.message || "Time Offset (sec):";
        document.querySelector('label[for="uiLanguage"]').textContent = currentTranslation.uiLanguageLabel?.message || "Language:";
    }

    // Initial load function
    async function init() {
        let langToLoad = defaultSettings.uiLanguage; // Default to 'en'
        try {
            const items = await new Promise(resolve => chrome.storage.sync.get('uiLanguage', resolve));
            if (items.uiLanguage) {
                langToLoad = items.uiLanguage;
            }
            uiLanguageSelect.value = langToLoad;

            let translationsPath = `/_locales/${langToLoad.replace('-', '_')}/messages.json`;
            let response = await fetch(translationsPath);
            if (!response.ok) {
                console.warn(`Initial translation file for ${langToLoad} not found. Falling back to English.`);
                translationsPath = '/_locales/en/messages.json';
                response = await fetch(translationsPath);
                if (!response.ok) throw new Error(`Failed to load initial English fallback translations`);
            }
            loadedTranslations = await response.json();
            // console.log(`Initial translations for '${langToLoad}' (or fallback 'en') loaded.`); // Optional: for debugging

        } catch (error) {
            console.error("Failed to load initial translations:", error);
            // If all fails, loadedTranslations might be empty, updateUILanguage handles this
        }
        
        populateProviderDropdown();
        loadSettings();
        
        updateUILanguage(langToLoad);
    }

    init();
});