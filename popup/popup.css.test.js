import fs from 'node:fs';

const popupStyles = fs.readFileSync(
    new URL('./popup.css', import.meta.url),
    'utf8'
);

function parseStyleSheet(cssText) {
    const style = document.createElement('style');
    style.textContent = cssText;
    document.head.append(style);
    return style.sheet;
}

function findStyleRule(rules, selector) {
    return [...rules].find((rule) => rule.selectorText === selector);
}

describe('popup range focus styles', () => {
    test('show a token-based keyboard focus ring that remains visible in forced colors', () => {
        const styleSheet = parseStyleSheet(popupStyles);
        const rangeRule = findStyleRule(
            styleSheet.cssRules,
            "input[type='range']"
        );
        const focusVisibleRule = findStyleRule(
            styleSheet.cssRules,
            "input[type='range']:focus-visible"
        );
        const forcedColorsRule = [...styleSheet.cssRules].find(
            (rule) => rule.conditionText === '(forced-colors: active)'
        );
        const forcedColorsFocusRule = forcedColorsRule
            ? findStyleRule(
                  forcedColorsRule.cssRules,
                  "input[type='range']:focus-visible"
              )
            : undefined;

        expect(rangeRule.style.getPropertyValue('outline')).toBe('none');
        expect(focusVisibleRule).toBeDefined();
        expect(focusVisibleRule.style.getPropertyValue('outline')).toBe(
            '2px solid var(--slider-progress-bg)'
        );
        expect(focusVisibleRule.style.getPropertyValue('outline-offset')).toBe(
            '4px'
        );
        expect(forcedColorsFocusRule).toBeDefined();
        expect(
            forcedColorsFocusRule.style.getPropertyValue('outline-color')
        ).toBe('Highlight');
    });
});
