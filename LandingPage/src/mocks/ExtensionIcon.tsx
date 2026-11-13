/** The extension's own line icons (src/ui/design/Icon.tsx), so the mocks of
 *  its pages draw the same glyphs it does. */
const PATHS = {
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    chevron: ['M9 6l6 6-6 6'],
    down: ['M12 5v14M6 13l6 6 6-6'],
    earlier: ['M19 12H5M11 6l-6 6 6 6'],
    explain: [
        'M9 18h6M10 21h4',
        'M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.2.9 2.2h5.4c0-1 .3-1.7.9-2.2A6 6 0 0 0 12 3z',
    ],
    globe: [
        'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
        'M3 12h18M12 3c2.8 3.2 2.8 14.8 0 18M12 3c-2.8 3.2-2.8 14.8 0 18',
    ],
    help: [
        'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
        'M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.7M12 17h.01',
    ],
    home: ['M3 11l9-7 9 7', 'M5 10v10h14V10'],
    languages: ['M4 5h11v8H8l-4 3z', 'M15 9h5v8l-3-2h-6v-2'],
    later: ['M5 12h14M13 6l6 6-6 6'],
    look: ['M3 5h18v14H3z', 'M7 13h10M9 16h6'],
    search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-3.5-3.5'],
    settings: [
        'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
        'M10.4 4.6L10.6 1.9A10.2 10.2 0 0 1 13.4 1.9L13.6 4.6A7.6 7.6 0 0 1 16.1 5.6L18.1 3.9A10.2 10.2 0 0 1 20.1 5.9L18.4 7.9A7.6 7.6 0 0 1 19.4 10.4L22.1 10.6A10.2 10.2 0 0 1 22.1 13.4L19.4 13.6A7.6 7.6 0 0 1 18.4 16.1L20.1 18.1A10.2 10.2 0 0 1 18.1 20.1L16.1 18.4A7.6 7.6 0 0 1 13.6 19.4L13.4 22.1A10.2 10.2 0 0 1 10.6 22.1L10.4 19.4A7.6 7.6 0 0 1 7.9 18.4L5.9 20.1A10.2 10.2 0 0 1 3.9 18.1L5.6 16.1A7.6 7.6 0 0 1 4.6 13.6L1.9 13.4A10.2 10.2 0 0 1 1.9 10.6L4.6 10.4A7.6 7.6 0 0 1 5.6 7.9L3.9 5.9A10.2 10.2 0 0 1 5.9 3.9L7.9 5.6A7.6 7.6 0 0 1 10.4 4.6z',
    ],
    sites: ['M3 4h18v16H3z', 'M3 9h18'],
    timing: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7v5l3 2'],
    translation: ['M4 7h12l-3-3', 'M20 17H8l3 3'],
    up: ['M12 19V5M6 11l6-6 6 6'],
} as const;

export type ExtensionIconName = keyof typeof PATHS;

export function ExtensionIcon({ name }: { name: ExtensionIconName }) {
    return (
        <svg
            className="extension-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {PATHS[name].map((d) => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}
