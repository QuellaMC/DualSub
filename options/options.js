document.addEventListener('DOMContentLoaded', function () {
    // Navigation
    const navLinks = document.querySelectorAll('.sidebar nav a');
    const sections = document.querySelectorAll('.content section');

    // General Settings
    const uiLanguageSelect = document.getElementById('uiLanguage');
    const hideOfficialSubtitlesCheckbox = document.getElementById(
        'hideOfficialSubtitles'
    );

    // Translation Settings
    const translationProviderSelect = document.getElementById(
        'translationProvider'
    );
    const translationBatchSizeInput = document.getElementById(
        'translationBatchSize'
    );
    const translationBatchSizeValue = document.getElementById(
        'translationBatchSizeValue'
    );
    const translationDelayInput = document.getElementById('translationDelay');
    const translationDelayValue = document.getElementById(
        'translationDelayValue'
    );

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
        google: 'providerGoogleName',
        microsoft_edge_auth: 'providerMicrosoftName',
        deepl: 'providerDeepLName',
    };

    // Default settings
    const defaultSettings = {
        uiLanguage: 'en',
        selectedProvider: 'google',
        translationBatchSize: 3,
        translationDelay: 150,
        deeplApiKey: '',
        deeplApiPlan: 'free',
        hideOfficialSubtitles: false,
    };

    function populateProviderDropdown() {
        // Clear existing options first
        translationProviderSelect.innerHTML = '';

        // Fallback provider names in case translations are not loaded yet
        const fallbackNames = {
            google: 'Google Translate (Free)',
            microsoft_edge_auth: 'Microsoft Translate (Free)',
            deepl: 'DeepL (API Key Required)',
        };

        for (const providerId in availableProviders) {
            const option = document.createElement('option');
            option.value = providerId;
            const translationKey = availableProviders[providerId];

            // Use translated text if available, otherwise use fallback
            if (loadedTranslations && loadedTranslations[translationKey]) {
                option.textContent = loadedTranslations[translationKey].message;
            } else {
                option.textContent =
                    fallbackNames[providerId] || translationKey;
            }

            translationProviderSelect.appendChild(option);
        }
    }

    function updateProviderSettings() {
        const selectedProvider = translationProviderSelect.value;

        // Hide all provider cards first
        const googleCard = document.getElementById('googleProviderCard');
        const microsoftCard = document.getElementById('microsoftProviderCard');
        const deeplCard = document.getElementById('deeplProviderCard');

        googleCard.style.display = 'none';
        microsoftCard.style.display = 'none';
        deeplCard.style.display = 'none';

        // Show the selected provider card
        switch (selectedProvider) {
            case 'google':
                googleCard.style.display = 'block';
                break;
            case 'microsoft_edge_auth':
                microsoftCard.style.display = 'block';
                break;
            case 'deepl':
                deeplCard.style.display = 'block';
                break;
            default:
                // Show Google as default
                googleCard.style.display = 'block';
                break;
        }
    }

    async function loadAndApplyLanguage() {
        const items = await chrome.storage.sync.get([
            'uiLanguage',
            'selectedProvider',
        ]);
        const lang = items.uiLanguage || defaultSettings.uiLanguage;
        const savedProvider =
            items.selectedProvider || defaultSettings.selectedProvider;

        uiLanguageSelect.value = lang;
        loadedTranslations = await loadTranslations(lang);
        updateUILanguage();
        populateProviderDropdown(); // Re-populate provider dropdown with new language

        // Restore the saved provider selection after re-populating
        if (availableProviders[savedProvider]) {
            translationProviderSelect.value = savedProvider;
        } else {
            translationProviderSelect.value = defaultSettings.selectedProvider;
        }
        updateProviderSettings(); // Update provider settings visibility
    }

    async function loadSettings() {
        // Get all keys from defaultSettings
        const settingKeys = Object.keys(defaultSettings);

        return new Promise((resolve) => {
            chrome.storage.sync.get(settingKeys, function (items) {
                // General
                uiLanguageSelect.value =
                    items.uiLanguage || defaultSettings.uiLanguage;
                hideOfficialSubtitlesCheckbox.checked =
                    items.hideOfficialSubtitles !== undefined
                        ? items.hideOfficialSubtitles
                        : defaultSettings.hideOfficialSubtitles;

                // Translation
                const selectedProvider =
                    items.selectedProvider || defaultSettings.selectedProvider;
                if (availableProviders[selectedProvider]) {
                    translationProviderSelect.value = selectedProvider;
                } else {
                    translationProviderSelect.value =
                        defaultSettings.selectedProvider;
                }

                const batchSize =
                    items.translationBatchSize !== undefined
                        ? items.translationBatchSize
                        : defaultSettings.translationBatchSize;
                translationBatchSizeInput.value = batchSize;
                translationBatchSizeValue.textContent = batchSize;

                const delay =
                    items.translationDelay !== undefined
                        ? items.translationDelay
                        : defaultSettings.translationDelay;
                translationDelayInput.value = delay;
                translationDelayValue.textContent = `${delay}ms`;

                // Providers
                deeplApiKeyInput.value =
                    items.deeplApiKey || defaultSettings.deeplApiKey;
                deeplApiPlanSelect.value =
                    items.deeplApiPlan || defaultSettings.deeplApiPlan;

                // Update provider settings visibility - now we're sure all DOM elements are set
                updateProviderSettings();
                resolve();
            });
        });
    }

    function saveSetting(key, value) {
        chrome.storage.sync.set({ [key]: value }, () => {
            // Optional: Show a saved confirmation
            console.log(`${key} saved as ${value}`);
        });
    }

    // Navigation logic
    navLinks.forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);

            // Update active link
            navLinks.forEach((navLink) => navLink.classList.remove('active'));
            link.classList.add('active');

            // Show target section
            sections.forEach((section) => {
                if (section.id === targetId) {
                    section.classList.remove('hidden');
                } else {
                    section.classList.add('hidden');
                }
            });
        });
    });

    // Event listeners
    document
        .getElementById('uiLanguage')
        .addEventListener('change', async function () {
            const selectedLang = this.value;
            saveSetting('uiLanguage', selectedLang);
            await loadAndApplyLanguage();
            console.log(`UI language changed to: ${selectedLang}`);
        });

    // Hide official subtitles setting
    document
        .getElementById('hideOfficialSubtitles')
        .addEventListener('change', function () {
            saveSetting('hideOfficialSubtitles', this.checked);
            console.log(`Hide official subtitles changed to: ${this.checked}`);
        });

    // Translation provider settings
    document
        .getElementById('translationProvider')
        .addEventListener('change', function () {
            saveSetting('selectedProvider', this.value);
            updateProviderSettings();
            console.log(`Translation provider changed to: ${this.value}`);
        });

    // DeepL specific settings
    deeplApiKeyInput.addEventListener('change', () =>
        saveSetting('deeplApiKey', deeplApiKeyInput.value)
    );
    deeplApiPlanSelect.addEventListener('change', () =>
        saveSetting('deeplApiPlan', deeplApiPlanSelect.value)
    );

    // 安全地添加 DeepL 测试按钮的事件监听器
    // 检查 DeepLAPI 是否可用，如果不可用则禁用按钮并显示错误
    if (
        typeof window.DeepLAPI !== 'undefined' &&
        window.DeepLAPI &&
        typeof window.DeepLAPI.testDeepLConnection === 'function'
    ) {
        testDeepLButton.addEventListener('click', testDeepLConnection);
    } else {
        console.error('DeepLAPI is not available. Disabling testDeepLButton.');
        testDeepLButton.disabled = true;
        testDeepLButton.textContent = getLocalizedText(
            'deepLApiUnavailable',
            'DeepL API Unavailable'
        );
        testDeepLButton.title = getLocalizedText(
            'deepLApiUnavailableTooltip',
            'DeepL API script failed to load'
        );

        // 为按钮添加点击处理，显示错误信息
        testDeepLButton.addEventListener('click', () => {
            showTestResult(
                getLocalizedText(
                    'deeplApiNotLoadedError',
                    '❌ DeepL API script is not available. Please refresh the page.'
                ),
                'error'
            );
        });
    }

    // Performance settings
    document
        .getElementById('translationBatchSize')
        .addEventListener('change', function () {
            saveSetting('translationBatchSize', parseInt(this.value));
            translationBatchSizeValue.textContent = this.value;
        });

    document
        .getElementById('translationDelay')
        .addEventListener('change', function () {
            saveSetting('translationDelay', parseInt(this.value));
            translationDelayValue.textContent = `${this.value}ms`;
        });

    // Translation Functions (similar to popup.js)
    async function loadTranslations(langCode) {
        const normalizedLangCode = langCode.replace('-', '_');
        if (translationsCache[normalizedLangCode]) {
            return translationsCache[normalizedLangCode];
        }
        const translationsPath = chrome.runtime.getURL(
            `_locales/${normalizedLangCode}/messages.json`
        );
        try {
            const response = await fetch(translationsPath);
            if (response.ok) {
                const translations = await response.json();
                translationsCache[normalizedLangCode] = translations;
                return translations;
            }
        } catch (error) {
            console.error(
                `Error fetching primary language ${normalizedLangCode}:`,
                error
            );
        }
        // Fallback to English
        const fallbackLangCode = 'en';
        if (translationsCache[fallbackLangCode]) {
            return translationsCache[fallbackLangCode];
        }
        try {
            const fallbackPath = chrome.runtime.getURL(
                `_locales/${fallbackLangCode}/messages.json`
            );
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
        document.querySelectorAll('[data-i18n]').forEach((elem) => {
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

    // Helper function to get localized text with fallback
    function getLocalizedText(key, fallback, ...substitutions) {
        let message = loadedTranslations[key]?.message || fallback;
        // Replace %s and %d placeholders with substitutions
        if (substitutions.length > 0) {
            let substitutionIndex = 0;
            message = message.replace(/%[sd]/g, (match) => {
                if (substitutionIndex < substitutions.length) {
                    return substitutions[substitutionIndex++];
                }
                return match; // Keep original placeholder if no more substitutions
            });
        }
        return message;
    }

    function setVersion() {
        const manifest = chrome.runtime.getManifest();
        extensionVersionSpan.textContent = manifest.version;
    }

    // Test DeepL Connection
    async function testDeepLConnection() {
        // 运行时再次检查 DeepLAPI 是否可用
        if (
            typeof window.DeepLAPI === 'undefined' ||
            !window.DeepLAPI ||
            typeof window.DeepLAPI.testDeepLConnection !== 'function'
        ) {
            showTestResult(
                getLocalizedText(
                    'deeplApiNotLoadedError',
                    '❌ DeepL API script is not available. Please refresh the page.'
                ),
                'error'
            );
            return;
        }

        const apiKey = deeplApiKeyInput.value.trim();
        const apiPlan = deeplApiPlanSelect.value;

        if (!apiKey) {
            showTestResult(
                getLocalizedText(
                    'deeplApiKeyError',
                    'Please enter your DeepL API key first.'
                ),
                'error'
            );
            return;
        }

        testDeepLButton.disabled = true;
        testDeepLButton.textContent = getLocalizedText(
            'testingButton',
            'Testing...'
        );
        showTestResult(
            getLocalizedText(
                'testingConnection',
                'Testing DeepL connection...'
            ),
            'info'
        );

        try {
            // Use the shared DeepL API utility
            const result = await window.DeepLAPI.testDeepLConnection(
                apiKey,
                apiPlan
            );

            if (result.success) {
                showTestResult(
                    getLocalizedText(
                        'deeplTestSuccessSimple',
                        '✅ DeepL API test successful!'
                    ),
                    'success'
                );
            } else {
                let fallbackMessage;

                switch (result.error) {
                    case 'API_KEY_MISSING':
                        fallbackMessage = getLocalizedText(
                            'deeplApiKeyError',
                            'Please enter your DeepL API key first.'
                        );
                        break;
                    case 'UNEXPECTED_FORMAT':
                        fallbackMessage = getLocalizedText(
                            'deeplTestUnexpectedFormat',
                            '⚠️ DeepL API responded but with unexpected format'
                        );
                        break;
                    case 'HTTP_403':
                        fallbackMessage = getLocalizedText(
                            'deeplTestInvalidKey',
                            '❌ DeepL API key is invalid or has been rejected.'
                        );
                        break;
                    case 'HTTP_456':
                        fallbackMessage = getLocalizedText(
                            'deeplTestQuotaExceeded',
                            '❌ DeepL API quota exceeded. Please check your usage limits.'
                        );
                        break;
                    case 'NETWORK_ERROR':
                        fallbackMessage = getLocalizedText(
                            'deeplTestNetworkError',
                            '❌ Network error: Could not connect to DeepL API. Check your internet connection.'
                        );
                        break;
                    default:
                        if (result.error.startsWith('HTTP_')) {
                            fallbackMessage = getLocalizedText(
                                'deeplTestApiError',
                                '❌ DeepL API error (%d): %s',
                                result.status,
                                result.message || 'Unknown error'
                            );
                        } else {
                            fallbackMessage = getLocalizedText(
                                'deeplTestGenericError',
                                '❌ Test failed: %s',
                                result.message
                            );
                        }
                        break;
                }

                const errorType =
                    result.error === 'UNEXPECTED_FORMAT' ? 'warning' : 'error';
                showTestResult(fallbackMessage, errorType);
            }
        } catch (error) {
            console.error('DeepL test error:', error);
            showTestResult(
                getLocalizedText(
                    'deeplTestGenericError',
                    '❌ Test failed: %s',
                    error.message
                ),
                'error'
            );
        } finally {
            testDeepLButton.disabled = false;
            testDeepLButton.textContent = getLocalizedText(
                'testDeepLButton',
                'Test DeepL Connection'
            );
        }
    }

    function showTestResult(message, type) {
        deeplTestResult.style.display = 'block';
        deeplTestResult.textContent = message;

        // Remove previous type classes
        deeplTestResult.classList.remove('success', 'error', 'warning', 'info');

        // Add current type class
        deeplTestResult.classList.add(type);
    }

    // Initialize
    async function init() {
        setVersion();
        await loadAndApplyLanguage(); // Load language first
        await loadSettings(); // Then load settings which will restore the selected provider
    }

    init();
});
