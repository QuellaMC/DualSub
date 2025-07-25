// DualSub/utils/openaiApi.js

import Logger from './logger.js';
import { configService } from '../services/configService.js';

const logger = Logger.create('OpenAIApi');

/**
 * Normalizes baseUrl by removing trailing slashes and backslashes
 * @param {string} url - The base URL to normalize
 * @returns {string} Normalized URL without trailing slashes
 */
export function normalizeBaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return url;
    }

    const normalized = url.replace(/[/\\]+$/, '');

    logger.debug('Base URL normalized', {
        originalUrl: url,
        normalizedUrl: normalized,
        hadTrailingSlash: url !== normalized
    });

    return normalized;
}

/**
 * Normalizes model name for OpenAI-compatible endpoints
 * @param {string} model - The model name to normalize
 * @param {string} baseUrl - The base URL to determine provider type
 * @returns {string} Normalized model name
 */
export function normalizeModelName(model, baseUrl) {
    if (!model || typeof model !== 'string') {
        return model;
    }

    if (baseUrl && baseUrl.includes('generativelanguage.googleapis.com')) {
        const normalized = model.startsWith('models/') ? model.substring(7) : model;

        logger.debug('Model name normalized for Gemini', {
            originalModel: model,
            normalizedModel: normalized,
            hadModelsPrefix: model.startsWith('models/')
        });

        return normalized;
    }

    return model;
}

/**
 * Retrieves the configuration from storage using the config service.
 * @returns {Promise<Object>} Configuration object with apiKey, baseUrl, and model.
 */
export async function getConfig() {
    logger.debug('Retrieving configuration via configService');
    
    const config = await configService.getMultiple([
        'openaiCompatibleApiKey',
        'openaiCompatibleBaseUrl', 
        'openaiCompatibleModel'
    ]);

    const result = {
        apiKey: config.openaiCompatibleApiKey,
        baseUrl: config.openaiCompatibleBaseUrl,
        model: config.openaiCompatibleModel
    };

    logger.debug('Configuration retrieved successfully via configService', {
        hasApiKey: !!result.apiKey,
        baseUrl: result.baseUrl,
        model: result.model
    });

    return result;
} 