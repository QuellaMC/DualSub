# Disney+ Dual Subtitles Chrome Extension

**Version:** 0.7.5

**Status:** Working

**Update Time:** 2025/05/21

## Description

Disney+ Dual Subtitles enhances your Disney+ viewing experience by displaying two sets of subtitles simultaneously. This allows you to, for example, view subtitles in their original language alongside a translation in your preferred language. The extension offers customization options for subtitle appearance, timing, and translation preferences.

## Features

* **Dual Subtitles:** Display original and translated subtitles at the same time.
* **Customizable Target Language:** Choose from a wide range of languages for the second subtitle track.
* **Timing Adjustment:** Fine-tune subtitle synchronization with a time offset option.
* **Layout Customization:**
  * **Display Order:** Choose whether original or translated subtitles appear on top/first.
  * **Orientation:** Stack subtitles vertically (Top/Bottom) or display them side-by-side (Left/Right).
* **Appearance Settings:**
  * **Font Size:** Adjust the subtitle text size.
  * **Subtitle Gap:** Control the spacing between the two subtitle tracks (for vertical layout).
* **Translation Performance:**
  * **Batch Size:** Configure the number of subtitle segments translated at once.
  * **Translation Delay:** Set a delay between translation requests to manage API rate limits.
* **Enable/Disable:** Easily toggle the dual subtitle functionality.

## How It Works

The extension injects scripts into Disney+ pages to capture and process subtitle information.

1. The `inject.js` script intercepts network requests to find the master subtitle playlist URL (M3U8) and the video ID from the page.
2. This information is sent to the `background.js` script.
3. `background.js` fetches and parses the M3U8 playlist to extract individual VTT (subtitle segment) URLs. It then fetches and combines these VTT segments into a single VTT string.
4. The `content.js` script receives the combined VTT content. It parses the VTT cues and, based on the video's current time and user settings, displays the original subtitle.
5. For the second subtitle, `content.js` sends batches of original subtitle text to `background.js` for translation using the Google Translate API.
6. The translated text is then sent back to `content.js` and displayed alongside the original subtitle, according to the user's layout preferences.
7. A popup menu (`popup.html`, `popup.js`, `popup.css`) allows users to configure various settings, which are saved and applied to the subtitle display.

## Installation

1. Download or clone this repository.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable "Developer mode" using the toggle switch in the top-right corner.
4. Click on the "Load unpacked" button.
5. Select the `disneyplus-dualsub-chrome-extension` directory from your local files.
6. The extension should now be installed and active.

## Configuration

You can configure the extension by clicking on its icon in the Chrome toolbar. The following settings are available:

* **Enable Subtitles:** Toggle the dual subtitle feature on or off.
* **Translate to:** Select your desired target language for the second subtitle.
* **Time Offset (sec):** Adjust subtitle timing. Negative values make subtitles appear earlier, positive values later.
* **Display Order:** Choose which subtitle (original or translation) appears first or on top.
* **Layout Orientation:** Display subtitles stacked vertically (Top / Bottom) or side-by-side (Left / Right).
* **Subtitle Size:** Adjust the size of the subtitle text.
* **Subtitle Gap:** Adjust the gap between the original and translated subtitles (when using Top/Bottom layout).
* **Translation Batch Size:** Number of subtitle segments to translate in each batch.
* **Translation Delay (ms):** Delay between translation requests.

## Permissions

This extension requires the following permissions:

* `storage`: To save user settings.
* `scripting`: To inject scripts into Disney+ pages.
* `activeTab`: To interact with the currently active Disney+ tab.
* Host permissions for `*://*.disneyplus.com/*` (to operate on Disney+ pages) and `https://translate.googleapis.com/*` (for translations).

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)**.

Shield: [![CC BY-NC-SA 4.0][cc-by-nc-sa-shield]][cc-by-nc-sa]

This work is licensed under a
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License][cc-by-nc-sa].

[![CC BY-NC-SA 4.0][cc-by-nc-sa-image]][cc-by-nc-sa]

[cc-by-nc-sa]: http://creativecommons.org/licenses/by-nc-sa/4.0/

[cc-by-nc-sa-image]: https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png

[cc-by-nc-sa-shield]: https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg

---

*Disclaimer: This extension is not officially affiliated with Disney+.*

## Adding New Translation Providers

This extension is designed to support multiple translation service providers. If you want to add a new translation provider, please follow these steps:

1.  **Understand the Interface**: Familiarize yourself with the required structure for a translation provider module by reading the interface definition located in `translation_providers/README.md`.
2.  **Implement Your Provider**:
    *   Create a new JavaScript file for your provider within the `translation_providers/` directory (e.g., `myNewProvider.js`).
    *   You can use `translation_providers/deeplTranslate_example.js` as a starting template for your implementation.
    *   Ensure your module exports an `async function translate(text, sourceLang, targetLang)` that adheres to the defined interface.
3.  **Register Your Provider**:
    *   In `background.js`, import your new provider module and add it to the `translationProviders` object. This object maps a unique provider ID (e.g., 'myNewProvider') to its display name and `translate` function.
    *   In `popup/popup.js`, add your new provider's ID and display name to the `availableProviders` object. This will make it visible in the extension's settings popup.
4.  **Test Thoroughly**: Ensure your new provider works correctly and handles errors gracefully.

By following these guidelines, you can extend the translation capabilities of this extension.
