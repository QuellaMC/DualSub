import React from 'react';
import { SliderSetting } from './SliderSetting.jsx';

export function AppearanceSettings({
    t,
    isOpen,
    onToggle,
    layoutOrder,
    layoutOrientation,
    fontSize,
    gap,
    verticalPosition,
    timeOffset,
    onLayoutOrderChange,
    onLayoutOrientationChange,
    onFontSizeChange,
    onFontSizeChangeEnd,
    onGapChange,
    onGapChangeEnd,
    onVerticalPositionChange,
    onVerticalPositionChangeEnd,
    onTimeOffsetChange,
}) {
    const layoutOrderOptions = {
        original_top: 'displayOrderOriginalFirst',
        translation_top: 'displayOrderTranslationFirst',
    };

    const layoutOrientationOptions = {
        column: 'layoutTopBottom',
        row: 'layoutLeftRight',
    };

    return (
        <details className="accordion-card" open={isOpen} onToggle={onToggle}>
            <summary className="accordion-header">
                {t(
                    'subtitleAppearanceTimingLegend',
                    'Subtitle Appearance & Timing'
                )}
            </summary>
            <div className="accordion-body">
                <div className="setting-item">
                    <label htmlFor="subtitleLayoutOrder">
                        {t('displayOrderLabel', 'Display Order')}
                    </label>
                    <select
                        id="subtitleLayoutOrder"
                        value={layoutOrder}
                        onChange={(e) => onLayoutOrderChange(e.target.value)}
                    >
                        {Object.entries(layoutOrderOptions).map(
                            ([value, key]) => (
                                <option key={value} value={value}>
                                    {t(key, value)}
                                </option>
                            )
                        )}
                    </select>
                </div>
                <div className="setting-item">
                    <label htmlFor="subtitleLayoutOrientation">
                        {t('layoutLabel', 'Layout')}
                    </label>
                    <select
                        id="subtitleLayoutOrientation"
                        value={layoutOrientation}
                        onChange={(e) =>
                            onLayoutOrientationChange(e.target.value)
                        }
                    >
                        {Object.entries(layoutOrientationOptions).map(
                            ([value, key]) => (
                                <option key={value} value={value}>
                                    {t(key, value)}
                                </option>
                            )
                        )}
                    </select>
                </div>
                <SliderSetting
                    label={t('fontSizeLabel', 'Font Size')}
                    id="subtitleFontSize"
                    value={fontSize}
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    onChange={onFontSizeChange}
                    onChangeEnd={onFontSizeChangeEnd}
                />
                <SliderSetting
                    label={t('verticalGapLabel', 'Vertical Gap')}
                    id="subtitleGap"
                    value={gap}
                    min="0"
                    max="1"
                    step="0.1"
                    onChange={onGapChange}
                    onChangeEnd={onGapChangeEnd}
                />
                <SliderSetting
                    label={t(
                        'subtitleVerticalPositionLabel',
                        'Vertical Position'
                    )}
                    id="subtitleVerticalPosition"
                    value={verticalPosition}
                    min="0.1"
                    max="9.9"
                    step="0.1"
                    onChange={onVerticalPositionChange}
                    onChangeEnd={onVerticalPositionChangeEnd}
                />
                <div className="setting-item">
                    <label htmlFor="subtitleTimeOffset">
                        {t('timeOffsetLabel', 'Time Offset (sec)')}
                    </label>
                    <input
                        type="number"
                        id="subtitleTimeOffset"
                        step="0.1"
                        value={timeOffset}
                        onChange={(e) => onTimeOffsetChange(e.target.value)}
                    />
                </div>
            </div>
        </details>
    );
}
