// Centralized injection-related constants for platform adapters and injected scripts

export const Injection = {
    netflix: {
        SCRIPT_FILENAME: 'injected_scripts/netflixInject.js',
        SCRIPT_TAG_ID: 'netflix-dualsub-injector-script-tag',
        EVENT_ID: 'netflix-dualsub-injector-event',
    },
    disneyplus: {
        SCRIPT_FILENAME: 'injected_scripts/disneyPlusInject.js',
        SCRIPT_TAG_ID: 'disneyplus-dualsub-injector-script-tag',
        EVENT_ID: 'disneyplus-dualsub-injector-event',
    },
    hulu: {
        SCRIPT_FILENAME: 'injected_scripts/huluInject.js',
        SCRIPT_TAG_ID: 'hulu-dualsub-injector-script-tag',
        EVENT_ID: 'hulu-dualsub-injector-event',
    },
};
