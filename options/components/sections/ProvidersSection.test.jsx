import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';

let publishFromKeyA;
const openAICompatibleProviderCard = jest.fn(
    ({ apiKey, baseUrl, model, models, onModelChange, onModelsLoaded }) => {
        if (apiKey === 'key-a' && !publishFromKeyA) {
            publishFromKeyA = () =>
                onModelsLoaded(['stale-model'], { apiKey, baseUrl });
        }
        return (
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
            </div>
        );
    }
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

beforeEach(() => {
    publishFromKeyA = null;
    openAICompatibleProviderCard.mockClear();
});

test('changing the selected model preserves the fetched catalog', () => {
    const onSettingChange = jest.fn();
    const settings = {
        selectedProvider: Providers.OPENAI_COMPATIBLE,
        openaiCompatibleModel: 'catalog-model-a',
    };
    const { rerender } = render(getSection(settings, onSettingChange));

    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));
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

test('a saved custom model remains available when the provider omits it', () => {
    const onSettingChange = jest.fn();
    render(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleModel: 'saved-model',
            },
            onSettingChange
        )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish catalog' }));

    expect(screen.getByTestId('openai-model-catalog')).toHaveTextContent(
        'saved-model,catalog-model-a,catalog-model-b'
    );
    expect(screen.getByLabelText('OpenAI model')).toHaveValue('saved-model');
    expect(onSettingChange).not.toHaveBeenCalled();
});

test('the first catalog model becomes the default only when none is saved', async () => {
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

test('a catalog response for an old credential identity cannot publish or choose a default', async () => {
    const onSettingChange = jest.fn().mockResolvedValue(true);
    const { rerender } = render(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleApiKey: 'key-a',
                openaiCompatibleBaseUrl: 'https://a.example.com/v1',
                openaiCompatibleModel: '',
            },
            onSettingChange
        )
    );

    rerender(
        getSection(
            {
                selectedProvider: Providers.OPENAI_COMPATIBLE,
                openaiCompatibleApiKey: 'key-b',
                openaiCompatibleBaseUrl: 'https://b.example.com/v1',
                openaiCompatibleModel: '',
            },
            onSettingChange
        )
    );
    await act(async () => {
        await publishFromKeyA();
    });

    expect(screen.getByTestId('openai-model-catalog')).toBeEmptyDOMElement();
    expect(onSettingChange).not.toHaveBeenCalled();
});
