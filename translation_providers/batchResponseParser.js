/**
 * Parse a model response as an exact JSON string array.
 * Strict cardinality prevents one malformed segment from shifting every later
 * subtitle onto the wrong cue.
 *
 * @param {string} responseText
 * @param {number} expectedCount
 * @returns {string[]}
 */
export function parseTranslationArray(responseText, expectedCount) {
    if (typeof responseText !== 'string' || responseText.trim() === '') {
        throw new Error('Batch translation returned an empty response.');
    }
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
        throw new Error('Batch translation expected count is invalid.');
    }

    const trimmed = responseText.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const jsonText = fenced ? fenced[1] : trimmed;

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error('Batch translation did not return valid JSON.', {
            cause: error,
        });
    }

    if (!Array.isArray(parsed)) {
        throw new Error('Batch translation response must be a JSON array.');
    }
    if (parsed.length !== expectedCount) {
        throw new Error(
            `Batch translation count mismatch: expected ${expectedCount}, received ${parsed.length}.`
        );
    }
    if (parsed.some((value) => typeof value !== 'string')) {
        throw new Error(
            'Batch translation response must contain only string values.'
        );
    }

    return parsed.map((value) => value.trim());
}
