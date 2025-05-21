# Translation Provider Interface

This document outlines the interface that all translation provider modules must adhere to for the Disney+ Dual Subtitles Chrome Extension.

## Module Structure

Each translation provider should be implemented as a separate JavaScript module file (e.g., `googleTranslate.js`, `someOtherProvider.js`).

## `translate` Function

Each module must export an asynchronous function named `translate`.

### Signature

`async function translate(text, sourceLang, targetLang)`

### Parameters

*   `text` (String): The text content to be translated.
*   `sourceLang` (String): The language code of the original text (e.g., 'auto', 'en', 'ja'). The specific supported codes may depend on the provider.
*   `targetLang` (String): The language code for the desired translation (e.g., 'en', 'es', 'zh-CN'). The specific supported codes will depend on the provider.

### Returns

*   `Promise<string>`: A Promise that resolves with the translated string. If the translation fails, the Promise should reject with an Error object containing a descriptive message.

### Example

```javascript
// in myProvider.js
export async function translate(text, sourceLang, targetLang) {
    // Implementation specific to this provider
    // ...
    if (success) {
        return "translated text";
    } else {
        throw new Error("Translation failed due to XYZ reason.");
    }
}
```

## Provider Registration (Conceptual)

While not part of the module itself, providers will be registered and selected in `background.js`. Each provider should also have a user-friendly name for display in the extension's popup settings.
