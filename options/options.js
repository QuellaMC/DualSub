document.addEventListener('DOMContentLoaded', function () {
    // Navigation
    const navLinks = document.querySelectorAll('.sidebar nav a');
    const sections = document.querySelectorAll('.content section');

    // General Settings
    const uiLanguageSelect = document.getElementById('uiLanguage');

    // Translation Settings
    const translationProviderSelect = document.getElementById('translationProvider');
    const translationBatchSizeInput = document.getElementById('translationBatchSize');
    const translationBatchSizeValue = document.getElementById('translationBatchSizeValue');
    const translationDelayInput = document.getElementById('translationDelay');
    const translationDelayValue = document.getElementById('translationDelayValue');



    // Provider Settings
    const deeplApiKeyInput = document.getElementById('deeplApiKey');
    const deeplApiPlanSelect = document.getElementById('deeplApiPlan');

    // About
    const extensionVersionSpan = document.getElementById('extensionVersion');

    let loadedTranslations = {};
    const translationsCache = {};


    // Available Translation Providers - can be extended
     const availableProviders = {
        'google': 'Google Translate (Free)',
        'microsoft_edge_auth': 'Microsoft Translate (Free)'
    };

    // Default settings
    const defaultSettings = {
        uiLanguage: 'en',
        selectedProvider: 'google',
        translationBatchSize: 3,
        translationDelay: 150,
        deeplApiKey: '',
        deeplApiPlan: 'free'
    };

    function populateProviderDropdown() {
        for (const providerId in availableProviders) {
            const option = document.createElement('option');
            option.value = providerId;
            option.textContent = availableProviders[providerId];
            translationProviderSelect.appendChild(option);
        }
    }



    async function loadAndApplyLanguage() {
        const items = await chrome.storage.sync.get('uiLanguage');
        const lang = items.uiLanguage || defaultSettings.uiLanguage;
        uiLanguageSelect.value = lang;
        loadedTranslations = await loadTranslations(lang);
        updateUILanguage();
    }

    function loadSettings() {
        // Get all keys from defaultSettings
        const settingKeys = Object.keys(defaultSettings);

        chrome.storage.sync.get(settingKeys, function (items) {
            // General
            uiLanguageSelect.value = items.uiLanguage || defaultSettings.uiLanguage;

            // Translation
            const selectedProvider = items.selectedProvider || defaultSettings.selectedProvider;
             if (availableProviders[selectedProvider]) {
                translationProviderSelect.value = selectedProvider;
            } else {
                translationProviderSelect.value = defaultSettings.selectedProvider;
            }

            const batchSize = items.translationBatchSize !== undefined ? items.translationBatchSize : defaultSettings.translationBatchSize;
            translationBatchSizeInput.value = batchSize;
            translationBatchSizeValue.textContent = batchSize;

            const delay = items.translationDelay !== undefined ? items.translationDelay : defaultSettings.translationDelay;
            translationDelayInput.value = delay;
            translationDelayValue.textContent = `${delay}ms`;

            // Providers
            deeplApiKeyInput.value = items.deeplApiKey || defaultSettings.deeplApiKey;
            deeplApiPlanSelect.value = items.deeplApiPlan || defaultSettings.deeplApiPlan;
        });
    }

    function saveSetting(key, value) {
        chrome.storage.sync.set({ [key]: value }, () => {
            // Optional: Show a saved confirmation
            console.log(`${key} saved as ${value}`);
        });
    }

    // Navigation logic
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);

            // Update active link
            navLinks.forEach(navLink => navLink.classList.remove('active'));
            link.classList.add('active');

            // Show target section
            sections.forEach(section => {
                if (section.id === targetId) {
                    section.classList.remove('hidden');
                } else {
                    section.classList.add('hidden');
                }
            });
        });
    });

    // Event listeners
    document.getElementById('uiLanguage').addEventListener('change', async function() {
        const selectedLang = this.value;
        saveSetting('uiLanguage', selectedLang);
        await loadAndApplyLanguage();
        console.log(`UI language changed to: ${selectedLang}`);
    });

    document.getElementById('translationProvider').addEventListener('change', function() {
        saveSetting('selectedProvider', this.value);
        console.log(`Translation provider changed to: ${this.value}`);
    });

    // Performance settings
    document.getElementById('translationBatchSize').addEventListener('change', function() {
        saveSetting('translationBatchSize', parseInt(this.value));
    });

    document.getElementById('translationDelay').addEventListener('change', function() {
        saveSetting('translationDelay', parseInt(this.value));
    });

    // Translation Functions (similar to popup.js)
    async function loadTranslations(langCode) {
        const normalizedLangCode = langCode.replace('-', '_');
        if (translationsCache[normalizedLangCode]) {
            return translationsCache[normalizedLangCode];
        }
        const translationsPath = chrome.runtime.getURL(`_locales/${normalizedLangCode}/messages.json`);
        try {
            const response = await fetch(translationsPath);
            if (response.ok) {
                const translations = await response.json();
                translationsCache[normalizedLangCode] = translations;
                return translations;
            }
        } catch (error) {
            console.error(`Error fetching primary language ${normalizedLangCode}:`, error);
        }
        // Fallback to English
        const fallbackLangCode = 'en';
        if (translationsCache[fallbackLangCode]) {
            return translationsCache[fallbackLangCode];
        }
        try {
            const fallbackPath = chrome.runtime.getURL(`_locales/${fallbackLangCode}/messages.json`);
            const fallbackResponse = await fetch(fallbackPath);
            const fallbackTranslations = await fallbackResponse.json();
            translationsCache[fallbackLangCode] = fallbackTranslations;
            return fallbackTranslations;
        } catch (error) {
            console.error(`Fatal: Failed to load any translations:`, error);
            return {};
        }
    }

    function updateUILanguage() {
        if (!loadedTranslations) return;
        document.querySelectorAll('[data-i18n]').forEach(elem => {
            const key = elem.getAttribute('data-i18n');
            if (loadedTranslations[key] && loadedTranslations[key].message) {
                if (elem.tagName === 'TITLE') {
                    elem.textContent = loadedTranslations[key].message;
                } else if (elem.placeholder) {
                     elem.placeholder = loadedTranslations[key].message;
                } else {
                    elem.textContent = loadedTranslations[key].message;
                }
            }
        });
    }

    function setVersion() {
        const manifest = chrome.runtime.getManifest();
        extensionVersionSpan.textContent = manifest.version;
    }

    // Initialize
    async function init() {
        populateProviderDropdown();
        loadSettings();
        setVersion();
        await loadAndApplyLanguage();
    }

    init();
}); 