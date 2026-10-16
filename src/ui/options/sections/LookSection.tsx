import { useEffect, useState, type CSSProperties } from 'react';
import {
    CUSTOM_LOOK_EDGES,
    CUSTOM_LOOK_FONTS,
    getDefaultValue,
    SETTING_BOUNDS,
    sameSettingValue,
    type CustomLook,
} from '@/config/schema';
import { customLook } from '@/content/renderer/looks';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import { SizePicker } from '../controls/SizePicker';
import { SiteTag, useSiteDraft } from '../shell/scopeContext';
import type { OptionsSettings, SectionProps } from '../types';

const PRESETS: readonly { labelKey: string; look: CustomLook }[] = [
    {
        labelKey: 'lookPresetBoxed',
        look: getDefaultValue('subtitleCustomLook'),
    },
    {
        labelKey: 'lookPresetClassic',
        look: {
            font: 'default',
            bold: false,
            originalColor: '#ffffff',
            edge: 'shadow',
            backgroundColor: '#000000',
            backgroundOpacity: 0,
        },
    },
    {
        labelKey: 'lookPresetContrast',
        look: {
            font: 'sans-serif',
            bold: true,
            originalColor: '#ffe500',
            edge: 'outline',
            backgroundColor: '#000000',
            backgroundOpacity: 0.85,
        },
    },
    {
        labelKey: 'lookPresetCinema',
        look: {
            font: 'serif',
            bold: false,
            originalColor: '#fff8e7',
            edge: 'raised',
            backgroundColor: '#000000',
            backgroundOpacity: 0,
        },
    },
];

const FONT_LABELS: Record<CustomLook['font'], string> = {
    default: 'lookFontDefault',
    'sans-serif': 'lookFontSans',
    serif: 'lookFontSerif',
    monospace: 'lookFontMono',
    casual: 'lookFontCasual',
    'small-caps': 'lookFontSmallCaps',
};

const EDGE_LABELS: Record<CustomLook['edge'], string> = {
    none: 'lookEdgeNone',
    shadow: 'lookEdgeShadow',
    outline: 'lookEdgeOutline',
    raised: 'lookEdgeRaised',
    depressed: 'lookEdgeDepressed',
};

const TRANSLATION_COLORS = [
    { hex: '#00ffff', labelKey: 'lookColorCyan' },
    { hex: '#ffe45c', labelKey: 'lookColorYellow' },
    { hex: '#9bf59b', labelKey: 'lookColorGreen' },
    { hex: '#ffb3d9', labelKey: 'lookColorPink' },
    { hex: '#ffffff', labelKey: 'lookColorWhite' },
] as const;

/** Each move of the position buttons, on the 0.1–9.9 position scale. */
const POSITION_STEP = 0.7;
const POSITION_BOUNDS = { min: 0.1, max: 9.9 } as const;

function isFont(value: string): value is CustomLook['font'] {
    return (CUSTOM_LOOK_FONTS as readonly string[]).includes(value);
}

function isEdge(value: string): value is CustomLook['edge'] {
    return (CUSTOM_LOOK_EDGES as readonly string[]).includes(value);
}

/** The picture height the subtitles sit at, described in words. */
function positionKey(position: number): string {
    if (position < 1.4) {
        return 'lookPositionBottom';
    }
    if (position < 3.6) {
        return 'lookPositionUsual';
    }
    if (position < 6.3) {
        return 'lookPositionLower';
    }
    return 'lookPositionMiddle';
}

function presetStyle(look: CustomLook): CSSProperties {
    const drawn = customLook(look);
    return {
        fontFamily: drawn.fontFamily,
        fontWeight: drawn.fontWeight,
        fontVariant: drawn.fontVariant,
        color: drawn.originalColor,
        textShadow: drawn.textShadow,
        WebkitTextStroke: drawn.textStroke || undefined,
        background: drawn.background,
        padding: drawn.padding,
        borderRadius: drawn.borderRadius,
    };
}

function clampPosition(value: number): number {
    return (
        Math.round(
            Math.min(
                POSITION_BOUNDS.max,
                Math.max(POSITION_BOUNDS.min, value)
            ) * 10
        ) / 10
    );
}

/** Unsaved edits the preview shows while their write waits for a pause. */
export type LookDraft = Partial<
    Pick<
        OptionsSettings,
        | 'subtitleCustomLook'
        | 'subtitleTranslationColor'
        | 'subtitleFontScale'
        | 'subtitleVerticalPosition'
        | 'subtitleGap'
    >
>;

export function LookSection({
    t,
    settings,
    save,
    onDraft,
}: SectionProps & { onDraft: (draft: LookDraft) => void }) {
    const look = useSiteDraft(
        'subtitleCustomLook',
        settings.subtitleCustomLook,
        (value, notice) => save({ subtitleCustomLook: value }, notice)
    );
    const translationColor = useSiteDraft(
        'subtitleTranslationColor',
        settings.subtitleTranslationColor,
        (value, notice) => save({ subtitleTranslationColor: value }, notice)
    );
    const scale = useSiteDraft(
        'subtitleFontScale',
        settings.subtitleFontScale,
        (value, notice) => save({ subtitleFontScale: value }, notice)
    );
    const position = useSiteDraft(
        'subtitleVerticalPosition',
        settings.subtitleVerticalPosition,
        (value, notice) => save({ subtitleVerticalPosition: value }, notice)
    );
    const gap = useSiteDraft(
        'subtitleGap',
        settings.subtitleGap,
        (value, notice) => save({ subtitleGap: value }, notice)
    );
    useEffect(() => {
        onDraft({
            subtitleCustomLook: look.value,
            subtitleTranslationColor: translationColor.value,
            subtitleFontScale: scale.value,
            subtitleVerticalPosition: position.value,
            subtitleGap: gap.value,
        });
    }, [
        onDraft,
        look.value,
        translationColor.value,
        scale.value,
        position.value,
        gap.value,
    ]);
    useEffect(() => () => onDraft({}), [onDraft]);
    const [customizing, setCustomizing] = useState(false);
    const [fineTuning, setFineTuning] = useState(false);
    const custom = settings.subtitleStyle === 'custom';
    const topColor = custom ? look.value.originalColor : '#ffffff';
    const edit = (changes: Partial<CustomLook>): void => {
        look.edit({ ...look.value, ...changes });
    };

    return (
        <section className="section" aria-labelledby="look-title">
            <h1 id="look-title" tabIndex={-1}>
                {t('navLook')}
            </h1>
            <p className="lead">{t('lookLead')}</p>

            <div className="card" id="text-size">
                <div className="label" id="look-size">
                    {t('lookSizeTitle')}
                </div>
                <SiteTag keys={['subtitleFontScale']} />
                <SizePicker
                    t={t}
                    scale={scale.value}
                    labelledBy="look-size"
                    onPick={(value, label) =>
                        scale.set(value, { message: t('toastSize', label) })
                    }
                />
            </div>

            <div className="card" id="position">
                <div className="row">
                    <div className="grow">
                        <div className="label">{t('lookPositionTitle')}</div>
                        <div className="help">
                            {t(positionKey(position.value))}
                        </div>
                    </div>
                    <div className="inline">
                        <button
                            type="button"
                            className="button"
                            disabled={position.value >= POSITION_BOUNDS.max}
                            onClick={() =>
                                position.update(
                                    (current) =>
                                        clampPosition(current + POSITION_STEP),
                                    { message: t('toastMovedUp') }
                                )
                            }
                        >
                            <Icon name="up" />
                            {t('lookMoveUp')}
                        </button>
                        <button
                            type="button"
                            className="button"
                            disabled={position.value <= POSITION_BOUNDS.min}
                            onClick={() =>
                                position.update(
                                    (current) =>
                                        clampPosition(current - POSITION_STEP),
                                    { message: t('toastMovedDown') }
                                )
                            }
                        >
                            <Icon name="down" />
                            {t('lookMoveDown')}
                        </button>
                    </div>
                </div>
                <SiteTag keys={['subtitleVerticalPosition']} />
            </div>

            <div className="card" id="style">
                <div className="label" id="look-style">
                    {t('lookStyleTitle')}
                </div>
                <SiteTag keys={['subtitleStyle', 'subtitleCustomLook']} />
                <div
                    className="choices"
                    role="group"
                    aria-labelledby="look-style"
                >
                    <button
                        type="button"
                        className="choice"
                        aria-pressed={!custom}
                        onClick={() =>
                            void save(
                                { subtitleStyle: 'platform' },
                                { message: t('toastStylePlatform') }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('lookStylePlatform')}
                        </span>
                        <span className="help">
                            {t('lookStylePlatformHelp')}
                        </span>
                    </button>
                    <button
                        type="button"
                        id="look-style-custom"
                        className="choice"
                        aria-pressed={custom}
                        onClick={() =>
                            void save(
                                { subtitleStyle: 'custom' },
                                { message: t('toastStyleCustom') }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('lookStyleCustom')}
                        </span>
                        <span className="help">{t('lookStyleCustomHelp')}</span>
                    </button>
                </div>
                {custom && (
                    <>
                        <div
                            className="presets"
                            role="group"
                            aria-label={t('lookPresetsLabel')}
                        >
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.labelKey}
                                    type="button"
                                    className="preset"
                                    aria-pressed={sameSettingValue(
                                        look.value,
                                        preset.look
                                    )}
                                    onClick={() =>
                                        look.set(preset.look, {
                                            message: t(
                                                'toastPreset',
                                                t(preset.labelKey)
                                            ),
                                        })
                                    }
                                >
                                    <span className="preset-tile">
                                        <span style={presetStyle(preset.look)}>
                                            Aa
                                        </span>
                                    </span>
                                    <span>{t(preset.labelKey)}</span>
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            id="look-customize"
                            className="disclosure"
                            aria-expanded={customizing}
                            onClick={() => setCustomizing(!customizing)}
                        >
                            <Icon name="chevron" />
                            {t('lookCustomizeButton')}
                        </button>
                        {customizing && (
                            <div className="controls-grid">
                                <div className="control">
                                    <label htmlFor="look-font">
                                        {t('lookFontLabel')}
                                    </label>
                                    <select
                                        id="look-font"
                                        className="field wide"
                                        value={look.value.font}
                                        onChange={(event) => {
                                            if (isFont(event.target.value)) {
                                                edit({
                                                    font: event.target.value,
                                                });
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
                                <div className="control">
                                    <label htmlFor="look-edge">
                                        {t('lookEdgeLabel')}
                                    </label>
                                    <select
                                        id="look-edge"
                                        className="field wide"
                                        value={look.value.edge}
                                        onChange={(event) => {
                                            if (isEdge(event.target.value)) {
                                                edit({
                                                    edge: event.target.value,
                                                });
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
                                <div className="control">
                                    <span
                                        className="control-label"
                                        id="look-bold"
                                    >
                                        {t('lookBoldLabel')}
                                    </span>
                                    <Switch
                                        checked={look.value.bold}
                                        labelledBy="look-bold"
                                        onChange={(bold) => edit({ bold })}
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor="look-top-color">
                                        {t('lookTopColorLabel')}
                                    </label>
                                    <input
                                        id="look-top-color"
                                        type="color"
                                        className="color-field"
                                        value={look.value.originalColor}
                                        onChange={(event) =>
                                            edit({
                                                originalColor:
                                                    event.target.value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor="look-box-color">
                                        {t('lookBoxColorLabel')}
                                    </label>
                                    <input
                                        id="look-box-color"
                                        type="color"
                                        className="color-field"
                                        value={look.value.backgroundColor}
                                        onChange={(event) =>
                                            edit({
                                                backgroundColor:
                                                    event.target.value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor="look-box-opacity">
                                        {t(
                                            'lookBoxOpacityLabel',
                                            Math.round(
                                                look.value.backgroundOpacity *
                                                    100
                                            )
                                        )}
                                    </label>
                                    <input
                                        id="look-box-opacity"
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={look.value.backgroundOpacity}
                                        onChange={(event) =>
                                            edit({
                                                backgroundOpacity: Number(
                                                    event.target.value
                                                ),
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="card" id="translation-color">
                <div className="label" id="look-translation-color">
                    {t('lookTranslationColorTitle')}
                </div>
                <div className="help">{t('lookTranslationColorHelp')}</div>
                <SiteTag keys={['subtitleTranslationColor']} />
                <div
                    className="swatches"
                    role="group"
                    aria-labelledby="look-translation-color"
                >
                    {TRANSLATION_COLORS.map((color) => (
                        <button
                            key={color.hex}
                            type="button"
                            className="swatch"
                            style={{ background: color.hex }}
                            aria-label={t(color.labelKey)}
                            aria-pressed={
                                translationColor.value.toLowerCase() ===
                                color.hex
                            }
                            onClick={() =>
                                translationColor.set(color.hex, {
                                    message: t(
                                        'toastTranslationColor',
                                        t(color.labelKey)
                                    ),
                                })
                            }
                        />
                    ))}
                    <label className="inline color-other">
                        <input
                            type="color"
                            className="color-field"
                            value={translationColor.value}
                            onChange={(event) =>
                                translationColor.edit(event.target.value)
                            }
                        />
                        <span>{t('lookColorOther')}</span>
                    </label>
                </div>
            </div>

            <div className="card" id="layout">
                <div className="label" id="look-order">
                    {t('lookOrderTitle')}
                </div>
                <SiteTag keys={['subtitleLayoutOrder']} />
                <div
                    className="choices"
                    role="group"
                    aria-labelledby="look-order"
                >
                    {(
                        [
                            ['original_top', 'lookOrderVideoFirst'],
                            ['translation_top', 'lookOrderMineFirst'],
                        ] as const
                    ).map(([order, labelKey]) => {
                        const [first, second] =
                            order === 'original_top'
                                ? [topColor, translationColor.value]
                                : [translationColor.value, topColor];
                        return (
                            <button
                                key={order}
                                type="button"
                                className="choice"
                                aria-pressed={
                                    settings.subtitleLayoutOrder === order
                                }
                                onClick={() =>
                                    void save(
                                        { subtitleLayoutOrder: order },
                                        { message: t(labelKey) }
                                    )
                                }
                            >
                                <span
                                    className="mini stacked"
                                    aria-hidden="true"
                                >
                                    <span
                                        className="bar long"
                                        style={{ background: first }}
                                    />
                                    <span
                                        className="bar"
                                        style={{ background: second }}
                                    />
                                </span>
                                <span className="choice-title">
                                    {t(labelKey)}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="label" id="look-arrangement">
                    {t('lookArrangementTitle')}
                </div>
                <SiteTag keys={['subtitleLayoutOrientation']} />
                <div
                    className="choices"
                    role="group"
                    aria-labelledby="look-arrangement"
                >
                    {(
                        [
                            ['column', 'lookArrangementStacked'],
                            ['row', 'lookArrangementSideBySide'],
                        ] as const
                    ).map(([orientation, labelKey]) => (
                        <button
                            key={orientation}
                            type="button"
                            className="choice"
                            aria-pressed={
                                settings.subtitleLayoutOrientation ===
                                orientation
                            }
                            onClick={() =>
                                void save(
                                    { subtitleLayoutOrientation: orientation },
                                    { message: t(labelKey) }
                                )
                            }
                        >
                            <span
                                className={`mini ${orientation === 'column' ? 'stacked' : 'side'}`}
                                aria-hidden="true"
                            >
                                <span
                                    className="bar"
                                    style={{ background: topColor }}
                                />
                                <span
                                    className="bar"
                                    style={{
                                        background: translationColor.value,
                                    }}
                                />
                            </span>
                            <span className="choice-title">{t(labelKey)}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="stack" id="fine-tune">
                <button
                    type="button"
                    className="disclosure"
                    aria-expanded={fineTuning}
                    onClick={() => setFineTuning(!fineTuning)}
                >
                    <Icon name="chevron" />
                    {t('lookFineTuneButton')}
                </button>
                {fineTuning && (
                    <div className="card">
                        <div className="control">
                            <label htmlFor="look-exact-size">
                                {t(
                                    'lookExactSize',
                                    Math.round(scale.value * 100) / 100
                                )}
                            </label>
                            <input
                                id="look-exact-size"
                                type="range"
                                min={SETTING_BOUNDS.subtitleFontScale.min}
                                max={SETTING_BOUNDS.subtitleFontScale.max}
                                step={0.05}
                                value={scale.value}
                                onChange={(event) =>
                                    scale.edit(Number(event.target.value))
                                }
                            />
                            <SiteTag keys={['subtitleFontScale']} />
                        </div>
                        <div className="control">
                            <label htmlFor="look-exact-position">
                                {t(
                                    'lookExactPosition',
                                    position.value.toFixed(1)
                                )}
                            </label>
                            <input
                                id="look-exact-position"
                                type="range"
                                min={POSITION_BOUNDS.min}
                                max={POSITION_BOUNDS.max}
                                step={0.1}
                                value={position.value}
                                onChange={(event) =>
                                    position.edit(Number(event.target.value))
                                }
                            />
                            <SiteTag keys={['subtitleVerticalPosition']} />
                        </div>
                        <div className="control">
                            <label htmlFor="look-gap">
                                {t(
                                    'lookGap',
                                    Math.round(gap.value * 100) / 100
                                )}
                            </label>
                            <input
                                id="look-gap"
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={gap.value}
                                onChange={(event) =>
                                    gap.edit(Number(event.target.value))
                                }
                            />
                            <SiteTag keys={['subtitleGap']} />
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
