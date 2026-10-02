import { SETTING_BOUNDS, type SettingsValues } from '@/config/schema';
import type { PlatformLookStatus } from '../contentTab';
import type { Translate } from '../hooks/useI18n';
import {
    isSubtitleStyle,
    PLATFORM_NAMES,
    SUBTITLE_STYLE_LABELS,
    type SubtitleStyle,
} from '../subtitleStyle';
import { SliderSetting } from './SliderSetting';

export type SliderKey =
    'subtitleFontScale' | 'subtitleGap' | 'subtitleVerticalPosition';

const LAYOUT_ORDER_LABELS: Record<
    SettingsValues['subtitleLayoutOrder'],
    string
> = {
    original_top: 'displayOrderOriginalFirst',
    translation_top: 'displayOrderTranslationFirst',
};

const LAYOUT_ORIENTATION_LABELS: Record<
    SettingsValues['subtitleLayoutOrientation'],
    string
> = {
    column: 'layoutTopBottom',
    row: 'layoutLeftRight',
};

const SLIDERS: {
    key: SliderKey;
    labelKey: string;
    min: number;
    max: number;
    step: number;
}[] = [
    {
        key: 'subtitleFontScale',
        labelKey: 'fontSizeLabel',
        min: SETTING_BOUNDS.subtitleFontScale.min,
        max: SETTING_BOUNDS.subtitleFontScale.max,
        step: 0.1,
    },
    {
        key: 'subtitleGap',
        labelKey: 'verticalGapLabel',
        min: 0,
        max: 1,
        step: 0.1,
    },
    {
        key: 'subtitleVerticalPosition',
        labelKey: 'subtitleVerticalPositionLabel',
        min: 0.1,
        max: 9.9,
        step: 0.1,
    },
];

function isLayoutOrder(
    value: string
): value is SettingsValues['subtitleLayoutOrder'] {
    return Object.hasOwn(LAYOUT_ORDER_LABELS, value);
}

function isLayoutOrientation(
    value: string
): value is SettingsValues['subtitleLayoutOrientation'] {
    return Object.hasOwn(LAYOUT_ORIENTATION_LABELS, value);
}

/** What the chosen style draws from on this tab: a note under the menu. */
function StyleNote({
    t,
    subtitleStyle,
    platformLook,
    onEditCustomLook,
}: {
    t: Translate;
    subtitleStyle: SubtitleStyle;
    platformLook: PlatformLookStatus | null;
    onEditCustomLook: () => void;
}) {
    if (subtitleStyle === 'platform' && platformLook) {
        return (
            <p className="setting-note">
                {t(
                    platformLook.captured
                        ? 'platformLookCaptured'
                        : 'platformLookPreset',
                    PLATFORM_NAMES[platformLook.platform]
                )}
            </p>
        );
    }
    if (subtitleStyle === 'custom') {
        return (
            <p className="setting-note">
                <button
                    type="button"
                    className="link-button"
                    onClick={onEditCustomLook}
                >
                    {t('editCustomLook')}
                </button>
            </p>
        );
    }
    return null;
}

export function AppearanceSettings({
    t,
    isOpen,
    onToggle,
    subtitleStyle,
    platformLook,
    layoutOrder,
    layoutOrientation,
    sliderValues,
    timeOffset,
    onSubtitleStyleChange,
    onEditCustomLook,
    onLayoutOrderChange,
    onLayoutOrientationChange,
    onSliderPreview,
    onSliderCommit,
    onTimeOffsetChange,
}: {
    t: Translate;
    isOpen: boolean;
    onToggle: (open: boolean) => void;
    subtitleStyle: SubtitleStyle;
    platformLook: PlatformLookStatus | null;
    layoutOrder: SettingsValues['subtitleLayoutOrder'];
    layoutOrientation: SettingsValues['subtitleLayoutOrientation'];
    sliderValues: Record<SliderKey, number>;
    timeOffset: number;
    onSubtitleStyleChange: (value: SubtitleStyle) => void;
    onEditCustomLook: () => void;
    onLayoutOrderChange: (value: SettingsValues['subtitleLayoutOrder']) => void;
    onLayoutOrientationChange: (
        value: SettingsValues['subtitleLayoutOrientation']
    ) => void;
    onSliderPreview: (key: SliderKey, value: number) => void;
    onSliderCommit: (key: SliderKey, value: number) => Promise<boolean>;
    onTimeOffsetChange: (raw: string) => void;
}) {
    return (
        <details
            className="accordion-card"
            open={isOpen}
            onToggle={(event) => onToggle(event.currentTarget.open)}
        >
            <summary className="accordion-header">
                {t('subtitleAppearanceTimingLegend')}
            </summary>
            <div className="accordion-body">
                <div className="setting-item">
                    <label htmlFor="subtitleStyle">
                        {t('subtitleStyleLabel')}
                    </label>
                    <select
                        id="subtitleStyle"
                        value={subtitleStyle}
                        onChange={(event) => {
                            if (isSubtitleStyle(event.target.value)) {
                                onSubtitleStyleChange(event.target.value);
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
                <StyleNote
                    t={t}
                    subtitleStyle={subtitleStyle}
                    platformLook={platformLook}
                    onEditCustomLook={onEditCustomLook}
                />
                <div className="setting-item">
                    <label htmlFor="subtitleLayoutOrder">
                        {t('displayOrderLabel')}
                    </label>
                    <select
                        id="subtitleLayoutOrder"
                        value={layoutOrder}
                        onChange={(event) => {
                            if (isLayoutOrder(event.target.value)) {
                                onLayoutOrderChange(event.target.value);
                            }
                        }}
                    >
                        {Object.entries(LAYOUT_ORDER_LABELS).map(
                            ([value, key]) => (
                                <option key={value} value={value}>
                                    {t(key)}
                                </option>
                            )
                        )}
                    </select>
                </div>
                <div className="setting-item">
                    <label htmlFor="subtitleLayoutOrientation">
                        {t('layoutLabel')}
                    </label>
                    <select
                        id="subtitleLayoutOrientation"
                        value={layoutOrientation}
                        onChange={(event) => {
                            if (isLayoutOrientation(event.target.value)) {
                                onLayoutOrientationChange(event.target.value);
                            }
                        }}
                    >
                        {Object.entries(LAYOUT_ORIENTATION_LABELS).map(
                            ([value, key]) => (
                                <option key={value} value={value}>
                                    {t(key)}
                                </option>
                            )
                        )}
                    </select>
                </div>
                {SLIDERS.map((slider) => (
                    <SliderSetting
                        key={slider.key}
                        id={slider.key}
                        label={t(slider.labelKey)}
                        value={sliderValues[slider.key]}
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        onPreview={(value) =>
                            onSliderPreview(slider.key, value)
                        }
                        onCommit={(value) => onSliderCommit(slider.key, value)}
                    />
                ))}
                <div className="setting-item">
                    <label htmlFor="subtitleTimeOffset">
                        {t('timeOffsetLabel')}
                    </label>
                    <input
                        type="number"
                        id="subtitleTimeOffset"
                        step="0.1"
                        value={timeOffset}
                        onChange={(event) =>
                            onTimeOffsetChange(event.target.value)
                        }
                    />
                </div>
            </div>
        </details>
    );
}
