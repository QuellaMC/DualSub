import React from 'react';
import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { Providers } from '../../../content_scripts/shared/constants/providers.js';
import { TranslationSection } from './TranslationSection.jsx';

const t = (_key, fallback) => fallback;

describe('TranslationSection', () => {
    test('shows only controls that affect live cue translation', () => {
        render(
            <TranslationSection
                t={t}
                settings={{
                    selectedProvider: Providers.MICROSOFT_EDGE_AUTH,
                    translationDelay: 0,
                }}
                onSettingChange={() => {}}
            />
        );

        expect(screen.getByLabelText('Provider:')).toBeInTheDocument();
        expect(screen.getByLabelText('Request Delay (ms):')).toHaveValue(0);
        expect(screen.queryByText('Batch Translation')).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Batch Size/i)).not.toBeInTheDocument();
    });

    test('persists provider and request-delay changes', () => {
        const onSettingChange = jest.fn();
        render(
            <TranslationSection
                t={t}
                settings={{
                    selectedProvider: Providers.MICROSOFT_EDGE_AUTH,
                    translationDelay: 150,
                }}
                onSettingChange={onSettingChange}
            />
        );

        fireEvent.change(screen.getByLabelText('Provider:'), {
            target: { value: Providers.OPENAI_COMPATIBLE },
        });
        fireEvent.change(screen.getByLabelText('Request Delay (ms):'), {
            target: { value: '250' },
        });

        expect(onSettingChange).toHaveBeenNthCalledWith(
            1,
            'selectedProvider',
            Providers.OPENAI_COMPATIBLE
        );
        expect(onSettingChange).toHaveBeenNthCalledWith(
            2,
            'translationDelay',
            250
        );
    });
});
