// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import { OPTIONS_SETTINGS_KEYS, type OptionsSettings } from '../types';
import { Preview } from './Preview';

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

function slot(name: 'original' | 'translated'): HTMLElement {
    return screen
        .getByRole('img', { name: 'previewLabel' })
        .querySelector<HTMLElement>(`.dualsub-${name}-subtitle`)!;
}

afterEach(() => {
    cleanup();
});

describe('Preview', () => {
    it("draws both lines with the renderer's own styling in the chosen colors", () => {
        render(
            <Preview
                t={t}
                scope="all"
                settings={settingsWith({
                    targetLanguage: 'zh-CN',
                    subtitleTranslationColor: '#ffe45c',
                })}
            />
        );
        expect(slot('original')).toHaveTextContent('Where there’s a will');
        expect(slot('translated')).toHaveTextContent('有志者事竟成。');
        expect(slot('translated').style.color).toBe('#ffe45c');
    });

    it('follows the sample video on an automatic top line, down to one line', () => {
        render(
            <Preview
                t={t}
                scope="all"
                settings={settingsWith({
                    targetLanguage: 'ko',
                    originalLanguage: 'auto',
                })}
            />
        );
        expect(slot('original')).toHaveTextContent('Where there’s a will');
        fireEvent.click(
            screen.getByRole('button', { name: 'previewKoreanDrama' })
        );
        expect(slot('original')).toHaveTextContent('뜻이 있는 곳에 길이 있다.');
        expect(slot('translated')).toHaveTextContent('');
        expect(screen.getByText('previewOneLine')).toBeInTheDocument();
    });

    it('counts the lines by the languages picked, before English stands in', () => {
        render(
            <Preview
                t={t}
                scope="all"
                settings={settingsWith({
                    targetLanguage: 'en',
                    originalLanguage: 'nl',
                })}
            />
        );
        expect(slot('original')).toHaveTextContent('Where there’s a will');
        expect(slot('translated')).toHaveTextContent('Where there’s a will');
        expect(screen.queryByText('previewOneLine')).not.toBeInTheDocument();
        expect(
            screen.getByText('previewCaptionFixed:nl,lang_en')
        ).toBeInTheDocument();
        expect(screen.getByText('previewStandIn:nl')).toBeInTheDocument();
    });

    it('shows that dual subtitles are off', () => {
        render(
            <Preview
                t={t}
                scope="netflix"
                settings={settingsWith({ subtitlesEnabled: false })}
            />
        );
        expect(screen.getByText('previewOff')).toBeInTheDocument();
        expect(screen.getByText('Netflix')).toBeInTheDocument();
    });
});
