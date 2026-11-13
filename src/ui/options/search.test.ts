import { describe, expect, it } from 'vitest';
import { searchSettings } from './search';

const SPANISH: Record<string, string> = {
    sitesHideTitle: 'Ocultar los subtítulos propios del sitio',
    searchWordsHide: 'dos veces doble repetidos',
    lookSizeTitle: 'Tamaño del texto',
    searchWordsSize: 'grande pequeño letra',
    languagesOfficialTitle: 'Usar la traducción oficial',
    translationAiSetupTitle: 'Configurar la traducción con IA',
};

const t = (key: string): string => SPANISH[key] ?? '';

function labels(query: string): string[] {
    return searchSettings(query, t).map((entry) => entry.labelKey);
}

describe('searchSettings', () => {
    it('finds a setting by its label or by the everyday words of the page language', () => {
        expect(labels('ocultar')).toEqual(['sitesHideTitle']);
        expect(labels('dos veces')).toEqual(['sitesHideTitle']);
        expect(labels('LETRA grande')).toEqual(['lookSizeTitle']);
    });

    it('puts the settings where a typed word starts a word first', () => {
        expect(labels('ia')).toEqual([
            'translationAiSetupTitle',
            'languagesOfficialTitle',
        ]);
    });

    it('needs every word typed', () => {
        expect(labels('doble grande')).toEqual([]);
        expect(labels('   ')).toEqual([]);
    });
});
