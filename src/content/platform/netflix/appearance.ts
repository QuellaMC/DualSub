import { TRANSLATION_COLOR, type SubtitleLook } from '../../renderer/looks';

// Netflix's player draws subtitles from the profile's appearance settings
// (defaults plus non-null overrides) through the fixed tables below, taken
// from cadmium-playercore 6.0062. Reproducing them here lets the overlay
// match the platform's own rendering without a native cue on screen.

/** Medium text is one nineteenth of the picture height. */
const BASE_SIZE_RATIO = 0.05263157894736842;

const CHARACTER_SIZE_SCALE: Readonly<Record<string, number>> = {
    SMALL: 0.5,
    'SMALL-MEDIUM': 0.8,
    MEDIUM: 1,
    'MEDIUM-LARGE': 1.3,
    LARGE: 2,
};

/** Monospaced styles are drawn larger at small and medium sizes only. */
const MONOSPACE_SIZE_SCALE: Readonly<Record<string, number>> = {
    MONOSPACED_SANS_SERIF: 1.37,
    MONOSPACED_SERIF: 1.15,
};
const MONOSPACE_SCALED_SIZES = new Set(['SMALL', 'MEDIUM']);

const OPACITY: Readonly<Record<string, number>> = {
    NONE: 0,
    SEMI_TRANSPARENT: 0.5,
    OPAQUE: 1,
};

const COLOR_HEX: Readonly<Record<string, string>> = {
    black: '#000000',
    silver: '#c0c0c0',
    gray: '#808080',
    white: '#ffffff',
    maroon: '#800000',
    red: '#ff0000',
    purple: '#800080',
    fuchsia: '#ff00ff',
    magenta: '#ff00ff',
    green: '#00ff00',
    lime: '#00ff00',
    olive: '#808000',
    yellow: '#ffff00',
    navy: '#000080',
    blue: '#0000ff',
    teal: '#008080',
    aqua: '#00ffff',
    cyan: '#00ffff',
    orange: '#ffa500',
    pink: '#ffc0cb',
};

/** Languages whose medium text the player enlarges by 1.4, and small by 1.6
 *  (small also covers Korean). Normalized codes. */
const INCREASED_MEDIUM_LANGUAGES = [
    'ro',
    'zh-CN',
    'zh-TW',
    'vi',
    'ar',
    'he',
    'hi',
    'th',
    'ta',
    'te',
];
const INCREASED_SMALL_LANGUAGES = [...INCREASED_MEDIUM_LANGUAGES, 'ko'];
const LESS_BOLD_LANGUAGES = ['th', 'ta'];

const DEFAULT_FONT_DECLARATIONS =
    'font-family:Netflix Sans,Helvetica Nueue,Helvetica,Arial,sans-serif;font-weight:bolder';
const DEFAULT_STYLE = 'PROPORTIONAL_SANS_SERIF';

/** A fresh profile's settings, as the page reports them. */
export const NETFLIX_DEFAULT_APPEARANCE: Record<string, unknown> = {
    defaults: {
        characterSize: 'MEDIUM',
        characterStyle: DEFAULT_STYLE,
        characterColor: 'WHITE',
        characterOpacity: 'OPAQUE',
        characterEdgeAttributes: 'DROP_SHADOW',
        characterEdgeColor: 'BLACK',
        backgroundColor: null,
        backgroundOpacity: 'OPAQUE',
        windowColor: null,
        windowOpacity: 'OPAQUE',
    },
    overrides: {},
    fontFamilyMapping: {},
};

type Strings = Record<string, string | null>;

function readStrings(value: unknown): Strings | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const out: Strings = {};
    for (const [key, entry] of Object.entries(
        value as Record<string, unknown>
    )) {
        if (entry === null || typeof entry === 'string') {
            out[key] = entry;
        }
    }
    return out;
}

function toHex(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    if (/^#[0-9a-f]{6}$/i.test(value)) {
        return value.toLowerCase();
    }
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        const [r, g, b] = value.slice(1).toLowerCase().split('');
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return COLOR_HEX[value.toLowerCase()] ?? null;
}

function withOpacity(hex: string, opacity: number): string {
    if (opacity >= 1) {
        return hex;
    }
    const value = Number.parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function edgeShadow(edge: string | null | undefined, color: string): string {
    switch (edge) {
        case 'DROP_SHADOW':
            return `${color} 0px 0px 7px`;
        case 'UNIFORM':
            return `-1px 0px ${color}, 0px 1px ${color}, 1px 0px ${color}, 0px -1px ${color}`;
        case 'RAISED':
            return '-1px -1px white, 0px -1px white, -1px 0px white, 1px 1px black, 0px 1px black, 1px 0px black';
        case 'DEPRESED':
        case 'DEPRESSED':
            return '1px 1px white, 0px 1px white, 1px 0px white, -1px -1px black, 0px -1px black, -1px 0px black';
        default:
            return 'none';
    }
}

/** The font mapping is a CSS declaration list per character style. */
function parseFontDeclarations(declarations: string): {
    fontFamily: string;
    fontWeight: string;
    fontVariant: string;
} {
    const font = {
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        fontVariant: 'normal',
    };
    for (const declaration of declarations.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator < 0) {
            continue;
        }
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        if (property === 'font-family' && value) {
            font.fontFamily = value;
        } else if (property === 'font-weight' && value) {
            font.fontWeight = value === 'bolder' ? 'bold' : value;
        } else if (property === 'font-variant' && value) {
            font.fontVariant = value;
        }
    }
    return font;
}

function languageOverrides(size: string): SubtitleLook['languageOverrides'] {
    const overrides: Record<
        string,
        { sizeScale?: number; fontWeight?: string }
    > = {};
    const enlarged =
        size === 'MEDIUM'
            ? { languages: INCREASED_MEDIUM_LANGUAGES, scale: 1.4 }
            : size === 'SMALL'
              ? { languages: INCREASED_SMALL_LANGUAGES, scale: 1.6 }
              : null;
    if (enlarged) {
        for (const language of enlarged.languages) {
            overrides[language] = { sizeScale: enlarged.scale };
        }
    }
    for (const language of LESS_BOLD_LANGUAGES) {
        overrides[language] = { ...overrides[language], fontWeight: 'normal' };
    }
    return overrides;
}

/** The look Netflix's player would draw from these settings, or null when
 *  the payload is not the appearance shape the page reports. */
export function parseNetflixLook(
    appearance: Record<string, unknown>
): SubtitleLook | null {
    const defaults = readStrings(appearance.defaults);
    if (!defaults) {
        return null;
    }
    const overrides = readStrings(appearance.overrides) ?? {};
    const fontFamilyMapping = readStrings(appearance.fontFamilyMapping) ?? {};
    const setting = (key: string): string | null =>
        overrides[key] ?? defaults[key] ?? null;

    const size = setting('characterSize') ?? 'MEDIUM';
    const style = setting('characterStyle') ?? DEFAULT_STYLE;
    const monospaceScale = MONOSPACE_SCALED_SIZES.has(size)
        ? (MONOSPACE_SIZE_SCALE[style] ?? 1)
        : 1;
    const font = parseFontDeclarations(
        fontFamilyMapping[style] ??
            fontFamilyMapping[DEFAULT_STYLE] ??
            DEFAULT_FONT_DECLARATIONS
    );
    const textColor = toHex(setting('characterColor')) ?? '#ffffff';
    const textOpacity = OPACITY[setting('characterOpacity') ?? 'OPAQUE'] ?? 1;
    const backgroundHex = toHex(setting('backgroundColor'));
    const backgroundOpacity =
        OPACITY[setting('backgroundOpacity') ?? 'OPAQUE'] ?? 1;

    return {
        ...font,
        originalColor: withOpacity(textColor, textOpacity),
        translatedColor: TRANSLATION_COLOR,
        textShadow: edgeShadow(
            setting('characterEdgeAttributes'),
            toHex(setting('characterEdgeColor')) ?? '#000000'
        ),
        textStroke: '',
        background:
            backgroundHex && backgroundOpacity > 0
                ? withOpacity(backgroundHex, backgroundOpacity)
                : 'transparent',
        padding: '0',
        borderRadius: '0',
        sizeRatio:
            BASE_SIZE_RATIO *
            (CHARACTER_SIZE_SCALE[size] ?? 1) *
            monospaceScale,
        languageOverrides: languageOverrides(size),
    };
}

export const NETFLIX_LOOK: SubtitleLook = parseNetflixLook(
    NETFLIX_DEFAULT_APPEARANCE
)!;
