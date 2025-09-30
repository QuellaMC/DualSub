import React from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';

export function TranslationSection({ t, settings, onSettingChange }) {
    const availableProviders = {
        google: 'providerGoogleName',
        microsoft_edge_auth: 'providerMicrosoftName',
        deepl: 'providerDeepLName',
        deepl_free: 'providerDeepLFreeName',
        openai_compatible: 'providerOpenAICompatibleName',
    };

    const batchingEnabled = settings.batchingEnabled || false;
    const useProviderDefaults = settings.useProviderDefaults || false;

    return (
        <section id="translation">
            <h2>{t('sectionTranslation', 'Translation')}</h2>
            
            <SettingCard
                title={t('cardTranslationEngineTitle', 'Translation Engine')}
                description={t(
                    'cardTranslationEngineDesc',
                    'Select your preferred translation service.'
                )}
            >
                <div className="setting">
                    <label htmlFor="translationProvider">
                        {t('providerLabel', 'Provider:')}
                    </label>
                    <select
                        id="translationProvider"
                        value={settings.selectedProvider || 'deepl_free'}
                        onChange={(e) =>
                            onSettingChange('selectedProvider', e.target.value)
                        }
                    >
                        {Object.entries(availableProviders).map(
                            ([id, nameKey]) => (
                                <option key={id} value={id}>
                                    {t(nameKey, id)}
                                </option>
                            )
                        )}
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardPerformanceTitle', 'Performance')}
                description={t(
                    'cardPerformanceDesc',
                    'Adjust how the extension handles translation requests to balance speed and stability.'
                )}
            >
                <div className="setting">
                    <label htmlFor="translationBatchSize">
                        {t('batchSizeLabel', 'Batch Size:')}
                    </label>
                    <input
                        type="number"
                        id="translationBatchSize"
                        min="1"
                        max="10"
                        step="1"
                        value={settings.translationBatchSize || 3}
                        onChange={(e) =>
                            onSettingChange('translationBatchSize', parseInt(e.target.value))
                        }
                    />
                </div>

                <div className="setting">
                    <label htmlFor="translationDelay">
                        {t('requestDelayLabel', 'Request Delay (ms):')}
                    </label>
                    <input
                        type="number"
                        id="translationDelay"
                        min="0"
                        max="5000"
                        step="50"
                        value={settings.translationDelay || 150}
                        onChange={(e) =>
                            onSettingChange('translationDelay', parseInt(e.target.value))
                        }
                    />
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardBatchTranslationTitle', 'Batch Translation')}
                description={t(
                    'cardBatchTranslationDesc',
                    'Batch translation processes multiple subtitle segments together, reducing API calls by 80-90% and improving performance. Configure optimal settings for your preferred translation provider.'
                )}
            >
                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="batchingEnabled">
                            {t('batchingEnabledLabel', 'Enable Batch Translation:')}
                        </label>
                        <div className="setting-help">
                            {t(
                                'batchingEnabledHelp',
                                'Groups multiple subtitle segments into single translation requests'
                            )}
                        </div>
                    </div>
                    <ToggleSwitch
                        id="batchingEnabled"
                        checked={batchingEnabled}
                        onChange={(checked) =>
                            onSettingChange('batchingEnabled', checked)
                        }
                    />
                </div>

                {batchingEnabled && (
                    <>
                        <div className="setting setting-with-help">
                            <div className="setting-content">
                                <label htmlFor="useProviderDefaults">
                                    {t(
                                        'useProviderDefaultsLabel',
                                        'Use Provider-Optimized Settings:'
                                    )}
                                </label>
                                <div className="setting-help">
                                    {t(
                                        'useProviderDefaultsHelp',
                                        'Automatically use optimal batch sizes for each translation provider'
                                    )}
                                </div>
                            </div>
                            <ToggleSwitch
                                id="useProviderDefaults"
                                checked={useProviderDefaults}
                                onChange={(checked) =>
                                    onSettingChange('useProviderDefaults', checked)
                                }
                            />
                        </div>

                        {!useProviderDefaults && (
                            <div className="setting setting-with-help">
                                <div className="setting-content">
                                    <label htmlFor="globalBatchSize">
                                        {t('globalBatchSizeLabel', 'Global Batch Size:')}
                                    </label>
                                    <div className="setting-help">
                                        {t(
                                            'globalBatchSizeHelp',
                                            'Number of subtitle segments to process together (1-15)'
                                        )}
                                    </div>
                                </div>
                                <input
                                    type="number"
                                    id="globalBatchSize"
                                    min="1"
                                    max="15"
                                    step="1"
                                    value={settings.globalBatchSize || 5}
                                    onChange={(e) =>
                                        onSettingChange('globalBatchSize', parseInt(e.target.value))
                                    }
                                />
                            </div>
                        )}

                        <div className="setting setting-with-help">
                            <div className="setting-content">
                                <label htmlFor="smartBatching">
                                    {t('smartBatchingLabel', 'Smart Batch Optimization:')}
                                </label>
                                <div className="setting-help">
                                    {t(
                                        'smartBatchingHelp',
                                        'Prioritizes subtitle segments based on playback position'
                                    )}
                                </div>
                            </div>
                            <ToggleSwitch
                                id="smartBatching"
                                checked={settings.smartBatching || false}
                                onChange={(checked) =>
                                    onSettingChange('smartBatching', checked)
                                }
                            />
                        </div>

                        <div className="setting setting-with-help">
                            <div className="setting-content">
                                <label htmlFor="maxConcurrentBatches">
                                    {t('maxConcurrentBatchesLabel', 'Maximum Concurrent Batches:')}
                                </label>
                                <div className="setting-help">
                                    {t(
                                        'maxConcurrentBatchesHelp',
                                        'Number of translation batches to process simultaneously'
                                    )}
                                </div>
                            </div>
                            <input
                                type="number"
                                id="maxConcurrentBatches"
                                min="1"
                                max="5"
                                step="1"
                                value={settings.maxConcurrentBatches || 2}
                                onChange={(e) =>
                                    onSettingChange('maxConcurrentBatches', parseInt(e.target.value))
                                }
                            />
                        </div>
                    </>
                )}
            </SettingCard>

            {batchingEnabled && useProviderDefaults && (
                <SettingCard
                    title={t('cardProviderBatchTitle', 'Provider-Specific Batch Sizes')}
                    description={t(
                        'cardProviderBatchDesc',
                        'Configure optimal batch sizes for each translation provider. These settings are used when "Use Provider-Optimized Settings" is enabled.'
                    )}
                >
                    <div className="setting setting-with-help">
                        <div className="setting-content">
                            <label htmlFor="openaieBatchSize">
                                {t('openaieBatchSizeLabel', 'OpenAI Batch Size:')}
                            </label>
                            <div className="setting-help">
                                {t('openaieBatchSizeHelp', 'Recommended: 5-10 segments (default: 8)')}
                            </div>
                        </div>
                        <input
                            type="number"
                            id="openaieBatchSize"
                            min="1"
                            max="15"
                            step="1"
                            value={settings.openaieBatchSize || 8}
                            onChange={(e) =>
                                onSettingChange('openaieBatchSize', parseInt(e.target.value))
                            }
                        />
                    </div>

                    <div className="setting setting-with-help">
                        <div className="setting-content">
                            <label htmlFor="googleBatchSize">
                                {t('googleBatchSizeLabel', 'Google Translate Batch Size:')}
                            </label>
                            <div className="setting-help">
                                {t('googleBatchSizeHelp', 'Recommended: 3-5 segments (default: 4)')}
                            </div>
                        </div>
                        <input
                            type="number"
                            id="googleBatchSize"
                            min="1"
                            max="10"
                            step="1"
                            value={settings.googleBatchSize || 4}
                            onChange={(e) =>
                                onSettingChange('googleBatchSize', parseInt(e.target.value))
                            }
                        />
                    </div>

                    <div className="setting setting-with-help">
                        <div className="setting-content">
                            <label htmlFor="deeplBatchSize">
                                {t('deeplBatchSizeLabel', 'DeepL Batch Size:')}
                            </label>
                            <div className="setting-help">
                                {t('deeplBatchSizeHelp', 'Recommended: 2-3 segments (default: 3)')}
                            </div>
                        </div>
                        <input
                            type="number"
                            id="deeplBatchSize"
                            min="1"
                            max="8"
                            step="1"
                            value={settings.deeplBatchSize || 3}
                            onChange={(e) =>
                                onSettingChange('deeplBatchSize', parseInt(e.target.value))
                            }
                        />
                    </div>

                    <div className="setting setting-with-help">
                        <div className="setting-content">
                            <label htmlFor="microsoftBatchSize">
                                {t('microsoftBatchSizeLabel', 'Microsoft Translate Batch Size:')}
                            </label>
                            <div className="setting-help">
                                {t('microsoftBatchSizeHelp', 'Recommended: 3-5 segments (default: 4)')}
                            </div>
                        </div>
                        <input
                            type="number"
                            id="microsoftBatchSize"
                            min="1"
                            max="10"
                            step="1"
                            value={settings.microsoftBatchSize || 4}
                            onChange={(e) =>
                                onSettingChange('microsoftBatchSize', parseInt(e.target.value))
                            }
                        />
                    </div>
                </SettingCard>
            )}

            <SettingCard
                title={t('cardProviderDelayTitle', 'Provider-Specific Request Delays')}
                description={t(
                    'cardProviderDelayDesc',
                    'Configure mandatory delays between translation requests to prevent account lockouts. These delays are applied even when batch processing is enabled.'
                )}
            >
                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="openaieDelay">
                            {t('openaieDelayLabel', 'OpenAI Request Delay (ms):')}
                        </label>
                        <div className="setting-help">
                            {t('openaieDelayHelp', 'Minimum delay between requests (default: 100ms)')}
                        </div>
                    </div>
                    <input
                        type="number"
                        id="openaieDelay"
                        min="50"
                        max="5000"
                        step="50"
                        value={settings.openaieDelay || 100}
                        onChange={(e) =>
                            onSettingChange('openaieDelay', parseInt(e.target.value))
                        }
                    />
                </div>

                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="googleDelay">
                            {t('googleDelayLabel', 'Google Translate Request Delay (ms):')}
                        </label>
                        <div className="setting-help">
                            {t('googleDelayHelp', 'Required delay to prevent temporary lockouts (default: 1500ms)')}
                        </div>
                    </div>
                    <input
                        type="number"
                        id="googleDelay"
                        min="1000"
                        max="10000"
                        step="100"
                        value={settings.googleDelay || 1500}
                        onChange={(e) =>
                            onSettingChange('googleDelay', parseInt(e.target.value))
                        }
                    />
                </div>

                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="deeplDelay">
                            {t('deeplDelayLabel', 'DeepL API Request Delay (ms):')}
                        </label>
                        <div className="setting-help">
                            {t('deeplDelayHelp', 'Delay for DeepL API requests (default: 500ms)')}
                        </div>
                    </div>
                    <input
                        type="number"
                        id="deeplDelay"
                        min="200"
                        max="5000"
                        step="100"
                        value={settings.deeplDelay || 500}
                        onChange={(e) =>
                            onSettingChange('deeplDelay', parseInt(e.target.value))
                        }
                    />
                </div>

                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="deeplFreeDelay">
                            {t('deeplFreeDelayLabel', 'DeepL Free Request Delay (ms):')}
                        </label>
                        <div className="setting-help">
                            {t('deeplFreeDelayHelp', 'Conservative delay for free tier (default: 2000ms)')}
                        </div>
                    </div>
                    <input
                        type="number"
                        id="deeplFreeDelay"
                        min="1000"
                        max="10000"
                        step="100"
                        value={settings.deeplFreeDelay || 2000}
                        onChange={(e) =>
                            onSettingChange('deeplFreeDelay', parseInt(e.target.value))
                        }
                    />
                </div>

                <div className="setting setting-with-help">
                    <div className="setting-content">
                        <label htmlFor="microsoftDelay">
                            {t('microsoftDelayLabel', 'Microsoft Translate Request Delay (ms):')}
                        </label>
                        <div className="setting-help">
                            {t('microsoftDelayHelp', 'Delay to respect character limits (default: 800ms)')}
                        </div>
                    </div>
                    <input
                        type="number"
                        id="microsoftDelay"
                        min="500"
                        max="5000"
                        step="100"
                        value={settings.microsoftDelay || 800}
                        onChange={(e) =>
                            onSettingChange('microsoftDelay', parseInt(e.target.value))
                        }
                    />
                </div>
            </SettingCard>
        </section>
    );
}
