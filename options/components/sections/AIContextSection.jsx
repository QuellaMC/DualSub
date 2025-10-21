import React, { useState, useEffect } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';

export function AIContextSection({ t, settings, onSettingChange }) {
    const [contextTypes, setContextTypes] = useState({
        cultural: false,
        historical: false,
        linguistic: false,
    });

    // Load context types from settings
    useEffect(() => {
        const types = settings.aiContextTypes || [];
        setContextTypes({
            cultural: types.includes('cultural'),
            historical: types.includes('historical'),
            linguistic: types.includes('linguistic'),
        });
    }, [settings.aiContextTypes]);

    const handleContextTypeChange = (type, checked) => {
        const newTypes = { ...contextTypes, [type]: checked };
        setContextTypes(newTypes);

        // Convert to array for storage
        const typesArray = Object.entries(newTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type);

        onSettingChange('aiContextTypes', typesArray);
    };

    const aiContextEnabled = settings.aiContextEnabled || false;
    const aiContextProvider = settings.aiContextProvider || 'openai';

    return (
        <section id="ai-context">
            <h2>{t('sectionAIContext', 'AI Context Assistant')}</h2>

            {/* Card 1: Feature Toggle */}
            <SettingCard
                title={t(
                    'cardAIContextToggleTitle',
                    'Enable AI Context Analysis'
                )}
                description={t(
                    'cardAIContextToggleDesc',
                    'Enable AI-powered cultural, historical, and linguistic context analysis for subtitle text. Click on words or phrases in subtitles to get detailed explanations.'
                )}
            >
                <div className="setting">
                    <label htmlFor="aiContextEnabled">
                        {t('aiContextEnabledLabel', 'Enable AI Context:')}
                    </label>
                    <ToggleSwitch
                        id="aiContextEnabled"
                        checked={aiContextEnabled}
                        onChange={(checked) =>
                            onSettingChange('aiContextEnabled', checked)
                        }
                    />
                </div>
            </SettingCard>

            {/* Card 2: Provider Selection */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextProviderTitle', 'AI Provider')}
                    description={t(
                        'cardAIContextProviderDesc',
                        'Choose the AI service provider for context analysis. Different providers may offer varying quality and response times.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="aiContextProvider">
                            {t('aiContextProviderLabel', 'Provider:')}
                        </label>
                        <select
                            id="aiContextProvider"
                            value={aiContextProvider}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextProvider',
                                    e.target.value
                                )
                            }
                        >
                            <option value="openai">OpenAI GPT</option>
                            <option value="gemini">Google Gemini</option>
                        </select>
                    </div>
                </SettingCard>
            )}

            {/* Card 3: OpenAI Configuration */}
            {aiContextEnabled && aiContextProvider === 'openai' && (
                <SettingCard
                    title={t('cardOpenAIContextTitle', 'OpenAI Configuration')}
                    description={t(
                        'cardOpenAIContextDesc',
                        'Configure your OpenAI API settings for context analysis. You need a valid OpenAI API key.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="openaiApiKey">
                            {t('openaiApiKeyLabel', 'API Key:')}
                        </label>
                        <input
                            type="password"
                            id="openaiApiKey"
                            value={settings.openaiApiKey || ''}
                            onChange={(e) =>
                                onSettingChange('openaiApiKey', e.target.value)
                            }
                            placeholder="sk-..."
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiBaseUrl">
                            {t('openaiBaseUrlLabel', 'Base URL:')}
                        </label>
                        <input
                            type="url"
                            id="openaiBaseUrl"
                            value={settings.openaiBaseUrl || ''}
                            onChange={(e) =>
                                onSettingChange('openaiBaseUrl', e.target.value)
                            }
                            placeholder="https://api.openai.com/v1"
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiModel">
                            {t('openaiModelLabel', 'Model:')}
                        </label>
                        <select
                            id="openaiModel"
                            value={
                                settings.openaiModel ||
                                'gpt-4.1-mini-2025-04-14'
                            }
                            onChange={(e) =>
                                onSettingChange('openaiModel', e.target.value)
                            }
                        >
                            <option
                                value="gpt-4.1-nano-2025-04-14"
                                title="Cost-effective for most context analysis tasks"
                            >
                                GPT-4.1 Nano
                            </option>
                            <option
                                value="gpt-4.1-mini-2025-04-14"
                                title="High-quality analysis with better cultural understanding"
                            >
                                GPT-4.1 Mini (Recommended)
                            </option>
                            <option
                                value="gpt-4o-mini-2024-07-18"
                                title="Optimized for speed and efficiency"
                            >
                                GPT-4o Mini
                            </option>
                            <option
                                value="gpt-4o-2024-08-06"
                                title="Optimized for speed and efficiency"
                            >
                                GPT-4o
                            </option>
                        </select>
                    </div>
                </SettingCard>
            )}

            {/* Card 4: Gemini Configuration */}
            {aiContextEnabled && aiContextProvider === 'gemini' && (
                <SettingCard
                    title={t(
                        'cardGeminiContextTitle',
                        'Google Gemini Configuration'
                    )}
                    description={t(
                        'cardGeminiContextDesc',
                        'Configure your Google Gemini API settings for context analysis. You need a valid Gemini API key.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="geminiApiKey">
                            {t('geminiApiKeyLabel', 'API Key:')}
                        </label>
                        <input
                            type="password"
                            id="geminiApiKey"
                            value={settings.geminiApiKey || ''}
                            onChange={(e) =>
                                onSettingChange('geminiApiKey', e.target.value)
                            }
                            placeholder="AIza..."
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="geminiModel">
                            {t('geminiModelLabel', 'Model:')}
                        </label>
                        <select
                            id="geminiModel"
                            value={settings.geminiModel || 'gemini-2.5-flash'}
                            onChange={(e) =>
                                onSettingChange('geminiModel', e.target.value)
                            }
                        >
                            <option
                                value="gemini-2.5-flash"
                                title="Fast and efficient model for quick context analysis"
                            >
                                Gemini 2.5 Flash (Recommended)
                            </option>
                            <option
                                value="gemini-2.5-pro"
                                title="Advanced model with superior reasoning for complex cultural analysis"
                            >
                                Gemini 2.5 Pro
                            </option>
                            <option
                                value="gemini-1.5-flash"
                                title="Previous generation fast model (legacy)"
                            >
                                Gemini 1.5 Flash
                            </option>
                            <option
                                value="gemini-1.5-pro"
                                title="Previous generation advanced model (legacy)"
                            >
                                Gemini 1.5 Pro
                            </option>
                        </select>
                    </div>
                </SettingCard>
            )}

            {/* Card 5: Context Types */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextTypesTitle', 'Context Types')}
                    description={t(
                        'cardAIContextTypesDesc',
                        'Enable the types of context analysis you want to use. You can enable multiple types.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="contextTypeCultural">
                            {t('contextTypeCulturalLabel', 'Cultural Context:')}
                        </label>
                        <ToggleSwitch
                            id="contextTypeCultural"
                            checked={contextTypes.cultural}
                            onChange={(checked) =>
                                handleContextTypeChange('cultural', checked)
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="contextTypeHistorical">
                            {t(
                                'contextTypeHistoricalLabel',
                                'Historical Context:'
                            )}
                        </label>
                        <ToggleSwitch
                            id="contextTypeHistorical"
                            checked={contextTypes.historical}
                            onChange={(checked) =>
                                handleContextTypeChange('historical', checked)
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="contextTypeLinguistic">
                            {t(
                                'contextTypeLinguisticLabel',
                                'Linguistic Context:'
                            )}
                        </label>
                        <ToggleSwitch
                            id="contextTypeLinguistic"
                            checked={contextTypes.linguistic}
                            onChange={(checked) =>
                                handleContextTypeChange('linguistic', checked)
                            }
                        />
                    </div>
                </SettingCard>
            )}

            {/* Card 6: Advanced Settings */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextAdvancedTitle', 'Advanced Settings')}
                    description={t(
                        'cardAIContextAdvancedDesc',
                        'Configure advanced options for AI context analysis behavior.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="aiContextTimeout">
                            {t(
                                'aiContextTimeoutLabel',
                                'Request Timeout (ms):'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextTimeout"
                            min="5000"
                            max="60000"
                            step="1000"
                            value={settings.aiContextTimeout || 10000}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextTimeout',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextRateLimit">
                            {t(
                                'aiContextRateLimitLabel',
                                'Rate Limit (requests/min):'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextRateLimit"
                            min="10"
                            max="300"
                            step="10"
                            value={settings.aiContextRateLimit || 60}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextRateLimit',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextCacheEnabled">
                            {t('aiContextCacheEnabledLabel', 'Enable Caching:')}
                        </label>
                        <ToggleSwitch
                            id="aiContextCacheEnabled"
                            checked={settings.aiContextCacheEnabled || false}
                            onChange={(checked) =>
                                onSettingChange(
                                    'aiContextCacheEnabled',
                                    checked
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextRetryAttempts">
                            {t(
                                'aiContextRetryAttemptsLabel',
                                'Retry Attempts:'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextRetryAttempts"
                            min="1"
                            max="5"
                            step="1"
                            value={settings.aiContextRetryAttempts || 2}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextRetryAttempts',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>
                </SettingCard>
            )}
        </section>
    );
}
