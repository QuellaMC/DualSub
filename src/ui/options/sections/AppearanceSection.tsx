import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CUSTOM_LOOK_EDGES,
    CUSTOM_LOOK_FONTS,
    type CustomLook,
} from '@/config/schema';
import type { PlatformId } from '@/content/platform/types';
import { customLook, resolveLook } from '@/content/renderer/looks';
import type { DisplaySettings } from '@/content/renderer/styling';
import {
    isPlatformId,
    isSubtitleStyle,
    PLATFORM_NAMES,
    PLATFORM_PRESETS,
    SUBTITLE_STYLE_LABELS,
} from '../../subtitleStyle';
import { LookPreview } from '../LookPreview';
import { SettingCard } from '../SettingCard';
import { ToggleSwitch } from '../ToggleSwitch';
import type { SectionProps } from '../types';

const FONT_LABELS: Record<CustomLook['font'], string> = {
    default: 'customFontDefault',
    'sans-serif': 'customFontSansSerif',
    serif: 'customFontSerif',
    monospace: 'customFontMonospace',
    casual: 'customFontCasual',
    'small-caps': 'customFontSmallCaps',
};

const EDGE_LABELS: Record<CustomLook['edge'], string> = {
    none: 'customEdgeNone',
    shadow: 'customEdgeShadow',
    outline: 'customEdgeOutline',
    raised: 'customEdgeRaised',
    depressed: 'customEdgeDepressed',
};

/** Color pickers and the opacity slider report every movement; one write
 *  per pause keeps a drag within the sync storage write quota. */
const SAVE_DELAY_MS = 400;

function isFont(value: string): value is CustomLook['font'] {
    return (CUSTOM_LOOK_FONTS as readonly string[]).includes(value);
}

function isEdge(value: string): value is CustomLook['edge'] {
    return (CUSTOM_LOOK_EDGES as readonly string[]).includes(value);
}

/**
 * A setting edited with a continuous control. Edits show at once and are
 * written after a pause, or when the editor goes away; a write that fails
 * snaps the draft back to the stored value unless a newer edit is pending.
 * A value arriving from storage (another window, a synced device) is
 * adopted unless an edit is pending.
 */
function useDraft<T>(
    saved: T,
    write: (value: T) => Promise<boolean>
): [T, (value: T) => void] {
    const [draft, setDraft] = useState(saved);
    /** The draft holds an edit storage has not seen yet. */
    const pending = useRef(false);
    const latest = useRef({ draft, write, saved });

    useEffect(() => {
        latest.current = { draft, write, saved };
    });

    useEffect(() => {
        if (!pending.current) {
            setDraft(saved);
        }
    }, [saved]);

    const commit = useCallback((): void => {
        if (!pending.current) {
            return;
        }
        pending.current = false;
        void latest.current.write(latest.current.draft).then((persisted) => {
            if (!persisted && !pending.current) {
                setDraft(latest.current.saved);
            }
        });
    }, []);

    useEffect(() => {
        if (!pending.current) {
            return;
        }
        const timer = setTimeout(commit, SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft, commit]);

    // Unmounting writes a pending edit.
    useEffect(() => commit, [commit]);

    const edit = (value: T): void => {
        pending.current = true;
        setDraft(value);
    };
    return [draft, edit];
}

export function AppearanceSection({ t, settings, save }: SectionProps) {
    const [previewPlatform, setPreviewPlatform] =
        useState<PlatformId>('netflix');
    const [look, editLook] = useDraft(settings.subtitleCustomLook, (value) =>
        save({ subtitleCustomLook: value })
    );
    const [translationColor, editTranslationColor] = useDraft(
        settings.subtitleTranslationColor,
        (value) => save({ subtitleTranslationColor: value })
    );
    const style = settings.subtitleStyle;

    const display = useMemo<DisplaySettings>(
        () => ({
            style,
            customLook: customLook(look),
            translationColor,
            fontScale: settings.subtitleFontScale,
            gap: settings.subtitleGap,
            verticalPosition: settings.subtitleVerticalPosition,
            orientation: settings.subtitleLayoutOrientation,
            order: settings.subtitleLayoutOrder,
            timeOffset: 0,
        }),
        [
            style,
            look,
            translationColor,
            settings.subtitleFontScale,
            settings.subtitleGap,
            settings.subtitleVerticalPosition,
            settings.subtitleLayoutOrientation,
            settings.subtitleLayoutOrder,
        ]
    );

    /** Touching the editor selects the custom style, so the change shows. */
    const edit = (changes: Partial<CustomLook>): void => {
        editLook({ ...look, ...changes });
        if (style !== 'custom') {
            void save({ subtitleStyle: 'custom' });
        }
    };

    return (
        <section id="appearance">
            <h2>{t('sectionAppearance')}</h2>

            <SettingCard
                title={t('cardSubtitleStyleTitle')}
                description={t('cardSubtitleStyleDesc')}
            >
                <div className="setting">
                    <label htmlFor="subtitleStyle">
                        {t('subtitleStyleLabel')}
                    </label>
                    <select
                        id="subtitleStyle"
                        value={style}
                        onChange={(event) => {
                            if (isSubtitleStyle(event.target.value)) {
                                void save({
                                    subtitleStyle: event.target.value,
                                });
                            }
                        }}
                    >
                        {Object.entries(SUBTITLE_STYLE_LABELS).map(
                            ([value, key]) => (
                                <option key={value} value={value}>
                                    {t(key)}
                                </option>
                            )
                        )}
                    </select>
                </div>
                <div className="setting">
                    <label htmlFor="subtitleTranslationColor">
                        {t('translationColorLabel')}
                    </label>
                    <input
                        type="color"
                        id="subtitleTranslationColor"
                        value={translationColor}
                        onChange={(event) =>
                            editTranslationColor(event.target.value)
                        }
                    />
                </div>
                <p className="setting-description">
                    {t('translationColorHelp')}
                </p>
                <div className="setting">
                    <label htmlFor="previewPlatform">
                        {t('previewPlatformLabel')}
                    </label>
                    <select
                        id="previewPlatform"
                        value={previewPlatform}
                        onChange={(event) => {
                            if (isPlatformId(event.target.value)) {
                                setPreviewPlatform(event.target.value);
                            }
                        }}
                    >
                        {Object.entries(PLATFORM_NAMES).map(([id, name]) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                </div>
                <LookPreview
                    display={display}
                    look={resolveLook(
                        display,
                        PLATFORM_PRESETS[previewPlatform],
                        null
                    )}
                    originalText={t('lookPreviewOriginal')}
                    translatedText={t('lookPreviewTranslation')}
                    label={t('lookPreviewLabel')}
                />
            </SettingCard>

            <SettingCard
                title={t('cardCustomLookTitle')}
                description={t('cardCustomLookDesc')}
            >
                <div className="setting">
                    <label htmlFor="customFont">{t('customFontLabel')}</label>
                    <select
                        id="customFont"
                        value={look.font}
                        onChange={(event) => {
                            if (isFont(event.target.value)) {
                                edit({ font: event.target.value });
                            }
                        }}
                    >
                        {CUSTOM_LOOK_FONTS.map((font) => (
                            <option key={font} value={font}>
                                {t(FONT_LABELS[font])}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="setting">
                    <label htmlFor="customBold">{t('customBoldLabel')}</label>
                    <ToggleSwitch
                        id="customBold"
                        checked={look.bold}
                        onChange={(bold) => edit({ bold })}
                    />
                </div>
                <div className="setting">
                    <label htmlFor="customOriginalColor">
                        {t('customOriginalColorLabel')}
                    </label>
                    <input
                        type="color"
                        id="customOriginalColor"
                        value={look.originalColor}
                        onChange={(event) =>
                            edit({ originalColor: event.target.value })
                        }
                    />
                </div>
                <div className="setting">
                    <label htmlFor="customEdge">{t('customEdgeLabel')}</label>
                    <select
                        id="customEdge"
                        value={look.edge}
                        onChange={(event) => {
                            if (isEdge(event.target.value)) {
                                edit({ edge: event.target.value });
                            }
                        }}
                    >
                        {CUSTOM_LOOK_EDGES.map((edge) => (
                            <option key={edge} value={edge}>
                                {t(EDGE_LABELS[edge])}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="setting">
                    <label htmlFor="customBackgroundColor">
                        {t('customBackgroundColorLabel')}
                    </label>
                    <input
                        type="color"
                        id="customBackgroundColor"
                        value={look.backgroundColor}
                        onChange={(event) =>
                            edit({ backgroundColor: event.target.value })
                        }
                    />
                </div>
                <div className="setting">
                    <label htmlFor="customBackgroundOpacity">
                        {t('customBackgroundOpacityLabel')}
                    </label>
                    <div className="range-control">
                        <input
                            type="range"
                            id="customBackgroundOpacity"
                            min={0}
                            max={1}
                            step={0.05}
                            value={look.backgroundOpacity}
                            onChange={(event) =>
                                edit({
                                    backgroundOpacity: Number(
                                        event.target.value
                                    ),
                                })
                            }
                        />
                        <span className="range-value">
                            {Math.round(look.backgroundOpacity * 100)}%
                        </span>
                    </div>
                </div>
            </SettingCard>
        </section>
    );
}
