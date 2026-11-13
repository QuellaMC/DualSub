// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import type { SubtitleLanguage } from '@/shared/subtitleLanguages';
import { OPTIONS_SETTINGS_KEYS, type OptionsSettings } from '../types';
import { Specimen } from './Specimen';

const t = (key: string, ...subs: readonly (string | number)[]): string =>
    subs.length > 0 ? `${key}:${subs.join(',')}` : key;

function settingsWith(overrides: Partial<OptionsSettings>): OptionsSettings {
    const values: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
        if ((OPTIONS_SETTINGS_KEYS as readonly string[]).includes(key)) {
            values[key] = getDefaultValue(key);
        }
    }
    return { ...(values as unknown as OptionsSettings), ...overrides };
}

function renderSpecimen(
    overrides: Partial<OptionsSettings>,
    spoken: SubtitleLanguage = 'en'
): void {
    render(
        <Specimen
            t={t}
            settings={settingsWith(overrides)}
            scope="all"
            spoken={spoken}
            corner={null}
        />
    );
}

function slot(name: 'original' | 'translated'): HTMLElement {
    return document.querySelector<HTMLElement>(
        `.specimen .dualsub-${name}-subtitle`
    )!;
}

function legend(): string[] {
    return screen.getAllByRole('listitem').map((item) => item.textContent);
}

afterEach(() => {
    cleanup();
});

describe('Specimen', () => {
    it("draws both lines with the renderer's own styling, named under the band", () => {
        renderSpecimen({
            targetLanguage: 'zh-CN',
            subtitleTranslationColor: '#ffe45c',
        });
        expect(slot('original')).toHaveTextContent('Where there’s a will');
        expect(slot('translated')).toHaveTextContent('有志者事竟成。');
        expect(slot('translated').style.color).toBe('#ffe45c');
        expect(legend()).toEqual([
            'previewLegendSpoken:lang_en',
            'previewLegendYours:lang_zh_CN',
        ]);
        expect(
            screen.getByRole('img', {
                name: 'previewLinesLabel:Where there’s a will, there’s a way. / 有志者事竟成。',
            })
        ).toBeInTheDocument();
    });

    it('names the lines in the order they show', () => {
        renderSpecimen({
            targetLanguage: 'zh-CN',
            subtitleLayoutOrder: 'translation_top',
        });
        expect(legend()).toEqual([
            'previewLegendYours:lang_zh_CN',
            'previewLegendSpoken:lang_en',
        ]);
    });

    it('shows one line for a video already in the viewer’s language', () => {
        renderSpecimen(
            { targetLanguage: 'ko', originalLanguage: 'auto' },
            'ko'
        );
        expect(slot('original')).toHaveTextContent('뜻이 있는 곳에 길이 있다.');
        expect(slot('translated')).toHaveTextContent('');
        expect(legend()).toEqual(['previewLegendOneLine:lang_ko']);
    });

    it('counts the lines by the languages picked, before English stands in', () => {
        renderSpecimen({ targetLanguage: 'en', originalLanguage: 'nl' });
        expect(slot('original')).toHaveTextContent('Where there’s a will');
        expect(slot('translated')).toHaveTextContent('Where there’s a will');
        expect(legend()).toEqual([
            'previewLegendChosen:nl',
            'previewLegendYours:lang_en',
        ]);
        expect(screen.getByText('previewStandIn:nl')).toBeInTheDocument();
    });

    it('shows that dual subtitles are off', () => {
        renderSpecimen({ subtitlesEnabled: false });
        expect(screen.getByText('previewOff')).toBeInTheDocument();
        expect(screen.queryByRole('img')).toBeNull();
    });
});
