import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const openAICompatibleProviderCard = jest.fn(
    ({ apiKey, baseUrl, model, models, onModelChange, onModelsLoaded }) => (
        <div>
            <output data-testid="openai-model-catalog">
                {models.join(',')}
            </output>
            <select
                aria-label="OpenAI model"
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
            >
                {models.map((availableModel) => (
                    <option key={availableModel} value={availableModel}>
                        {availableModel}
                    </option>
                ))}
            </select>
            <button
                type="button"
                onClick={() =>
                    onModelsLoaded(['catalog-model-a', 'catalog-model-b'], {
                        apiKey,
                        baseUrl,
                    })
                }
            >
                Publish catalog
            </button>
            <button
                type="button"
                onClick={() =>
                    onModelsLoaded(['stale-model'], {
                        apiKey: 'key-a',
                        baseUrl: 'https://a.example.com/v1',
                    })
                }
            >
                Publish stale catalog
            </button>
        </div>
    )
);

jest.unstable_mockModule(
    '../providers/OpenAICompatibleProviderCard.jsx',
    () => ({
        OpenAICompatibleProviderCard: openAICompatibleProviderCard,
    })
);
jest.unstable_mockModule('../providers/GoogleProviderCard.jsx', () => ({
    GoogleProviderCard: () => null,
}));
jest.unstable_mockModule('../providers/MicrosoftProviderCard.jsx', () => ({
    MicrosoftProviderCard: () => null,
}));
jest.unstable_mockModule('../providers/DeepLProviderCard.jsx', () => ({
    DeepLProviderCard: () => null,
}));
jest.unstable_mockModule('../providers/VertexProviderCard.jsx', () => ({
    VertexProviderCard: () => null,
}));

const { Providers } =
    await import('../../../content_scripts/shared/constants/providers.js');
const { ProvidersSection } = await import('./ProvidersSection.jsx');

function getSection(settings, onSettingChange) {
    return (
        <ProvidersSection
            t={(_key, fallback) => fallback}
            settings={settings}
            onSettingChange={onSettingChange}
            onSettingsChange={jest.fn()}
        />
    );
}

test('selecting a saved model does not collapse the fetched catalog', () => {
    const onSettingChange = jest.fn();
    const settings = {
        selectedProvider: Providers.OPENAI_COMPATIBLE,
        openaiCompatibleModel: 'catalog-model-a',
    };
    const { rerender } = render(getSection(settings, onSettingChange));

    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));
    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'catalog-model-a,catalog-model-b'
    );

    fireEvent.change(screen.getByLabelText('OpenAI model'), {
        target: { value: 'catalog-model-b' },
    });
    expect(onSettingChange).toHaveBeenCalledWith(
        'openaiCompatibleModel',
        'catalog-model-b'
    );

    rerender(
        getSection(
            { ...settings, openaiCompatibleModel: 'catalog-model-b' },
            onSettingChange
        )
    );
    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'catalog-model-a,catalog-model-b'
    );
});

test('a custom saved model remains selected when it is absent from the catalog', () => {
    const onSettingChange = jest.fn().mockResolvedValue(true);
    const settings = {
        selectedProvider: Providers.OPENAI_COMPATIBLE,
        openaiCompatibleModel: 'saved-model',
    };
    render(getSection(settings, onSettingChange));

    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'saved-model'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));

    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'saved-model,catalog-model-a,catalog-model-b'
    );
    expect(screen.getByLabelText('OpenAI model')).toHaveValue('saved-model');
    expect(onSettingChange).not.toHaveBeenCalled();
});

test('the first catalog model is persisted only when the saved model is blank', async () => {
    const onSettingChange = jest.fn().mockResolvedValue(true);
    render(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleModel: '   ',
            },
            onSettingChange
        )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));

    await waitFor(() =>
        expect(onSettingChange).toHaveBeenCalledWith(
            'openaiCompatibleModel',
            'catalog-model-a'
        )
    );
});

test('catalog entries stay scoped to the exact credential and endpoint identity', () => {
    const onSettingChange = jest.fn().mockResolvedValue(true);
    const { rerender } = render(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleApiKey: 'key-a',
                openaiCompatibleBaseUrl: 'https://a.example.com/v1',
                openaiCompatibleModel: 'saved-a',
            },
            onSettingChange
        )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));
    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'saved-a,catalog-model-a,catalog-model-b'
    );

    rerender(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleApiKey: 'key-b',
                openaiCompatibleBaseUrl: 'https://b.example.com/v1',
                openaiCompatibleModel: 'saved-b',
            },
            onSettingChange
        )
    );
    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        /^saved-b$/
    );

    fireEvent.click(
        screen.getByRole('button', { name: 'Publish stale catalog' })
    );
    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        /^saved-b$/
    );
});
