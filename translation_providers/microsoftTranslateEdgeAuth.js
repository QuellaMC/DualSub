// disneyplus-dualsub-chrome-extension/translation_providers/microsoftTranslateEdgeAuth.js
// Thanks to: https://github.com/Chewawi/microsoft-translate-api/

const API_AUTH_EDGE = "https://edge.microsoft.com/translate/auth";
const API_TRANSLATE_COGNITIVE = "https://api.cognitive.microsofttranslator.com/translate";
const DEFAULT_USER_AGENT = navigator.userAgent || "Mozilla/5.0 (Windows; U; Windows NT 6.3; WOW64; en-US) AppleWebKit/603.43 (KHTML, like Gecko) Chrome/47.0.2805.119 Safari/603";

// --- Token Management ---
let globalAuthToken = null;
let tokenExpiresAt = 0;
let ongoingAuthPromise = null;

/**
 * Fetches or refreshes the authentication token from Microsoft Edge's auth service.
 */
async function fetchAuthToken() {
    console.log("MicrosoftTranslateEdgeAuth: Attempting to fetch new auth token.");
    try {
        const response = await fetch(API_AUTH_EDGE, {
            headers: { "User-Agent": DEFAULT_USER_AGENT },
        });
        if (!response.ok) {
            throw new Error(`Auth API HTTP error! Status: ${response.status}`);
        }
        const authJWT = await response.text();
        
        // Decode JWT payload to get expiration (exp is in seconds)
        // In a browser environment, Buffer.from is not available, use atob.
        const payloadBase64 = authJWT.split('.')[1];
        const decodedPayload = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
        const jwtPayload = JSON.parse(decodedPayload);

        if (!jwtPayload.exp) {
            throw new Error("Auth token payload does not contain 'exp' (expiration time).");
        }

        globalAuthToken = authJWT;
        tokenExpiresAt = jwtPayload.exp * 1000; // Convert to milliseconds
        console.log("MicrosoftTranslateEdgeAuth: New auth token fetched. Expires at:", new Date(tokenExpiresAt).toISOString());
        return globalAuthToken;
    } catch (e) {
        console.error("MicrosoftTranslateEdgeAuth: Failed to fetch auth token:", e);
        globalAuthToken = null;
        tokenExpiresAt = 0;
        throw new Error("Failed to fetch auth token for Microsoft Translator.");
    }
}

/**
 * Checks if the current token is expired or about to expire (within 60 seconds).
 * @returns {boolean} True if token is expired or nearing expiration.
 */
function isTokenExpired() {
    if (!globalAuthToken) return true;
    return (tokenExpiresAt - Date.now()) < 60000; // Refresh if less than 60s validity left
}

/**
 * Ensures a valid authentication token is available, fetching/refreshing if necessary.
 */
async function ensureAuthentication() {
    if (isTokenExpired()) {
        if (ongoingAuthPromise) {
            console.log("MicrosoftTranslateEdgeAuth: Waiting for ongoing auth token refresh...");
            await ongoingAuthPromise;
        } else {
            console.log("MicrosoftTranslateEdgeAuth: Token expired or missing. Refreshing...");
            ongoingAuthPromise = fetchAuthToken();
            try {
                await ongoingAuthPromise;
            } finally {
                ongoingAuthPromise = null;
            }
        }
    }
    if (!globalAuthToken) {
        throw new Error("Microsoft Translator authentication failed or token is unavailable.");
    }
    return globalAuthToken;
}

/**
 * Translates text using the Microsoft Translator API (Cognitive Services endpoint with Edge auth).
 *
 * @param {string} text The text to translate.
 * @param {string} sourceLang The source language code (e.g., 'auto', 'en'). 'auto' will become undefined for the API.
 * @param {string} targetLang The target language code (e.g., 'es', 'zh-CN').
 * @returns {Promise<string>} A Promise that resolves with the translated text.
 * @throws {Error} If the translation API request or processing fails.
 */
export async function translate(text, sourceLang, targetLang) {
    if (!text || typeof text !== 'string' || text.trim() === "") {
        return ""; // Return empty string for empty input
    }

    const actualSourceLang = (sourceLang && sourceLang.toLowerCase() === 'auto') ? undefined : sourceLang;

    try {
        const authToken = await ensureAuthentication();

        const requestBody = [{ "Text": text }];
        const apiParams = new URLSearchParams({
            "api-version": "3.0",
            "to": targetLang,
        });

        if (actualSourceLang) {
            apiParams.append("from", actualSourceLang);
        }

        const response = await fetch(`${API_TRANSLATE_COGNITIVE}?${apiParams.toString()}`, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + authToken,
                "Content-Type": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            let errorDetails = "No details available.";
            try {
                const errorJson = await response.json();
                errorDetails = JSON.stringify(errorJson.error || errorJson);
            } catch (e) {
                errorDetails = await response.text();
            }
            console.error(`MicrosoftTranslateEdgeAuth: API HTTP error! Status: ${response.status}. Details:`, errorDetails);
            throw new Error(`Translation API HTTP error ${response.status}. Details: ${errorDetails.substring(0, 200)}`);
        }

        const result = await response.json();

        if (Array.isArray(result) && result.length > 0 &&
            result[0].translations && Array.isArray(result[0].translations) && result[0].translations.length > 0 &&
            typeof result[0].translations[0].text === 'string') {
            return result[0].translations[0].text;
        } else {
            console.error("MicrosoftTranslateEdgeAuth: Translation JSON parsing failed or unexpected structure. Response:", result);
            throw new Error("Translation Error: Malformed JSON response from Microsoft Translator.");
        }
    } catch (error) {
        console.error("MicrosoftTranslateEdgeAuth: API request/processing error:", error);
        // Re-throw the error to be caught by the caller in background.js
        throw error;
    }
}