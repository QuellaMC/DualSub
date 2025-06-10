document.addEventListener('DOMContentLoaded', () => {
    const ui = {
        // General
        uiLanguage: document.getElementById('uiLanguage'),
        
        // Translation
        translationProvider: document.getElementById('translationProvider'),
        providerSpecificSettings: document.getElementById('provider-specific-settings'),
        targetLanguage: document.getElementById('targetLanguage'),

        // Advanced
        translationBatchSize: document.getElementById('translationBatchSize'),
        translationBatchSizeValue: document.getElementById('translationBatchSizeValue'),
        translationDelay: document.getElementById('translationDelay'),
        translationDelayValue: document.getElementById('translationDelayValue'),

        // About
        extensionVersion: document.getElementById('extension-version'),

        // Sidebar and sections
        sidebarLinks: document.querySelectorAll('.sidebar a'),
        sections: document.querySelectorAll('.settings-section')
    };

    const providers = {
        google: {
            name: 'Google Translate (Free)',
            settings: {}
        },
        microsoft: {
            name: 'Microsoft Translator (Free)',
            settings: {}
        },
        // Add other providers like DeepL here when they are fully implemented
    };

    function populateProviderOptions() {
        for (const key in providers) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = providers[key].name;
            ui.translationProvider.appendChild(option);
        }
    }

    function renderProviderSpecificSettings(provider, settings) {
        ui.providerSpecificSettings.innerHTML = '';
        const providerInfo = providers[provider];

        if (!providerInfo || Object.keys(providerInfo.settings).length === 0) {
            ui.providerSpecificSettings.style.display = 'none';
            return;
        }
        
        ui.providerSpecificSettings.style.display = 'block';
        let content = `<h3>${providerInfo.name} Settings</h3><div class="setting-input">`;
        
        for (const key in providerInfo.settings) {
            const setting = providerInfo.settings[key];
            content += `
                <label for="${key}">${setting.label}:</label>
                <input type="${setting.type}" id="${key}" placeholder="${setting.placeholder || ''}">
            `;
        }
        content += '</div>';
        ui.providerSpecificSettings.innerHTML = content;

        for (const key in providerInfo.settings) {
             const input = document.getElementById(key);
             if (settings[key]) {
                input.value = settings[key];
             }
             input.addEventListener('change', (e) => {
                saveSetting({ [key]: e.target.value });
             });
        }
    }

    function saveSetting(settings) {
        chrome.storage.sync.set(settings, () => {
            console.log('Settings saved', settings);
            // You might want to show a small "saved" notification here
        });
    }
    
    function loadSettings() {
        const defaultSettings = {
            uiLanguage: 'en',
            translationProvider: 'google',
            targetLanguage: 'zh-CN',
            translationBatchSize: 3,
            translationDelay: 150,
        };

        chrome.storage.sync.get(defaultSettings, (settings) => {
            // General
            ui.uiLanguage.value = settings.uiLanguage;

            // Translation
            ui.translationProvider.value = settings.translationProvider;
            ui.targetLanguage.value = settings.targetLanguage;
            renderProviderSpecificSettings(settings.translationProvider, settings);
            
            // Advanced
            ui.translationBatchSize.value = settings.translationBatchSize;
            ui.translationBatchSizeValue.textContent = settings.translationBatchSize;
            ui.translationDelay.value = settings.translationDelay;
            ui.translationDelayValue.textContent = `${settings.translationDelay}ms`;
        });
    }

    function setupEventListeners() {
        // General
        ui.uiLanguage.addEventListener('change', (e) => saveSetting({ uiLanguage: e.target.value }));
        
        // Translation
        ui.translationProvider.addEventListener('change', (e) => {
            const provider = e.target.value;
            saveSetting({ translationProvider: provider });
            chrome.storage.sync.get((settings) => {
                 renderProviderSpecificSettings(provider, settings);
            });
        });
        ui.targetLanguage.addEventListener('change', (e) => saveSetting({ targetLanguage: e.target.value }));

        // Advanced
        ui.translationBatchSize.addEventListener('input', (e) => {
            ui.translationBatchSizeValue.textContent = e.target.value;
        });
        ui.translationBatchSize.addEventListener('change', (e) => saveSetting({ translationBatchSize: parseInt(e.target.value, 10) }));

        ui.translationDelay.addEventListener('input', (e) => {
            ui.translationDelayValue.textContent = `${e.target.value}ms`;
        });
        ui.translationDelay.addEventListener('change', (e) => saveSetting({ translationDelay: parseInt(e.target.value, 10) }));
    
        // Sidebar navigation (Scroll Spy)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    ui.sidebarLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href').substring(1) === entry.target.id) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, { threshold: 0.5, rootMargin: "-100px 0px -50% 0px" });

        ui.sections.forEach(section => observer.observe(section));

        ui.sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href');
                document.querySelector(targetId).scrollIntoView({
                    behavior: 'smooth'
                });
            });
        });
    }

    function setVersion() {
        const manifest = chrome.runtime.getManifest();
        ui.extensionVersion.textContent = manifest.version;
    }

    // Initial setup
    populateProviderOptions();
    loadSettings();
    setupEventListeners();
    setVersion();
}); 