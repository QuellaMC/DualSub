import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

const configService = {
    getAll: jest.fn().mockResolvedValue({ openaiModel: 'initial' }),
    onChanged: jest.fn().mockReturnValue(() => {}),
    set: jest.fn(),
    setMultiple: jest.fn(),
};

jest.unstable_mockModule('../../services/configService.js', () => ({
    configService,
}));

const { useSettings } = await import('./useSettings.js');

describe('useSettings write ordering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configService.getAll.mockResolvedValue({ openaiModel: 'initial' });
    });

    test('serializes rapid writes and keeps the newest input rendered and persisted', async () => {
        const pendingWrites = [];
        let storageChangeListener;
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        configService.set.mockImplementation(
            (key, value) =>
                new Promise((resolve) => {
                    pendingWrites.push({ key, value, resolve });
                })
        );
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstWrite;
        let secondWrite;
        await act(async () => {
            firstWrite = result.current.updateSetting(
                'openaiModel',
                'older-value'
            );
            secondWrite = result.current.updateSetting(
                'openaiModel',
                'newest-value'
            );
            await Promise.resolve();
        });

        expect(result.current.settings.openaiModel).toBe('newest-value');
        expect(pendingWrites).toHaveLength(1);
        expect(pendingWrites[0]).toMatchObject({ value: 'older-value' });

        await act(async () => {
            pendingWrites[0].resolve();
            await firstWrite;
        });
        await waitFor(() => expect(pendingWrites).toHaveLength(2));
        expect(pendingWrites[1]).toMatchObject({ value: 'newest-value' });

        act(() => {
            storageChangeListener({ openaiModel: 'older-value' });
        });
        expect(result.current.settings.openaiModel).toBe('newest-value');

        await act(async () => {
            pendingWrites[1].resolve();
            await secondWrite;
        });

        expect(configService.set.mock.calls).toEqual([
            ['openaiModel', 'older-value'],
            ['openaiModel', 'newest-value'],
        ]);
        expect(result.current.settings.openaiModel).toBe('newest-value');
    });
});
