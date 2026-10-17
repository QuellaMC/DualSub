import {
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import {
    CUSTOM_LOOK_EDGES,
    CUSTOM_LOOK_FONTS,
    getDefaultValue,
    SETTING_BOUNDS,
    sameSettingValue,
    type CustomLook,
    type SiteSettingKey,
} from '@/config/schema';
import {
    customLook,
    resolveLook,
    type SubtitleLook,
} from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import {
    clampPosition,
    namedSize,
    POSITION_BOUNDS,
    POSITION_KEY_STEPS,
    POSITION_STEP,
    positionLabelKey,
    TEXT_SIZES,
    type TextSize,
} from '../../adjustments';
import { Icon, type IconName } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import type { Translate } from '../../hooks/useI18n';
import { sampleSubtitles, sampleVideoLanguage } from '../../preview/sample';
import { PLATFORM_PRESETS } from '../../subtitleStyle';
import { SampleVideoChoice } from '../preview/SampleVideoChoice';
import { Stage } from '../preview/Stage';
import {
    SiteTag,
    useScope,
    useSiteDraft,
    useSiteOwner,
} from '../shell/scopeContext';
import type { SectionProps } from '../types';

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

const ORDERS = [
    {
        order: 'original_top',
        shortKey: 'lookOrderVideoShort',
        labelKey: 'lookOrderVideoFirst',
    },
    {
        order: 'translation_top',
        shortKey: 'lookOrderMineShort',
        labelKey: 'lookOrderMineFirst',
    },
] as const;

const ORIENTATIONS = [
    {
        orientation: 'column',
        labelKey: 'lookArrangementStacked',
        toastKey: 'toastLinesStacked',
    },
    {
        orientation: 'row',
        labelKey: 'lookArrangementSideBySide',
        toastKey: 'toastLinesSideBySide',
    },
] as const;

type FormatRowId = 'size' | 'position' | 'look' | 'color' | 'lines';

/** The rows whose settings shape the whole block, which the stage
 *  outlines while one is open. */
const BLOCK_ROWS: readonly FormatRowId[] = [
    'size',
    'position',
    'look',
    'lines',
];

function isFont(value: string): value is CustomLook['font'] {
    return (CUSTOM_LOOK_FONTS as readonly string[]).includes(value);
}

function isEdge(value: string): value is CustomLook['edge'] {
    return (CUSTOM_LOOK_EDGES as readonly string[]).includes(value);
}

function lookStyle(look: SubtitleLook): CSSProperties {
    return {
        fontFamily: look.fontFamily,
        fontWeight: look.fontWeight,
        fontVariant: look.fontVariant,
        color: look.originalColor,
        textShadow: look.textShadow,
        WebkitTextStroke: look.textStroke || undefined,
        background: look.background,
        padding: look.padding,
        borderRadius: look.borderRadius,
    };
}

function roundHundredths(value: number): number {
    return Math.round(value * 100) / 100;
}

/** One setting of the pane: its name and value in a row that opens. */
function FormatRow({
    t,
    id,
    icon,
    title,
    summary,
    keys,
    open,
    onToggle,
    children,
}: {
    t: Translate;
    id: string;
    icon: IconName;
    title: string;
    summary: ReactNode;
    keys: readonly SiteSettingKey[];
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    const owner = useSiteOwner(keys);
    return (
        <div className={open ? 'format-row open' : 'format-row'} id={id}>
            <button
                type="button"
                className="format-head"
                aria-expanded={open}
                onClick={onToggle}
            >
                <Icon name={icon} />
                <span className="format-name">{title}</span>
                {owner && (
                    <span
                        className="format-own"
                        title={t('scopeSiteOnly', PLATFORM_NAMES[owner])}
                    >
                        <span className="sr-only">
                            {t('scopeSiteOnly', PLATFORM_NAMES[owner])}
                        </span>
                    </span>
                )}
                <span className="format-value">{summary}</span>
                <span className="format-chevron">
                    <Icon name="chevron" />
                </span>
            </button>
            {open && (
                <div className="format-body">
                    {children}
                    <SiteTag keys={keys} />
                </div>
            )}
        </div>
    );
}

function SceneChoice({
    t,
    day,
    onPick,
    overPicture = false,
}: {
    t: Translate;
    day: boolean;
    onPick: (day: boolean) => void;
    overPicture?: boolean;
}) {
    return (
        <div
            className={overPicture ? 'segmented dark' : 'segmented'}
            role="group"
            aria-label={t('lookScene')}
        >
            <button
                type="button"
                aria-pressed={!day}
                onClick={() => onPick(false)}
            >
                <Icon name="moon" />
                {t('lookNight')}
            </button>
            <button
                type="button"
                aria-pressed={day}
                onClick={() => onPick(true)}
            >
                <Icon name="sun" />
                {t('lookDay')}
            </button>
        </div>
    );
}

export function LookSection({ t, settings, save }: SectionProps) {
    const scope = useScope();
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
    /** Where the subtitles are being dragged; saved where they drop. */
    const [dragged, setDragged] = useState<number | null>(null);
    const [open, setOpen] = useState<FormatRowId | null>('size');
    const [day, setDay] = useState(false);
    const [spoken, setSpoken] = useState(() =>
        sampleVideoLanguage(settings.targetLanguage)
    );
    const [previewSite, setPreviewSite] = useState<PlatformId>(PLATFORM_IDS[0]);
    const [full, setFull] = useState(false);
    const fullScreen = useRef<HTMLDialogElement>(null);
    const openFullScreen = useRef<HTMLButtonElement>(null);
    const done = useRef<HTMLButtonElement>(null);

    useLayoutEffect(() => {
        if (full) {
            fullScreen.current?.showModal();
            done.current?.focus();
        }
    }, [full]);

    const closeFullScreen = (): void => {
        setFull(false);
        openFullScreen.current?.focus();
    };

    const custom = settings.subtitleStyle === 'custom';
    const site = scope === 'all' ? previewSite : scope;
    const shownPosition = dragged ?? position.value;
    const display = toDisplaySettings({
        ...settings,
        subtitleCustomLook: look.value,
        subtitleTranslationColor: translationColor.value,
        subtitleFontScale: scale.value,
        subtitleVerticalPosition: shownPosition,
        subtitleGap: gap.value,
    });
    const sample = sampleSubtitles(settings, spoken);
    const size = namedSize(scale.value);
    const preset = custom
        ? PRESETS.find((option) => sameSettingValue(look.value, option.look))
        : undefined;
    const platformName =
        scope === 'all'
            ? t('lookStylePlatform')
            : t('lookStylePlatformSite', PLATFORM_NAMES[scope]);
    const color = TRANSLATION_COLORS.find(
        (option) => option.hex === translationColor.value.toLowerCase()
    );
    const percent = new Intl.NumberFormat(settings.uiLanguage, {
        style: 'percent',
    });

    const toggle = (row: FormatRowId): void =>
        setOpen((current) => (current === row ? null : row));
    const pickSize = (option: TextSize): void =>
        scale.set(option.scale, {
            message: t('toastSize', t(option.labelKey)),
        });
    const move = (direction: 1 | -1, step: number): void =>
        position.update(
            (current) => clampPosition(current + direction * step),
            { message: t(direction > 0 ? 'toastMovedUp' : 'toastMovedDown') }
        );
    const editLook = (changes: Partial<CustomLook>): void =>
        look.edit({ ...look.value, ...changes });
    const pickPreset = (option: (typeof PRESETS)[number]): void => {
        const notice = { message: t('toastPreset', t(option.labelKey)) };
        if (custom) {
            look.set(option.look, notice);
            return;
        }
        // The custom style's controls show once this lands, so no edit can
        // build on the pick before it does.
        void save(
            { subtitleStyle: 'custom', subtitleCustomLook: option.look },
            notice
        );
    };

    const stage = (tools?: ReactNode): ReactNode => (
        <Stage
            t={t}
            display={display}
            look={resolveLook(display, PLATFORM_PRESETS[site], null)}
            originalText={sample.originalText}
            translatedText={sample.translatedText}
            enabled={settings.subtitlesEnabled}
            day={day}
            ring={
                open === 'color'
                    ? 'translated'
                    : open !== null && BLOCK_ROWS.includes(open)
                      ? 'block'
                      : null
            }
            onPickLine={(line) =>
                setOpen(line === 'original' ? 'look' : 'color')
            }
            onDrag={(value) => {
                setDragged(value);
                setOpen('position');
            }}
            onDrop={(value) => {
                setDragged(null);
                position.set(value, { message: t('toastMoved') });
            }}
            onNudge={(direction, coarse) => {
                setOpen('position');
                move(
                    direction,
                    coarse ? POSITION_KEY_STEPS.coarse : POSITION_KEY_STEPS.fine
                );
            }}
        >
            {tools}
        </Stage>
    );
    const moveButtons = (
        <>
            <button
                type="button"
                disabled={shownPosition >= POSITION_BOUNDS.max}
                onClick={() => move(1, POSITION_STEP)}
            >
                <Icon name="up" />
                {t('lookMoveUp')}
            </button>
            <button
                type="button"
                disabled={shownPosition <= POSITION_BOUNDS.min}
                onClick={() => move(-1, POSITION_STEP)}
            >
                <Icon name="down" />
                {t('lookMoveDown')}
            </button>
        </>
    );

    return (
        <section className="section" aria-labelledby="look-title">
            <h1 id="look-title" className="sr-only" tabIndex={-1}>
                {t('navLook')}
            </h1>
            <div className="style-editor">
                <div className="stage-column">
                    <div className="stage-bar">
                        <div className="inline wrap">
                            <SceneChoice t={t} day={day} onPick={setDay} />
                            <SampleVideoChoice
                                t={t}
                                spoken={spoken}
                                onPick={setSpoken}
                            />
                            {!custom && scope === 'all' && (
                                <div
                                    className="segmented"
                                    role="group"
                                    aria-label={t('lookPreviewSite')}
                                >
                                    {PLATFORM_IDS.map((id) => (
                                        <button
                                            key={id}
                                            type="button"
                                            aria-pressed={previewSite === id}
                                            onClick={() => setPreviewSite(id)}
                                        >
                                            {PLATFORM_NAMES[id]}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            ref={openFullScreen}
                            id="look-full-screen"
                            type="button"
                            className="button"
                            onClick={() => setFull(true)}
                        >
                            <Icon name="fullScreen" />
                            {t('lookFullScreen')}
                        </button>
                    </div>
                    {stage()}
                    <p className="hint">
                        <Icon name="move" />
                        {t('lookStageHint')}
                    </p>
                </div>

                <div className="format-frame">
                    <aside className="format" aria-label={t('lookPaneLabel')}>
                        <FormatRow
                            t={t}
                            id="format-size"
                            icon="size"
                            title={t('lookRowSize')}
                            summary={
                                size
                                    ? t(size.labelKey)
                                    : t(
                                          'sizeExact',
                                          roundHundredths(scale.value)
                                      )
                            }
                            keys={['subtitleFontScale']}
                            open={open === 'size'}
                            onToggle={() => toggle('size')}
                        >
                            <div
                                className="format-segments"
                                role="group"
                                aria-label={t('lookSizeTitle')}
                            >
                                {TEXT_SIZES.map((option) => (
                                    <button
                                        key={option.labelKey}
                                        type="button"
                                        aria-pressed={size === option}
                                        aria-label={t(option.labelKey)}
                                        title={t(option.labelKey)}
                                        onClick={() => pickSize(option)}
                                    >
                                        <span
                                            style={{
                                                fontSize: `${option.glyphPx}px`,
                                            }}
                                        >
                                            A
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <div className="format-control">
                                <label htmlFor="look-exact-size">
                                    {t('lookExact')}
                                </label>
                                <input
                                    id="look-exact-size"
                                    type="range"
                                    aria-label={t('lookExactSize')}
                                    min={SETTING_BOUNDS.subtitleFontScale.min}
                                    max={SETTING_BOUNDS.subtitleFontScale.max}
                                    step={0.05}
                                    value={scale.value}
                                    onChange={(event) =>
                                        scale.edit(Number(event.target.value))
                                    }
                                />
                                <span className="format-number">
                                    {t(
                                        'sizeExact',
                                        roundHundredths(scale.value)
                                    )}
                                </span>
                            </div>
                        </FormatRow>

                        <FormatRow
                            t={t}
                            id="format-position"
                            icon="move"
                            title={t('lookRowPosition')}
                            summary={t(positionLabelKey(shownPosition))}
                            keys={['subtitleVerticalPosition']}
                            open={open === 'position'}
                            onToggle={() => toggle('position')}
                        >
                            <div className="format-pair">{moveButtons}</div>
                            <div className="format-control">
                                <label htmlFor="look-exact-position">
                                    {t('lookExact')}
                                </label>
                                <input
                                    id="look-exact-position"
                                    type="range"
                                    aria-label={t('lookExactPosition')}
                                    min={POSITION_BOUNDS.min}
                                    max={POSITION_BOUNDS.max}
                                    step={0.1}
                                    value={shownPosition}
                                    onChange={(event) =>
                                        position.edit(
                                            Number(event.target.value)
                                        )
                                    }
                                />
                                <span className="format-number">
                                    {shownPosition.toFixed(1)}
                                </span>
                            </div>
                        </FormatRow>

                        <FormatRow
                            t={t}
                            id="format-look"
                            icon="palette"
                            title={t('lookRowLook')}
                            summary={
                                !custom
                                    ? platformName
                                    : preset
                                      ? t(preset.labelKey)
                                      : t('lookCustom')
                            }
                            keys={['subtitleStyle', 'subtitleCustomLook']}
                            open={open === 'look'}
                            onToggle={() => toggle('look')}
                        >
                            <div
                                className="look-tiles"
                                role="group"
                                aria-label={t('lookPresetsLabel')}
                            >
                                <button
                                    type="button"
                                    aria-pressed={!custom}
                                    aria-label={platformName}
                                    title={platformName}
                                    onClick={() =>
                                        void save(
                                            { subtitleStyle: 'platform' },
                                            {
                                                message:
                                                    t('toastStylePlatform'),
                                            }
                                        )
                                    }
                                >
                                    <span
                                        style={lookStyle(
                                            PLATFORM_PRESETS[site]
                                        )}
                                    >
                                        Aa
                                    </span>
                                </button>
                                {PRESETS.map((option) => (
                                    <button
                                        key={option.labelKey}
                                        type="button"
                                        aria-pressed={preset === option}
                                        aria-label={t(option.labelKey)}
                                        title={t(option.labelKey)}
                                        onClick={() => pickPreset(option)}
                                    >
                                        <span
                                            style={lookStyle(
                                                customLook(option.look)
                                            )}
                                        >
                                            Aa
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {custom ? (
                                <>
                                    <div className="format-control">
                                        <label htmlFor="look-font">
                                            {t('lookFontLabel')}
                                        </label>
                                        <select
                                            id="look-font"
                                            className="field"
                                            value={look.value.font}
                                            onChange={(event) => {
                                                if (
                                                    isFont(event.target.value)
                                                ) {
                                                    editLook({
                                                        font: event.target
                                                            .value,
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
                                    <div className="format-control">
                                        <label htmlFor="look-edge">
                                            {t('lookEdgeLabel')}
                                        </label>
                                        <select
                                            id="look-edge"
                                            className="field"
                                            value={look.value.edge}
                                            onChange={(event) => {
                                                if (
                                                    isEdge(event.target.value)
                                                ) {
                                                    editLook({
                                                        edge: event.target
                                                            .value,
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
                                    <div className="format-control">
                                        <span id="look-bold">
                                            {t('lookBoldLabel')}
                                        </span>
                                        <Switch
                                            small
                                            checked={look.value.bold}
                                            labelledBy="look-bold"
                                            onChange={(bold) =>
                                                editLook({ bold })
                                            }
                                        />
                                    </div>
                                    <div className="format-control">
                                        <label htmlFor="look-top-color">
                                            {t('lookTopColorLabel')}
                                        </label>
                                        <input
                                            id="look-top-color"
                                            type="color"
                                            className="color-field"
                                            value={look.value.originalColor}
                                            onChange={(event) =>
                                                editLook({
                                                    originalColor:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="format-control">
                                        <label htmlFor="look-box-color">
                                            {t('lookBoxColorLabel')}
                                        </label>
                                        <input
                                            id="look-box-color"
                                            type="color"
                                            className="color-field"
                                            value={look.value.backgroundColor}
                                            onChange={(event) =>
                                                editLook({
                                                    backgroundColor:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                        <input
                                            type="range"
                                            aria-label={t(
                                                'lookBoxOpacityLabel'
                                            )}
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={look.value.backgroundOpacity}
                                            onChange={(event) =>
                                                editLook({
                                                    backgroundOpacity: Number(
                                                        event.target.value
                                                    ),
                                                })
                                            }
                                        />
                                        <span className="format-number">
                                            {percent.format(
                                                look.value.backgroundOpacity
                                            )}
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <p className="help">
                                    {t('lookStylePlatformHelp')}
                                </p>
                            )}
                        </FormatRow>

                        <FormatRow
                            t={t}
                            id="format-color"
                            icon="drop"
                            title={t('lookTranslationColorTitle')}
                            summary={
                                <>
                                    <span
                                        className="color-dot"
                                        style={{
                                            background: translationColor.value,
                                        }}
                                    />
                                    {color
                                        ? t(color.labelKey)
                                        : t('lookCustom')}
                                </>
                            }
                            keys={['subtitleTranslationColor']}
                            open={open === 'color'}
                            onToggle={() => toggle('color')}
                        >
                            <div
                                className="swatches"
                                role="group"
                                aria-label={t('lookTranslationColorTitle')}
                            >
                                {TRANSLATION_COLORS.map((option) => (
                                    <button
                                        key={option.hex}
                                        type="button"
                                        className="swatch"
                                        style={{ background: option.hex }}
                                        aria-label={t(option.labelKey)}
                                        aria-pressed={color === option}
                                        onClick={() =>
                                            translationColor.set(option.hex, {
                                                message: t(
                                                    'toastTranslationColor',
                                                    t(option.labelKey)
                                                ),
                                            })
                                        }
                                    />
                                ))}
                                <input
                                    type="color"
                                    className="color-field"
                                    aria-label={t('lookColorOther')}
                                    value={translationColor.value}
                                    onChange={(event) =>
                                        translationColor.edit(
                                            event.target.value
                                        )
                                    }
                                />
                            </div>
                        </FormatRow>

                        <FormatRow
                            t={t}
                            id="format-lines"
                            icon="lines"
                            title={t('lookRowLines')}
                            summary={t(
                                settings.subtitleLayoutOrientation === 'row'
                                    ? 'lookArrangementSideBySide'
                                    : settings.subtitleLayoutOrder ===
                                        'translation_top'
                                      ? 'lookOrderMineFirst'
                                      : 'lookOrderVideoFirst'
                            )}
                            keys={[
                                'subtitleLayoutOrder',
                                'subtitleLayoutOrientation',
                                'subtitleGap',
                            ]}
                            open={open === 'lines'}
                            onToggle={() => toggle('lines')}
                        >
                            <div className="format-control">
                                <span>{t('lookOnTop')}</span>
                                <div
                                    className="format-segments"
                                    role="group"
                                    aria-label={t('lookOrderTitle')}
                                >
                                    {ORDERS.map((option) => (
                                        <button
                                            key={option.order}
                                            type="button"
                                            aria-pressed={
                                                settings.subtitleLayoutOrder ===
                                                option.order
                                            }
                                            onClick={() =>
                                                void save(
                                                    {
                                                        subtitleLayoutOrder:
                                                            option.order,
                                                    },
                                                    {
                                                        message: t(
                                                            option.labelKey
                                                        ),
                                                    }
                                                )
                                            }
                                        >
                                            {t(option.shortKey)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="format-control">
                                <span>{t('lookLayout')}</span>
                                <div
                                    className="format-segments"
                                    role="group"
                                    aria-label={t('lookArrangementTitle')}
                                >
                                    {ORIENTATIONS.map((option) => (
                                        <button
                                            key={option.orientation}
                                            type="button"
                                            aria-pressed={
                                                settings.subtitleLayoutOrientation ===
                                                option.orientation
                                            }
                                            onClick={() =>
                                                void save(
                                                    {
                                                        subtitleLayoutOrientation:
                                                            option.orientation,
                                                    },
                                                    {
                                                        message: t(
                                                            option.toastKey
                                                        ),
                                                    }
                                                )
                                            }
                                        >
                                            {t(option.labelKey)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="format-control">
                                <label htmlFor="look-gap">
                                    {t('lookSpacing')}
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
                                <span className="format-number">
                                    {roundHundredths(gap.value)}
                                </span>
                            </div>
                        </FormatRow>
                    </aside>
                </div>
            </div>

            {full && (
                <dialog
                    ref={fullScreen}
                    className="stage-dialog"
                    aria-label={t('lookFullScreen')}
                    onClose={closeFullScreen}
                >
                    {stage(
                        <div className="full-tools">
                            <div
                                className="segmented dark"
                                role="group"
                                aria-label={t('lookSizeTitle')}
                            >
                                {TEXT_SIZES.map((option) => (
                                    <button
                                        key={option.labelKey}
                                        type="button"
                                        aria-pressed={size === option}
                                        onClick={() => pickSize(option)}
                                    >
                                        {t(option.labelKey)}
                                    </button>
                                ))}
                            </div>
                            <div
                                className="segmented dark"
                                role="group"
                                aria-label={t('lookPositionTitle')}
                            >
                                {moveButtons}
                            </div>
                            <SceneChoice
                                t={t}
                                day={day}
                                onPick={setDay}
                                overPicture
                            />
                            <button
                                ref={done}
                                type="button"
                                className="button"
                                onClick={closeFullScreen}
                            >
                                {t('commonDone')}
                            </button>
                        </div>
                    )}
                </dialog>
            )}
        </section>
    );
}
