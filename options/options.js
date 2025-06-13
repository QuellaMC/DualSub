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
    const testDeepLButton = document.getElementById('testDeepLButton');
    const deeplTestResult = document.getElementById('deeplTestResult');

    // About
    const extensionVersionSpan = document.getElementById('extensionVersion');

    let loadedTranslations = {};
    const translationsCache = {};

    // Available Translation Providers - can be extended
     const availableProviders = {
        'google': 'Google Translate (Free)',
        'microsoft_edge_auth': 'Microsoft Translate (Free)',
        'deepl': 'DeepL Translate'
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

    // Event Listeners for settings
    uiLanguageSelect.addEventListener('change', async () => {
        const newLang = uiLanguageSelect.value;
        saveSetting('uiLanguage', newLang);
        loadedTranslations = await loadTranslations(newLang);
        updateUILanguage();
    });
    translationProviderSelect.addEventListener('change', () => saveSetting('selectedProvider', translationProviderSelect.value));
    deeplApiKeyInput.addEventListener('change', () => saveSetting('deeplApiKey', deeplApiKeyInput.value));
    deeplApiPlanSelect.addEventListener('change', () => saveSetting('deeplApiPlan', deeplApiPlanSelect.value));
    testDeepLButton.addEventListener('click', testDeepLConnection);

    translationBatchSizeInput.addEventListener('input', () => {
        translationBatchSizeValue.textContent = translationBatchSizeInput.value;
    });
    translationBatchSizeInput.addEventListener('change', () => saveSetting('translationBatchSize', parseInt(translationBatchSizeInput.value)));

    translationDelayInput.addEventListener('input', () => {
        translationDelayValue.textContent = `${translationDelayInput.value}ms`;
    });
    translationDelayInput.addEventListener('change', () => saveSetting('translationDelay', parseInt(translationDelayInput.value)));

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

    // Test DeepL Connection
    async function testDeepLConnection() {
        const apiKey = deeplApiKeyInput.value.trim();
        const apiPlan = deeplApiPlanSelect.value;

        if (!apiKey) {
            showTestResult('Please enter your DeepL API key first.', 'error');
            return;
        }

        testDeepLButton.disabled = true;
        testDeepLButton.textContent = 'Testing...';
        showTestResult('Testing DeepL connection...', 'info');

        try {
            const apiUrl = apiPlan === 'pro'
                ? 'https://api.deepl.com/v2/translate'
                : 'https://api-free.deepl.com/v2/translate';

            const params = new URLSearchParams();
            params.append('text', 'Hello');
            params.append('target_lang', 'ZH-HANS');

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Dualsub/1.0.0'
                },
                body: params.toString()
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.translations && data.translations.length > 0) {
                    showTestResult(`✅ DeepL API test successful! Translated "Hello" to "${data.translations[0].text}"`, 'success');
                } else {
                    showTestResult('⚠️ DeepL API responded but with unexpected format', 'warning');
                }
            } else {
                if (response.status === 403) {
                    showTestResult('❌ DeepL API key is invalid or has been rejected.', 'error');
                } else if (response.status === 456) {
                    showTestResult('❌ DeepL API quota exceeded. Please check your usage limits.', 'error');
                } else {
                    const errorData = await response.json().catch(() => ({ message: response.statusText }));
                    showTestResult(`❌ DeepL API error (${response.status}): ${errorData.message || 'Unknown error'}`, 'error');
                }
            }
        } catch (error) {
            console.error('DeepL test error:', error);
            if (error.message.includes('Failed to fetch')) {
                showTestResult('❌ Network error: Could not connect to DeepL API. Check your internet connection.', 'error');
            } else {
                showTestResult(`❌ Test failed: ${error.message}`, 'error');
            }
        } finally {
            testDeepLButton.disabled = false;
            testDeepLButton.textContent = 'Test DeepL Connection';
        }
    }

    function showTestResult(message, type) {
        deeplTestResult.style.display = 'block';
        deeplTestResult.textContent = message;
        
        // Remove previous type classes
        deeplTestResult.classList.remove('success', 'error', 'warning', 'info');
        
        // Add current type class
        deeplTestResult.classList.add(type);
        
        // Set background colors based on type
        switch (type) {
            case 'success':
                deeplTestResult.style.backgroundColor = '#d4edda';
                deeplTestResult.style.color = '#155724';
                deeplTestResult.style.border = '1px solid #c3e6cb';
                break;
            case 'error':
                deeplTestResult.style.backgroundColor = '#f8d7da';
                deeplTestResult.style.color = '#721c24';
                deeplTestResult.style.border = '1px solid #f5c6cb';
                break;
            case 'warning':
                deeplTestResult.style.backgroundColor = '#fff3cd';
                deeplTestResult.style.color = '#856404';
                deeplTestResult.style.border = '1px solid #ffeaa7';
                break;
            case 'info':
                deeplTestResult.style.backgroundColor = '#d1ecf1';
                deeplTestResult.style.color = '#0c5460';
                deeplTestResult.style.border = '1px solid #bee5eb';
                break;
        }
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