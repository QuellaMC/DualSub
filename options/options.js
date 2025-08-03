import { configService } from '../services/configService.js';
import Logger from '../utils/logger.js';
import { fetchAvailableModels } from '../translation_providers/openaiCompatibleTranslate.js';

document.addEventListener('DOMContentLoaded', function () {
    // Initialize options logger
    const optionsLogger = Logger.create('Options', configService);

    // Initialize logging level from configuration
    (async () => {
        try {
            const loggingLevel = await configService.get('loggingLevel');
            optionsLogger.updateLevel(loggingLevel);
            optionsLogger.info('Options logger initialized', {
                level: loggingLevel,
            });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            optionsLogger.updateLevel(Logger.LEVELS.INFO);
            optionsLogger.warn(
                'Failed to load logging level from config, using INFO level',
                error
            );
        }
    })();

    // Listen for logging level changes
    configService.onChanged((changes) => {
        if ('loggingLevel' in changes) {
            optionsLogger.updateLevel(changes.loggingLevel);
            optionsLogger.info(
                'Logging level updated from configuration change',
                {
                    newLevel: changes.loggingLevel,
                }
            );
        }
    });

    // Navigation
    const navLinks = document.querySelectorAll('.sidebar nav a');
    const sections = document.querySelectorAll('.content section');

    // General Settings
    const uiLanguageSelect = document.getElementById('uiLanguage');
    const hideOfficialSubtitlesCheckbox = document.getElementById(
        'hideOfficialSubtitles'
    );
    const loggingLevelSelect = document.getElementById('loggingLevel');

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

    // Batch Translation Settings
    const batchingEnabledCheckbox = document.getElementById('batchingEnabled');
    const useProviderDefaultsCheckbox = document.getElementById(
        'useProviderDefaults'
    );
    const globalBatchSizeInput = document.getElementById('globalBatchSize');
    const maxConcurrentBatchesInput = document.getElementById(
        'maxConcurrentBatches'
    );
    const smartBatchingCheckbox = document.getElementById('smartBatching');

    // Provider-specific batch sizes
    const openaieBatchSizeInput = document.getElementById('openaieBatchSize');
    const googleBatchSizeInput = document.getElementById('googleBatchSize');
    const deeplBatchSizeInput = document.getElementById('deeplBatchSize');
    const microsoftBatchSizeInput =
        document.getElementById('microsoftBatchSize');

    // Provider-specific delay settings
    const openaieDelayInput = document.getElementById('openaieDelay');
    const googleDelayInput = document.getElementById('googleDelay');
    const deeplDelayInput = document.getElementById('deeplDelay');
    const deeplFreeDelayInput = document.getElementById('deeplFreeDelay');
    const microsoftDelayInput = document.getElementById('microsoftDelay');

    // Batch settings containers
    const globalBatchSizeSetting = document.getElementById(
        'globalBatchSizeSetting'
    );
    const providerBatchSettings = document.getElementById(
        'providerBatchSettings'
    );

    // Provider Settings
    const deeplApiKeyInput = document.getElementById('deeplApiKey');
    const deeplApiPlanSelect = document.getElementById('deeplApiPlan');
    const testDeepLButton = document.getElementById('testDeepLButton');
    const deeplTestResult = document.getElementById('deeplTestResult');

    const openaiCompatibleApiKeyInput = document.getElementById('openaiCompatibleApiKey');
    const openaiCompatibleBaseUrlInput = document.getElementById('openaiCompatibleBaseUrl');
    const openaiCompatibleModelSelect = document.getElementById('openaiCompatibleModel');
    const testOpenAIButton = document.getElementById('testOpenAIButton');
    const fetchOpenAIModelsButton = document.getElementById('fetchOpenAIModelsButton');
    const openaiTestResult = document.getElementById('openaiTestResult');

    // About
    const extensionVersionSpan = document.getElementById('extensionVersion');

    let loadedTranslations = {};
    const translationsCache = {};

    // Available Translation Providers - uses i18n keys for consistency
    const availableProviders = {
        google: 'providerGoogleName',
        microsoft_edge_auth: 'providerMicrosoftName',
        deepl: 'providerDeepLName',
        deepl_free: 'providerDeepLFreeName',
        openai_compatible: 'providerOpenAICompatibleName',
    };

    // Helper functions first (no dependencies)
    const setVersion = function () {
        const manifest = chrome.runtime.getManifest();
        extensionVersionSpan.textContent = manifest.version;
    };

    const saveSetting = async function (key, value) {
        try {
            await configService.set(key, value);
            optionsLogger.info(`${key} saved`, {
                key,
                value,
                component: 'saveSetting',
            });
        } catch (error) {
            optionsLogger.error(`Error saving ${key}`, error, {
                key,
                value,
                component: 'saveSetting',
            });
        }
    };

    // Translation Functions (similar to popup.js)
    const loadTranslations = async function (langCode) {
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
            optionsLogger.error(
                `Error fetching primary language ${normalizedLangCode}`,
                error,
                { normalizedLangCode, component: 'loadTranslations' }
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
            optionsLogger.error(
                'Fatal: Failed to load any translations',
                error,
                { component: 'loadTranslations' }
            );
            return {};
        }
    };

    const updateUILanguage = function () {
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
    };

    // Helper function to get localized text with fallback
    const getLocalizedText = function (key, fallback, ...substitutions) {
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
    };

    const showTestResult = function (element, message, type) {
        element.style.display = 'block';
        element.textContent = message;
        element.classList.remove('success', 'error', 'warning', 'info');
        element.classList.add(type);
    };

    // Test DeepL Connection
    const testDeepLConnection = async function () {
        // 运行时再次检查 DeepLAPI 是否可用
        if (
            typeof window.DeepLAPI === 'undefined' ||
            !window.DeepLAPI ||
            typeof window.DeepLAPI.testDeepLConnection !== 'function'
        ) {
            showTestResult(
                deeplTestResult,
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
                deeplTestResult,
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
            deeplTestResult,
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
                    deeplTestResult,
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
                showTestResult(deeplTestResult, fallbackMessage, errorType);
            }
        } catch (error) {
            optionsLogger.error('DeepL test error', error, {
                apiKey: apiKey ? '[REDACTED]' : 'empty',
                apiPlan,
                component: 'testDeepLConnection',
            });
            showTestResult(
                deeplTestResult,
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
    };

    const testOpenAIConnection = async function () {
        const apiKey = openaiCompatibleApiKeyInput.value.trim();
        const baseUrl = openaiCompatibleBaseUrlInput.value.trim();

        if (!apiKey) {
            showTestResult(openaiTestResult, 'Please enter an API key.', 'error');
            return;
        }

        testOpenAIButton.disabled = true;
        showTestResult(openaiTestResult, 'Testing connection...', 'info');

        try {
            await fetchAvailableModels(apiKey, baseUrl);
            showTestResult(openaiTestResult, 'Connection successful!', 'success');
        } catch (error) {
            showTestResult(openaiTestResult, `Connection failed: ${error.message}`, 'error');
        } finally {
            testOpenAIButton.disabled = false;
        }
    };

    const fetchOpenAIModels = async function () {
        const apiKey = openaiCompatibleApiKeyInput.value.trim();
        const baseUrl = openaiCompatibleBaseUrlInput.value.trim();

        if (!apiKey) {
            showTestResult(openaiTestResult, 'Please enter an API key to fetch models.', 'error');
            return;
        }

        fetchOpenAIModelsButton.disabled = true;
        showTestResult(openaiTestResult, 'Fetching models...', 'info');

        try {
            const models = await fetchAvailableModels(apiKey, baseUrl);
            openaiCompatibleModelSelect.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                openaiCompatibleModelSelect.appendChild(option);
            });
            showTestResult(openaiTestResult, 'Models fetched successfully.', 'success');
        } catch (error) {
            showTestResult(openaiTestResult, `Failed to fetch models: ${error.message}`, 'error');
        } finally {
            fetchOpenAIModelsButton.disabled = false;
        }
    };

    const populateProviderDropdown = function () {
        // Clear existing options first
        translationProviderSelect.innerHTML = '';

        // Use translated provider names for consistent UI language
        for (const providerId in availableProviders) {
            const option = document.createElement('option');
            option.value = providerId;
            const translationKey = availableProviders[providerId];

            // Use getLocalizedText to get translated provider name
            option.textContent = getLocalizedText(
                translationKey,
                `Provider: ${providerId}`
            );

            translationProviderSelect.appendChild(option);
        }
    };

    const updateProviderSettings = function () {
        const selectedProvider = translationProviderSelect.value;

        // Hide all provider cards first
        const googleCard = document.getElementById('googleProviderCard');
        const microsoftCard = document.getElementById('microsoftProviderCard');
        const deeplCard = document.getElementById('deeplProviderCard');
        const deeplFreeCard = document.getElementById('deeplFreeProviderCard');
        const openaiCompatibleCard = document.getElementById('openaiCompatibleProviderCard');


        googleCard.style.display = 'none';
        microsoftCard.style.display = 'none';
        deeplCard.style.display = 'none';
        deeplFreeCard.style.display = 'none';
        openaiCompatibleCard.style.display = 'none';


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
            case 'deepl_free':
                deeplFreeCard.style.display = 'block';
                break;
            case 'openai_compatible':
                openaiCompatibleCard.style.display = 'block';
                break;
            default:
                // Show DeepL Free as default
                deeplFreeCard.style.display = 'block';
                break;
        }
    };

    const updateBatchSettingsVisibility = function () {
        const batchingEnabled = batchingEnabledCheckbox.checked;
        const useProviderDefaults = useProviderDefaultsCheckbox.checked;

        // Show/hide batch settings based on whether batching is enabled
        const batchSettings = document.querySelectorAll(
            '#globalBatchSizeSetting, #providerBatchSettings, .setting:has(#maxConcurrentBatches), .setting:has(#smartBatching), .setting:has(#useProviderDefaults)'
        );
        batchSettings.forEach((setting) => {
            if (setting) {
                // Use 'grid' for settings rows, 'block' for the card, and 'none' to hide.
                const displayValue = batchingEnabled
                    ? setting.id === 'providerBatchSettings'
                        ? 'block'
                        : 'grid'
                    : 'none';
                setting.style.display = displayValue;
            }
        });

        // Show/hide global vs provider-specific batch size settings
        if (batchingEnabled) {
            if (globalBatchSizeSetting) {
                // globalBatchSizeSetting is a grid item
                globalBatchSizeSetting.style.display = useProviderDefaults
                    ? 'none'
                    : 'grid';
            }
            if (providerBatchSettings) {
                // providerBatchSettings is a setting-card, so use block
                providerBatchSettings.style.display = useProviderDefaults
                    ? 'block'
                    : 'none';
            }
        }

        optionsLogger.debug('Batch settings visibility updated', {
            batchingEnabled,
            useProviderDefaults,
            component: 'updateBatchSettingsVisibility',
        });
    };

    const loadAndApplyLanguage = async function () {
        const settings = await configService.getMultiple([
            'uiLanguage',
            'selectedProvider',
        ]);
        const { uiLanguage: lang, selectedProvider: savedProvider } = settings;

        uiLanguageSelect.value = lang;
        loadedTranslations = await loadTranslations(lang);
        updateUILanguage();
        populateProviderDropdown(); // Re-populate provider dropdown with new language

        // Restore the saved provider selection after re-populating
        if (availableProviders[savedProvider]) {
            translationProviderSelect.value = savedProvider;
        } else {
            // This should not happen since configService provides defaults from schema
            translationProviderSelect.value = 'deepl_free';
        }
        updateProviderSettings(); // Update provider settings visibility
    };

    const loadSettings = async function () {
        try {
            // Get all settings from configService
            const settings = await configService.getAll();

            // General
            const {
                uiLanguage,
                hideOfficialSubtitles,
                loggingLevel,
                selectedProvider,
                translationBatchSize,
                translationDelay,
                deeplApiKey,
                deeplApiPlan,
                openaiCompatibleApiKey,
                openaiCompatibleBaseUrl,
                openaiCompatibleModel,
                // Batch translation settings
                batchingEnabled,
                useProviderDefaults,
                globalBatchSize,
                maxConcurrentBatches,
                smartBatching,
                openaieBatchSize,
                googleBatchSize,
                deeplBatchSize,
                microsoftBatchSize,
                // Provider-specific delays
                openaieDelay,
                googleDelay,
                deeplDelay,
                deeplFreeDelay,
                microsoftDelay,
            } = settings;

            uiLanguageSelect.value = uiLanguage;
            hideOfficialSubtitlesCheckbox.checked = hideOfficialSubtitles;
            loggingLevelSelect.value = loggingLevel;

            // Translation
            if (availableProviders[selectedProvider]) {
                translationProviderSelect.value = selectedProvider;
            } else {
                // This should not happen since configService provides defaults from schema
                translationProviderSelect.value = 'deepl_free';
            }

            translationBatchSizeInput.value = translationBatchSize;
            translationDelayInput.value = translationDelay;

            // Providers
            deeplApiKeyInput.value = deeplApiKey;
            deeplApiPlanSelect.value = deeplApiPlan;
            openaiCompatibleApiKeyInput.value = openaiCompatibleApiKey;
            openaiCompatibleBaseUrlInput.value = openaiCompatibleBaseUrl;
            
            // Populate models dropdown
            const option = document.createElement('option');
            option.value = openaiCompatibleModel;
            option.textContent = openaiCompatibleModel;
            openaiCompatibleModelSelect.appendChild(option);
            openaiCompatibleModelSelect.value = openaiCompatibleModel;


            // Batch Translation Settings
            batchingEnabledCheckbox.checked = batchingEnabled;
            useProviderDefaultsCheckbox.checked = useProviderDefaults;
            globalBatchSizeInput.value = globalBatchSize;
            maxConcurrentBatchesInput.value = maxConcurrentBatches;
            smartBatchingCheckbox.checked = smartBatching;

            // Provider-specific batch sizes
            openaieBatchSizeInput.value = openaieBatchSize;
            googleBatchSizeInput.value = googleBatchSize;
            deeplBatchSizeInput.value = deeplBatchSize;
            microsoftBatchSizeInput.value = microsoftBatchSize;

            // Provider-specific delays
            openaieDelayInput.value = openaieDelay;
            googleDelayInput.value = googleDelay;
            deeplDelayInput.value = deeplDelay;
            deeplFreeDelayInput.value = deeplFreeDelay;
            microsoftDelayInput.value = microsoftDelay;

            // Update batch settings visibility
            updateBatchSettingsVisibility();

            // Update provider settings visibility - now we're sure all DOM elements are set
            updateProviderSettings();
        } catch (error) {
            optionsLogger.error('Error loading settings', error, {
                component: 'loadSettings',
            });
        }
    };

    // Initialize
    const init = async function () {
        setVersion();
        await loadAndApplyLanguage(); // Load language first
        await loadSettings(); // Then load settings which will restore the selected provider
    };

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
            await saveSetting('uiLanguage', selectedLang);
            await loadAndApplyLanguage();
            optionsLogger.info(`UI language changed to: ${selectedLang}`, {
                selectedLang,
                component: 'uiLanguageSelect',
            });
        });

    // Hide official subtitles setting
    document
        .getElementById('hideOfficialSubtitles')
        .addEventListener('change', async function () {
            await saveSetting('hideOfficialSubtitles', this.checked);
            optionsLogger.info(
                `Hide official subtitles changed to: ${this.checked}`,
                {
                    hideOfficialSubtitles: this.checked,
                    component: 'hideOfficialSubtitlesCheckbox',
                }
            );
        });

    // Logging level setting
    document
        .getElementById('loggingLevel')
        .addEventListener('change', async function () {
            const level = parseInt(this.value);
            await saveSetting('loggingLevel', level);
            optionsLogger.info(`Logging level changed to: ${level}`, {
                level,
                component: 'loggingLevelSelect',
            });
        });

    // Translation provider settings
    document
        .getElementById('translationProvider')
        .addEventListener('change', async function () {
            await saveSetting('selectedProvider', this.value);
            updateProviderSettings();
            optionsLogger.info(
                `Translation provider changed to: ${this.value}`,
                {
                    selectedProvider: this.value,
                    component: 'translationProviderSelect',
                }
            );
        });

    // Batch Translation Settings Event Listeners
    batchingEnabledCheckbox.addEventListener('change', async function () {
        await saveSetting('batchingEnabled', this.checked);
        updateBatchSettingsVisibility();
        optionsLogger.info(`Batch translation enabled: ${this.checked}`, {
            batchingEnabled: this.checked,
            component: 'batchingEnabledCheckbox',
        });
    });

    useProviderDefaultsCheckbox.addEventListener('change', async function () {
        await saveSetting('useProviderDefaults', this.checked);
        updateBatchSettingsVisibility();
        optionsLogger.info(`Use provider defaults: ${this.checked}`, {
            useProviderDefaults: this.checked,
            component: 'useProviderDefaultsCheckbox',
        });
    });

    globalBatchSizeInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('globalBatchSize', value);
        optionsLogger.info(`Global batch size changed: ${value}`, {
            globalBatchSize: value,
            component: 'globalBatchSizeInput',
        });
    });

    maxConcurrentBatchesInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('maxConcurrentBatches', value);
        optionsLogger.info(`Max concurrent batches changed: ${value}`, {
            maxConcurrentBatches: value,
            component: 'maxConcurrentBatchesInput',
        });
    });

    smartBatchingCheckbox.addEventListener('change', async function () {
        await saveSetting('smartBatching', this.checked);
        optionsLogger.info(`Smart batching enabled: ${this.checked}`, {
            smartBatching: this.checked,
            component: 'smartBatchingCheckbox',
        });
    });

    // Provider-specific batch size event listeners
    openaieBatchSizeInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('openaieBatchSize', value);
        optionsLogger.info(`OpenAI batch size changed: ${value}`, {
            openaieBatchSize: value,
            component: 'openaieBatchSizeInput',
        });
    });

    googleBatchSizeInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('googleBatchSize', value);
        optionsLogger.info(`Google batch size changed: ${value}`, {
            googleBatchSize: value,
            component: 'googleBatchSizeInput',
        });
    });

    deeplBatchSizeInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('deeplBatchSize', value);
        optionsLogger.info(`DeepL batch size changed: ${value}`, {
            deeplBatchSize: value,
            component: 'deeplBatchSizeInput',
        });
    });

    microsoftBatchSizeInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('microsoftBatchSize', value);
        optionsLogger.info(`Microsoft batch size changed: ${value}`, {
            microsoftBatchSize: value,
            component: 'microsoftBatchSizeInput',
        });
    });

    // Provider-specific delay event listeners
    openaieDelayInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('openaieDelay', value);
        optionsLogger.info(`OpenAI delay changed: ${value}ms`, {
            openaieDelay: value,
            component: 'openaieDelayInput',
        });
    });

    googleDelayInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('googleDelay', value);
        optionsLogger.info(`Google delay changed: ${value}ms`, {
            googleDelay: value,
            component: 'googleDelayInput',
        });
    });

    deeplDelayInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('deeplDelay', value);
        optionsLogger.info(`DeepL delay changed: ${value}ms`, {
            deeplDelay: value,
            component: 'deeplDelayInput',
        });
    });

    deeplFreeDelayInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('deeplFreeDelay', value);
        optionsLogger.info(`DeepL Free delay changed: ${value}ms`, {
            deeplFreeDelay: value,
            component: 'deeplFreeDelayInput',
        });
    });

    microsoftDelayInput.addEventListener('change', async function () {
        const value = parseInt(this.value);
        await saveSetting('microsoftDelay', value);
        optionsLogger.info(`Microsoft delay changed: ${value}ms`, {
            microsoftDelay: value,
            component: 'microsoftDelayInput',
        });
    });

    // DeepL specific settings
    deeplApiKeyInput.addEventListener('change', async function () {
        await saveSetting('deeplApiKey', deeplApiKeyInput.value);

        // Update test status when API key changes
        if (deeplApiKeyInput.value.trim()) {
            // Show "needs testing" status when key is entered
            showTestResult(
                deeplTestResult,
                getLocalizedText(
                    'deeplTestNeedsTesting',
                    '⚠️ DeepL API key needs testing.'
                ),
                'warning'
            );
        } else {
            // Show "no key" status when key is empty
            showTestResult(
                deeplTestResult,
                getLocalizedText(
                    'deeplApiKeyError',
                    'Please enter your DeepL API key first.'
                ),
                'error'
            );
        }
    });
    deeplApiPlanSelect.addEventListener(
        'change',
        async () => await saveSetting('deeplApiPlan', deeplApiPlanSelect.value)
    );

    // OpenAI Compatible specific settings
    openaiCompatibleApiKeyInput.addEventListener('change', async function () {
        await saveSetting('openaiCompatibleApiKey', this.value);
    });
    openaiCompatibleBaseUrlInput.addEventListener('change', async function () {
        await saveSetting('openaiCompatibleBaseUrl', this.value);
    });
    openaiCompatibleModelSelect.addEventListener('change', async function () {
        await saveSetting('openaiCompatibleModel', this.value);
    });
    testOpenAIButton.addEventListener('click', testOpenAIConnection);
    fetchOpenAIModelsButton.addEventListener('click', fetchOpenAIModels);


    // Initialize DeepL test result with default status
    const initializeDeepLTestStatus = function () {
        // Check if API key is already entered
        const currentApiKey = deeplApiKeyInput.value.trim();

        if (currentApiKey) {
            // Show "needs testing" status when key is present
            showTestResult(
                deeplTestResult,
                getLocalizedText(
                    'deeplTestNeedsTesting',
                    '⚠️ DeepL API key needs testing.'
                ),
                'warning'
            );
        } else {
            // Show "no key" status when key is empty
            showTestResult(
                deeplTestResult,
                getLocalizedText(
                    'deeplApiKeyError',
                    'Please enter your DeepL API key first.'
                ),
                'error'
            );
        }
    };

    // 安全地添加 DeepL 测试按钮的事件监听器
    // 检查 DeepLAPI 是否可用，如果不可用则禁用按钮并显示错误
    if (
        typeof window.DeepLAPI !== 'undefined' &&
        window.DeepLAPI &&
        typeof window.DeepLAPI.testDeepLConnection === 'function'
    ) {
        testDeepLButton.addEventListener('click', testDeepLConnection);
        // Initialize with default status
        initializeDeepLTestStatus();
    } else {
        optionsLogger.error(
            'DeepLAPI is not available. Disabling testDeepLButton.',
            null,
            { component: 'testDeepLButton' }
        );
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
                deeplTestResult,
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
        .addEventListener('change', async function () {
            await saveSetting('translationBatchSize', parseInt(this.value));
            if (translationBatchSizeValue)
                translationBatchSizeValue.textContent = this.value;
        });

    document
        .getElementById('translationDelay')
        .addEventListener('change', async function () {
            await saveSetting('translationDelay', parseInt(this.value));
            if (translationDelayValue)
                translationDelayValue.textContent = `${this.value}ms`;
        });

    init();
});
