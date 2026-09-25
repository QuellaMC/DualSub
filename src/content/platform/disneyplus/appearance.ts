import { TRANSLATION_COLOR, type SubtitleLook } from '../../renderer/looks';

// Disney+'s player draws subtitles from the profile's appearance settings
// through the fixed tables below, taken from the hive playback-session
// bundle (26.11). Reproducing them here lets the overlay match the
// platform's own typography without a native cue on screen. Size is not
// copied: the player sizes one line, and DualSub draws two.

const EDGES: Readonly<Record<string, { shadow: string; stroke: string }>> = {
    none: { shadow: 'none', stroke: '' },
    raised: { shadow: '2px 2px 0 rgba(0,0,0,.5)', stroke: '' },
    depressed: { shadow: '1px 1px 0 rgba(0,0,0,.88)', stroke: '' },
    uniform: { shadow: 'none', stroke: '1.5px #000' },
    shadow: { shadow: '2px 2px 2px rgba(0,0,0,.5)', stroke: '' },
    outline: { shadow: 'none', stroke: '2px #000' },
};

interface FontRule {
    readonly family: string;
    readonly variant: string;
}

const BASE_FONTS: Readonly<Record<string, FontRule>> = {
    default: { family: 'sans-serif', variant: 'normal' },
    'monospace-serif': { family: 'Courier New, serif', variant: 'normal' },
    'proportional-serif': {
        family: 'Times New Roman, serif',
        variant: 'normal',
    },
    'monospace-sans-serif': {
        family: 'Console, sans-serif',
        variant: 'normal',
    },
    'proportional-sans-serif': {
        family: 'Arial, sans-serif',
        variant: 'normal',
    },
    casual: { family: 'Comic Sans MS', variant: 'normal' },
    script: { family: 'Apple Chancery', variant: 'normal' },
    'small-caps': { family: 'Arial, sans-serif', variant: 'small-caps' },
    japanese: { family: 'sans-serif', variant: 'normal' },
    korean: { family: 'sans-serif', variant: 'normal' },
    'simplified-chinese': { family: 'sans-serif', variant: 'normal' },
    'traditional-chinese': { family: 'sans-serif', variant: 'normal' },
};

/** Script keys the player picks by the line's language, over the font
 *  setting. Normalized language codes. */
const SCRIPT_LANGUAGES: Readonly<Record<string, string>> = {
    japanese: 'ja',
    korean: 'ko',
    'simplified-chinese': 'zh-CN',
    'traditional-chinese': 'zh-TW',
    arabic: 'ar',
    hebrew: 'he',
    greek: 'el',
    thai: 'th',
    vietnamese: 'vi',
};

/** The settings a look is built from; a payload with none is not one. */
const APPEARANCE_KEYS = [
    'textColor',
    'backgroundColor',
    'font',
    'textEdge',
    'fontMappingOverride',
];

const CSS_COLOR_PATTERN =
    /^(#[0-9a-f]{3,8}|rgba?\(\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*(,\s*\d*\.?\d+\s*)?\))$/i;

/** A fresh profile's settings, as the player reports them. */
export const DISNEY_DEFAULT_APPEARANCE: Record<string, unknown> = {
    font: 'default',
    textEdge: 'none',
    textColor: 'rgba(255,255,255,1)',
    backgroundColor: 'rgba(0,0,0,0)',
    fontMappingOverride: {},
};

function cssColor(value: unknown): string | null {
    return typeof value === 'string' && CSS_COLOR_PATTERN.test(value.trim())
        ? value.trim()
        : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/** The viewer's per-script font overrides merged over the base table. */
function fontRules(override: unknown): Record<string, FontRule> {
    const rules: Record<string, FontRule> = { ...BASE_FONTS };
    if (override === null || typeof override !== 'object') {
        return rules;
    }
    for (const [key, entry] of Object.entries(override)) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }
        const family = readString(
            (entry as Record<string, unknown>)['font-family']
        );
        if (!family) {
            continue;
        }
        rules[key] = {
            family,
            variant:
                readString(
                    (entry as Record<string, unknown>)['font-variant']
                ) ??
                rules[key]?.variant ??
                'normal',
        };
    }
    return rules;
}

/** The look Disney+'s player would draw from these settings, or null when
 *  the payload is not the appearance shape the player reports. */
export function parseDisneyLook(
    appearance: Record<string, unknown>
): SubtitleLook | null {
    if (!APPEARANCE_KEYS.some((key) => key in appearance)) {
        return null;
    }
    const rules = fontRules(appearance.fontMappingOverride);
    const font =
        rules[readString(appearance.font) ?? 'default'] ?? rules.default!;
    const edge =
        EDGES[readString(appearance.textEdge) ?? 'none'] ?? EDGES.none!;

    const languageOverrides: Record<string, { fontFamily: string }> = {};
    for (const [script, language] of Object.entries(SCRIPT_LANGUAGES)) {
        const rule = rules[script];
        if (rule) {
            languageOverrides[language] = { fontFamily: rule.family };
        }
    }

    return {
        fontFamily: font.family,
        fontWeight: 'normal',
        fontVariant: font.variant,
        originalColor: cssColor(appearance.textColor) ?? '#ffffff',
        translatedColor: TRANSLATION_COLOR,
        textShadow: edge.shadow,
        textStroke: edge.stroke,
        background: cssColor(appearance.backgroundColor) ?? 'transparent',
        padding: '0.5rem',
        borderRadius: '0.5em',
        languageOverrides,
    };
}

export const DISNEY_LOOK: SubtitleLook = parseDisneyLook(
    DISNEY_DEFAULT_APPEARANCE
)!;
