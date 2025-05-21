// disneyplus-dualsub-chrome-extension/popup/popup.js
document.addEventListener('DOMContentLoaded', function () {
    // Element references
    const enableSubtitlesToggle = document.getElementById('enableSubtitles');
    const targetLanguageSelect = document.getElementById('targetLanguage');
    const subtitleTimeOffsetInput = document.getElementById('subtitleTimeOffset');
    const subtitleLayoutOrderSelect = document.getElementById('subtitleLayoutOrder');
    const subtitleLayoutOrientationSelect = document.getElementById('subtitleLayoutOrientation');
    const subtitleFontSizeInput = document.getElementById('subtitleFontSize');
    const subtitleFontSizeValue = document.getElementById('subtitleFontSizeValue');
    const subtitleGapInput = document.getElementById('subtitleGap');
    const subtitleGapValue = document.getElementById('subtitleGapValue');
    const translationBatchSizeInput = document.getElementById('translationBatchSize');
    const translationBatchSizeValue = document.getElementById('translationBatchSizeValue');
    const translationDelayInput = document.getElementById('translationDelay');
    const translationDelayValue = document.getElementById('translationDelayValue');
    const statusMessage = document.getElementById('statusMessage');

    // Default settings
    const defaultSettings = {
        subtitlesEnabled: true,
        targetLanguage: 'zh-CN',
        subtitleTimeOffset: 0.3,
        subtitleLayoutOrder: 'original_top',
        subtitleLayoutOrientation: 'column',
        subtitleFontSize: 1.1, // Default in vw
        subtitleGap: 0.3,      // Default in em
        translationBatchSize: 3,
        translationDelay: 150  // Default in ms
    };

    // Function to load settings from chrome.storage.sync
    function loadSettings() {
        chrome.storage.sync.get(Object.keys(defaultSettings), function (items) {
            enableSubtitlesToggle.checked = items.subtitlesEnabled !== undefined ? items.subtitlesEnabled : defaultSettings.subtitlesEnabled;
            targetLanguageSelect.value = items.targetLanguage || defaultSettings.targetLanguage;
            subtitleTimeOffsetInput.value = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : defaultSettings.subtitleTimeOffset;
            subtitleLayoutOrderSelect.value = items.subtitleLayoutOrder || defaultSettings.subtitleLayoutOrder;
            subtitleLayoutOrientationSelect.value = items.subtitleLayoutOrientation || defaultSettings.subtitleLayoutOrientation;
            
            const fontSize = items.subtitleFontSize !== undefined ? items.subtitleFontSize : defaultSettings.subtitleFontSize;
            subtitleFontSizeInput.value = fontSize;
            subtitleFontSizeValue.textContent = `${parseFloat(fontSize).toFixed(1)}vw`;
            
            const gap = items.subtitleGap !== undefined ? items.subtitleGap : defaultSettings.subtitleGap;
            subtitleGapInput.value = gap;
            subtitleGapValue.textContent = `${parseFloat(gap).toFixed(1)}em`;
            
            const batchSize = items.translationBatchSize !== undefined ? items.translationBatchSize : defaultSettings.translationBatchSize;
            translationBatchSizeInput.value = batchSize;
            translationBatchSizeValue.textContent = batchSize;
            
            const delay = items.translationDelay !== undefined ? items.translationDelay : defaultSettings.translationDelay;
            translationDelayInput.value = delay;
            translationDelayValue.textContent = `${delay}ms`;
        });
    }

    // Function to display status messages
    function showStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.className = isError ? 'error' : 'success'; // Use classes for styling
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = ''; // Clear class
        }, 3000);
    }
    
    // Function to send messages to the content script
    function sendMessageToContentScript(action, value, settingKey) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                const messagePayload = { action: action };
                if (settingKey) { // Only add if settingKey is provided
                  messagePayload[settingKey] = value; 
                } else { // For actions like toggleSubtitles where the value might be the primary part
                  messagePayload.enabled = value; // Assuming 'enabled' for toggle, adjust if needed
                }


                chrome.tabs.sendMessage(tabs[0].id, messagePayload, function(response) {
                    if (chrome.runtime.lastError) {
                        console.warn(`Popup: Error sending ${action} message for ${settingKey || 'toggle'}:`, chrome.runtime.lastError.message);
                        // Avoid showing error to user if tab is not Disney+ or not ready
                        if (!chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                             showStatus(`Setting not applied. Refresh Disney+ tab.`, true);
                        }
                    } else if (response && response.success) {
                        console.log(`Popup: ${action} for ${settingKey || 'toggle'} sent. New value:`, value);
                    } else {
                         console.warn(`Popup: Content script did not respond successfully to ${action} for ${settingKey || 'toggle'}. Response:`, response);
                    }
                });
            } else {
                console.warn(`Popup: No active tab found to send ${action} message.`);
            }
        });
    }

    // Event Listeners for UI elements

    enableSubtitlesToggle.addEventListener('change', function () {
        const enabled = enableSubtitlesToggle.checked;
        chrome.storage.sync.set({ subtitlesEnabled: enabled }, () => {
            showStatus(`Dual subtitles ${enabled ? 'enabled' : 'disabled'}.`);
            sendMessageToContentScript("toggleSubtitles", enabled, "enabled"); // 'enabled' is the key content.js expects
        });
    });

    targetLanguageSelect.addEventListener('change', function () {
        const lang = targetLanguageSelect.value;
        chrome.storage.sync.set({ targetLanguage: lang }, () => {
            showStatus(`Target language: ${targetLanguageSelect.options[targetLanguageSelect.selectedIndex].text}.`);
            sendMessageToContentScript("changeLanguage", lang, "targetLanguage");
        });
    });

    subtitleTimeOffsetInput.addEventListener('change', function() {
        let offset = parseFloat(subtitleTimeOffsetInput.value);
        if (isNaN(offset)) {
            showStatus('Invalid time offset. Reverting.', true);
            // Revert to stored or default value
            chrome.storage.sync.get('subtitleTimeOffset', (items) => {
                subtitleTimeOffsetInput.value = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : defaultSettings.subtitleTimeOffset;
            });
            return;
        }
        offset = parseFloat(offset.toFixed(2)); // Ensure two decimal places for consistency
        subtitleTimeOffsetInput.value = offset; // Update input field with potentially corrected value

        chrome.storage.sync.set({ subtitleTimeOffset: offset }, () => {
            showStatus(`Time offset: ${offset}s.`);
            sendMessageToContentScript("changeTimeOffset", offset, "timeOffset");
        });
    });

    subtitleLayoutOrderSelect.addEventListener('change', function() {
        const layoutOrder = subtitleLayoutOrderSelect.value;
        chrome.storage.sync.set({ subtitleLayoutOrder: layoutOrder }, () => {
            showStatus(`Display order updated.`);
            sendMessageToContentScript("changeLayoutOrder", layoutOrder, "layoutOrder");
        });
    });

    subtitleLayoutOrientationSelect.addEventListener('change', function() {
        const layoutOrientation = subtitleLayoutOrientationSelect.value;
        chrome.storage.sync.set({ subtitleLayoutOrientation: layoutOrientation }, () => {
            showStatus(`Layout orientation updated.`);
            sendMessageToContentScript("changeLayoutOrientation", layoutOrientation, "layoutOrientation");
        });
    });

    // Slider 'input' event listeners for live value display
    subtitleFontSizeInput.addEventListener('input', function() {
        subtitleFontSizeValue.textContent = `${parseFloat(this.value).toFixed(1)}vw`;
    });
    subtitleGapInput.addEventListener('input', function() {
        subtitleGapValue.textContent = `${parseFloat(this.value).toFixed(1)}em`;
    });
    translationBatchSizeInput.addEventListener('input', function() {
        translationBatchSizeValue.textContent = this.value;
    });
    translationDelayInput.addEventListener('input', function() {
        translationDelayValue.textContent = `${this.value}ms`;
    });

    // Slider 'change' event listeners to save and send data
    subtitleFontSizeInput.addEventListener('change', function() {
        const fontSize = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleFontSize: fontSize }, () => {
            showStatus(`Subtitle size: ${fontSize.toFixed(1)}vw.`);
            sendMessageToContentScript("changeFontSize", fontSize, "fontSize");
        });
    });

    subtitleGapInput.addEventListener('change', function() {
        const gap = parseFloat(this.value);
        chrome.storage.sync.set({ subtitleGap: gap }, () => {
            showStatus(`Subtitle gap: ${gap.toFixed(1)}em.`);
            sendMessageToContentScript("changeGap", gap, "gap");
        });
    });

    translationBatchSizeInput.addEventListener('change', function() {
        const batchSize = parseInt(this.value);
        chrome.storage.sync.set({ translationBatchSize: batchSize }, () => {
            showStatus(`Translation batch size: ${batchSize}.`);
            sendMessageToContentScript("changeBatchSize", batchSize, "batchSize");
        });
    });

    translationDelayInput.addEventListener('change', function() {
        const delay = parseInt(this.value);
        chrome.storage.sync.set({ translationDelay: delay }, () => {
            showStatus(`Translation delay: ${delay}ms.`);
            sendMessageToContentScript("changeDelay", delay, "delay");
        });
    });

    // Initial load of settings
    loadSettings();
});
