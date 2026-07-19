import { describe, expect, jest, test } from '@jest/globals';
import { AIContextModalUI, sanitizeAnalysisHtml } from '../ui/modal-ui.js';
import { MODAL_STATES } from '../core/constants.js';

describe('AIContextModalUI safe rendering', () => {
    test('keeps formatter markup but removes executable HTML', () => {
        const sanitized = sanitizeAnalysisHtml(`
            <div class="dualsub-analysis-section attacker" onclick="alert(1)">
                <h4>Meaning</h4>
                <p><strong>safe</strong><img src=x onerror='alert(2)'></p>
                <script>alert(3)</script>
                <a href="javascript:alert(4)">link text</a>
            </div>
        `);
        const template = document.createElement('template');
        template.innerHTML = sanitized;

        expect(template.content.querySelector('script')).toBeNull();
        expect(template.content.querySelector('img')).toBeNull();
        expect(template.content.querySelector('a')).toBeNull();
        expect(template.content.querySelector('[onclick]')).toBeNull();
        expect(template.content.querySelector('div').className).toBe(
            'dualsub-analysis-section'
        );
        expect(template.content.textContent).toContain('safe');
        expect(template.content.textContent).toContain('link text');
        expect(template.content.textContent).not.toContain('alert(3)');
    });

    test('renders selected subtitle text without interpreting markup', () => {
        document.body.innerHTML = `
            <div id="dualsub-selected-words"></div>
            <button id="dualsub-start-analysis"></button>
        `;
        const unsafeWord = `"><img src=x onerror='alert(1)'>`;
        const core = {
            contentElement: document.body,
            selectedWordPositions: new Map(),
            selectedWords: new Set([unsafeWord]),
            selectedWordsOrder: [],
            isAnalyzing: false,
        };
        const ui = new AIContextModalUI(core);

        ui.updateSelectionDisplay();

        const selectedWord = document.querySelector('.dualsub-selected-word');
        expect(document.querySelector('img')).toBeNull();
        expect(selectedWord.dataset.word).toBe(unsafeWord);
        expect(selectedWord.textContent).toContain(unsafeWord);
    });

    test('renders errors as text and keeps the close action', () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            contentElement: document.body,
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        ui._getLocalizedMessage = jest.fn((key) => key);
        const onClose = jest.fn();
        document.addEventListener('aicontext:modal:closeRequested', onClose, {
            once: true,
        });

        ui.showErrorState(`<img src=x onerror='alert(1)'>failed`);

        expect(
            document.querySelector('#dualsub-analysis-results img')
        ).toBeNull();
        expect(document.querySelector('.dualsub-error p')).toHaveTextContent(
            `<img src=x onerror='alert(1)'>failed`
        );
        document.querySelector('.dualsub-error button').click();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(core.setState).toHaveBeenCalledWith(MODAL_STATES.ERROR);
    });
});
