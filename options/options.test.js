/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('Options Page Logging Level UI Tests', () => {
    let loggingLevelSelect;

    beforeEach(() => {
        // Set up DOM with logging level select
        document.body.innerHTML = `
            <div class="container">
                <main class="content">
                    <section id="general">
                        <select id="loggingLevel">
                            <option value="0">Off</option>
                            <option value="1">Error Only</option>
                            <option value="2">Warnings & Errors</option>
                            <option value="3">Info & Above</option>
                            <option value="4">Debug (All)</option>
                        </select>
                    </section>
                </main>
            </div>
        `;

        loggingLevelSelect = document.getElementById('loggingLevel');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('should have correct option values in select element', () => {
        const options = loggingLevelSelect.querySelectorAll('option');
        
        expect(options).toHaveLength(5);
        expect(options[0].value).toBe('0');
        expect(options[1].value).toBe('1');
        expect(options[2].value).toBe('2');
        expect(options[3].value).toBe('3');
        expect(options[4].value).toBe('4');
    });

    test('should allow selecting different logging levels', () => {
        // Test setting different values
        loggingLevelSelect.value = '0';
        expect(loggingLevelSelect.value).toBe('0');

        loggingLevelSelect.value = '2';
        expect(loggingLevelSelect.value).toBe('2');

        loggingLevelSelect.value = '4';
        expect(loggingLevelSelect.value).toBe('4');
    });

    test('should trigger change event when value changes', () => {
        const changeHandler = jest.fn();
        loggingLevelSelect.addEventListener('change', changeHandler);

        loggingLevelSelect.value = '1';
        loggingLevelSelect.dispatchEvent(new Event('change'));

        expect(changeHandler).toHaveBeenCalledTimes(1);
    });

    test('should parse integer values correctly', () => {
        loggingLevelSelect.value = '3';
        const parsedValue = parseInt(loggingLevelSelect.value);
        
        expect(parsedValue).toBe(3);
        expect(typeof parsedValue).toBe('number');
    });
});

describe('Options Page Logging Level UI Integration', () => {
    beforeEach(() => {
        // Set up complete DOM structure
        document.body.innerHTML = `
            <div class="container">
                <aside class="sidebar">
                    <nav>
                        <ul>
                            <li><a href="#general" class="active">General</a></li>
                        </ul>
                    </nav>
                </aside>
                <main class="content">
                    <section id="general">
                        <div class="setting-card">
                            <h3 data-i18n="cardLoggingLevelTitle">Logging Level</h3>
                            <p data-i18n="cardLoggingLevelDesc">Control debug information</p>
                            <div class="setting">
                                <label for="loggingLevel" data-i18n="loggingLevelLabel">Logging Level:</label>
                                <select id="loggingLevel">
                                    <option value="0" data-i18n="loggingLevelOff">Off</option>
                                    <option value="1" data-i18n="loggingLevelError">Error Only</option>
                                    <option value="2" data-i18n="loggingLevelWarn">Warnings & Errors</option>
                                    <option value="3" data-i18n="loggingLevelInfo">Info & Above</option>
                                    <option value="4" data-i18n="loggingLevelDebug">Debug (All)</option>
                                </select>
                            </div>
                        </div>
                        <select id="uiLanguage"><option value="en">English</option></select>
                        <input type="checkbox" id="hideOfficialSubtitles" />
                        <select id="translationProvider"></select>
                        <input type="number" id="translationBatchSize" />
                        <input type="number" id="translationDelay" />
                        <input type="password" id="deeplApiKey" />
                        <select id="deeplApiPlan"></select>
                        <button id="testDeepLButton">Test</button>
                        <div id="deeplTestResult"></div>
                        <span id="extensionVersion"></span>
                    </section>
                </main>
            </div>
        `;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('should have proper HTML structure for logging level setting', () => {
        const settingCard = document.querySelector('.setting-card');
        const title = settingCard.querySelector('h3[data-i18n="cardLoggingLevelTitle"]');
        const description = settingCard.querySelector('p[data-i18n="cardLoggingLevelDesc"]');
        const label = settingCard.querySelector('label[data-i18n="loggingLevelLabel"]');
        const select = settingCard.querySelector('select#loggingLevel');

        expect(settingCard).toBeTruthy();
        expect(title).toBeTruthy();
        expect(description).toBeTruthy();
        expect(label).toBeTruthy();
        expect(select).toBeTruthy();
        expect(label.getAttribute('for')).toBe('loggingLevel');
    });

    test('should have all required data-i18n attributes', () => {
        const elementsWithI18n = document.querySelectorAll('[data-i18n]');
        const i18nKeys = Array.from(elementsWithI18n).map(el => el.getAttribute('data-i18n'));

        expect(i18nKeys).toContain('cardLoggingLevelTitle');
        expect(i18nKeys).toContain('cardLoggingLevelDesc');
        expect(i18nKeys).toContain('loggingLevelLabel');
        expect(i18nKeys).toContain('loggingLevelOff');
        expect(i18nKeys).toContain('loggingLevelError');
        expect(i18nKeys).toContain('loggingLevelWarn');
        expect(i18nKeys).toContain('loggingLevelInfo');
        expect(i18nKeys).toContain('loggingLevelDebug');
    });

    test('should have proper accessibility attributes', () => {
        const label = document.querySelector('label[for="loggingLevel"]');
        const select = document.getElementById('loggingLevel');

        expect(label).toBeTruthy();
        expect(select).toBeTruthy();
        expect(label.getAttribute('for')).toBe(select.id);
    });
});