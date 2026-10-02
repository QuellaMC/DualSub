import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { SaveSettings, SectionProps } from '../types';

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
 *  per pause keeps the look within the sync storage write quota. */
const SAVE_DELAY_MS = 400;

function isFont(value: string): value is CustomLook['font'] {
    return (CUSTOM_LOOK_FONTS as readonly string[]).includes(value);
}

function isEdge(value: string): value is CustomLook['edge'] {
    return (CUSTOM_LOOK_EDGES as readonly string[]).includes(value);
}

/**
 * The custom look being edited. Edits show at once and are written after a
 * pause, or when the editor goes away; a value arriving from storage
 * (another window, a synced device) is adopted unless an edit is pending.
 */
function useLookDraft(
    saved: CustomLook,
    save: SaveSettings
): [CustomLook, (changes: Partial<CustomLook>) => void] {
    const [draft, setDraft] = useState(saved);
    const pending = useRef(false);
    const latest = useRef({ draft, save });

    useEffect(() => {
        latest.current = { draft, save };
    });

    useEffect(() => {
        if (!pending.current) {
            setDraft(saved);
        }
    }, [saved]);

    useEffect(() => {
        if (!pending.current) {
            return;
        }
        const timer = setTimeout(() => {
            pending.current = false;
            void save({ subtitleCustomLook: draft });
        }, SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft, save]);

    useEffect(
        () => () => {
            if (pending.current) {
                pending.current = false;
                void latest.current.save({
                    subtitleCustomLook: latest.current.draft,
                });
            }
        },
        []
    );

    const edit = (changes: Partial<CustomLook>): void => {
        pending.current = true;
        setDraft((current) => ({ ...current, ...changes }));
    };
    return [draft, edit];
}

export function AppearanceSection({ t, settings, save }: SectionProps) {
    const [previewPlatform, setPreviewPlatform] =
        useState<PlatformId>('netflix');
    const [draft, editDraft] = useLookDraft(settings.subtitleCustomLook, save);
    const style = settings.subtitleStyle;

    const display = useMemo<DisplaySettings>(
        () => ({
            style,
            customLook: customLook(draft),
            fontScale: settings.subtitleFontScale,
            gap: settings.subtitleGap,
            verticalPosition: settings.subtitleVerticalPosition,
            orientation: settings.subtitleLayoutOrientation,
            order: settings.subtitleLayoutOrder,
            timeOffset: 0,
        }),
        [
            style,
            draft,
            settings.subtitleFontScale,
            settings.subtitleGap,
            settings.subtitleVerticalPosition,
            settings.subtitleLayoutOrientation,
            settings.subtitleLayoutOrder,
        ]
    );
    const look = resolveLook(display, PLATFORM_PRESETS[previewPlatform], null);

    /** Touching the editor selects the custom style, so the change shows. */
    const edit = (changes: Partial<CustomLook>): void => {
        editDraft(changes);
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
                    look={look}
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
                        value={draft.font}
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
                        checked={draft.bold}
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
                        value={draft.originalColor}
                        onChange={(event) =>
                            edit({ originalColor: event.target.value })
                        }
                    />
                </div>
                <div className="setting">
                    <label htmlFor="customTranslatedColor">
                        {t('customTranslatedColorLabel')}
                    </label>
                    <input
                        type="color"
                        id="customTranslatedColor"
                        value={draft.translatedColor}
                        onChange={(event) =>
                            edit({ translatedColor: event.target.value })
                        }
                    />
                </div>
                <div className="setting">
                    <label htmlFor="customEdge">{t('customEdgeLabel')}</label>
                    <select
                        id="customEdge"
                        value={draft.edge}
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
                        value={draft.backgroundColor}
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
                            value={draft.backgroundOpacity}
                            onChange={(event) =>
                                edit({
                                    backgroundOpacity: Number(
                                        event.target.value
                                    ),
                                })
                            }
                        />
                        <span className="range-value">
                            {Math.round(draft.backgroundOpacity * 100)}%
                        </span>
                    </div>
                </div>
            </SettingCard>
        </section>
    );
}
