import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { AIContextModalEvents } from '../ui/modal-events.js';
import { AIContextModalAnimations } from '../ui/modal-animations.js';
import { AIContextModalCore } from '../ui/modal-core.js';
import { AIContextModalUI, safeDisplayText } from '../ui/modal-ui.js';

describe('terminal analysis retry controls', () => {
    let core;
    let events;
    let ui;
    let unsubscribeState;

    const setTerminalRetryState = () => {
        core.retryState = {
            isRetrying: true,
            currentAttempt: 3,
            maxRetries: 3,
            lastError: 'Malformed response',
            originalRequestData: { selectedText: 'hello' },
        };
    };

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="dualsub-modal-content">
                <div id="dualsub-selected-words"></div>
                <button id="dualsub-start-analysis"></button>
                <div id="dualsub-analysis-content">
                    <div id="dualsub-analysis-results"></div>
                </div>
            </div>
        `;

        core = new AIContextModalCore();
        core.contentElement = document.getElementById('dualsub-modal-content');
        core.isAnalyzing = true;
        core.selectedWords = new Set(['hello']);
        setTerminalRetryState();

        ui = new AIContextModalUI(core);
        ui._getLocalizedMessage = jest.fn((key) => {
            const messages = {
                aiContextAnalysisFailed: 'Analysis Failed',
                aiContextRetryButton: 'Try Again',
                aiContextClose: 'Close',
                aiContextMalformedResponse: 'Malformed response received.',
                aiContextStartAnalysis: 'Start Analysis',
            };
            return messages[key] || key;
        });
        events = new AIContextModalEvents(core, ui);
        unsubscribeState = core.store.subscribe(({ modalState }) => {
            ui._applyStateClasses(modalState);
        });
    });

    afterEach(() => {
        events?.removeEventListeners();
        unsubscribeState?.();
        document.body.replaceChildren();
    });

    test('keeps actionable Retry and Close controls after terminal failure rendering', () => {
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        const results = document.getElementById('dualsub-analysis-results');
        const buttons = results.querySelectorAll('button');

        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toHaveTextContent('Try Again');
        expect(buttons[1]).toHaveTextContent('Close');
        expect(results).toHaveTextContent('Attempts: 3/3');
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test('starts one fresh analysis lifecycle when Retry is clicked', () => {
        const attemptsSeenAtStart = [];
        events.modalController = {
            startAnalysis: jest.fn(() => {
                attemptsSeenAtStart.push(core.retryState.currentAttempt);
            }),
            closeModal: jest.fn(),
        };
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        const retryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );
        retryButton.click();
        retryButton.click();

        expect(events.modalController.startAnalysis).toHaveBeenCalledTimes(1);
        expect(attemptsSeenAtStart).toEqual([0]);
        expect(core.retryState.currentAttempt).toBe(0);
    });

    test('ends the failed analysis lifecycle through the normal Close path', () => {
        const attemptsSeenAtClose = [];
        events.modalController = {
            startAnalysis: jest.fn(),
            closeModal: jest.fn(() => {
                attemptsSeenAtClose.push(core.retryState.currentAttempt);
            }),
        };
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        const closeButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-secondary'
        );
        closeButton.click();
        closeButton.click();

        expect(events.modalController.closeModal).toHaveBeenCalledTimes(1);
        expect(attemptsSeenAtClose).toEqual([0]);
        expect(core.retryState.currentAttempt).toBe(0);
    });

    test('retries through the controller-absent legacy analysis path', async () => {
        core.selectedText = 'hello';
        const onAnalysisRequest = jest.fn();
        document.addEventListener(
            'dualsub-analyze-selection',
            onAnalysisRequest,
            { once: true }
        );
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        const retryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );
        retryButton.click();
        retryButton.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(onAnalysisRequest).toHaveBeenCalledTimes(1);
        expect(core.retryState.currentAttempt).toBe(0);
        expect(core.state).toBe('processing');
        expect(ui._terminalRetryActionCleanup).toBeNull();
    });

    test('closes through the controller-absent legacy close path', () => {
        const onCloseRequest = jest.fn();
        document.addEventListener(
            'aicontext:modal:closeRequested',
            onCloseRequest,
            { once: true }
        );
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        const closeButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-secondary'
        );
        closeButton.click();
        closeButton.click();

        expect(onCloseRequest).toHaveBeenCalledTimes(1);
        expect(core.retryState.currentAttempt).toBe(0);
        expect(core.selectedWords.size).toBe(0);
        expect(ui._terminalRetryActionCleanup).toBeNull();
    });

    test('removes stale action listeners when the terminal state is rendered again', () => {
        events.modalController = {
            startAnalysis: jest.fn(),
            closeModal: jest.fn(),
        };
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: 'first' },
            'First malformed response'
        );
        const staleRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        events._handleFinalRetryFailure(
            'request-3',
            { malformed: 'second' },
            'Second malformed response'
        );
        const currentRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        staleRetryButton.click();
        expect(core.retryState.currentAttempt).toBe(3);
        expect(events.modalController.startAnalysis).not.toHaveBeenCalled();

        currentRetryButton.click();
        currentRetryButton.click();
        expect(core.retryState.currentAttempt).toBe(0);
        expect(events.modalController.startAnalysis).toHaveBeenCalledTimes(1);

        events.modalController.startAnalysis.mockClear();
        setTerminalRetryState();
        events._handleFinalRetryFailure(
            'request-3',
            { malformed: 'third' },
            'Third malformed response'
        );
        const removedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );
        const retainedController = events.modalController;
        events.removeEventListeners();
        removedRetryButton.click();

        expect(core.retryState.currentAttempt).toBe(3);
        expect(retainedController.startAnalysis).not.toHaveBeenCalled();
    });

    test.each([
        ['selection', () => ui.showInitialState()],
        ['processing', () => ui.showProcessingState()],
        ['programmatic hidden', () => core.setState('hidden')],
    ])('releases terminal actions on a %s transition', (_name, transition) => {
        events._handleFinalRetryFailure(
            'request-3',
            { retained: 'terminal result' },
            'Malformed response'
        );
        const detachedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );
        expect(ui._terminalRetryActionCleanup).not.toBeNull();

        transition();
        detachedRetryButton.click();

        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test('releases terminal actions before the header delegates to the controller close seam', () => {
        const headerClose = document.createElement('button');
        headerClose.id = 'dualsub-modal-close';
        core.element = document.createElement('div');
        core.element.appendChild(headerClose);
        document.body.appendChild(core.element);
        events.modalController = { closeModal: jest.fn() };
        events._setupModalControlEvents();
        events._handleFinalRetryFailure(
            'request-3',
            { retained: 'terminal result' },
            'Malformed response'
        );
        const detachedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        headerClose.click();
        detachedRetryButton.click();

        expect(events.modalController.closeModal).toHaveBeenCalledTimes(1);
        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test('releases terminal actions before an overlay close', () => {
        core.element = document.createElement('div');
        core.element.className = 'dualsub-context-modal';
        events.modalController = { closeModal: jest.fn() };
        events._handleFinalRetryFailure(
            'request-3',
            { retained: 'terminal result' },
            'Malformed response'
        );
        const detachedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        events._handleOverlayClick({
            target: core.element,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });
        detachedRetryButton.click();

        expect(events.modalController.closeModal).toHaveBeenCalledTimes(1);
        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test('releases terminal actions on the controller-absent Escape close path', () => {
        core.isVisible = true;
        const onCloseRequest = jest.fn();
        document.addEventListener(
            'aicontext:modal:closeRequested',
            onCloseRequest,
            { once: true }
        );
        events._handleFinalRetryFailure(
            'request-3',
            { retained: 'terminal result' },
            'Malformed response'
        );
        const detachedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        events._handleKeyPress({ key: 'Escape', preventDefault: jest.fn() });
        detachedRetryButton.click();

        expect(onCloseRequest).toHaveBeenCalledTimes(1);
        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test('releases terminal actions when the animation/programmatic hide seam runs', () => {
        core.element = document.createElement('div');
        core.overlayElement = document.createElement('div');
        document.body.append(core.element, core.overlayElement);
        core.isVisible = true;
        const animations = new AIContextModalAnimations(core, ui);
        events._handleFinalRetryFailure(
            'request-3',
            { retained: 'terminal result' },
            'Malformed response'
        );
        const detachedRetryButton = document.querySelector(
            '.dualsub-error-actions .dualsub-btn-primary'
        );

        animations.hideModal();
        detachedRetryButton.click();

        expect(core.state).toBe('hidden');
        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(core.retryState.currentAttempt).toBe(3);
    });

    test.each([
        [
            'the modal is already marked hidden',
            () => {
                core.element = document.createElement('div');
                core.isVisible = false;
            },
        ],
        [
            'the modal container is absent',
            () => {
                core.element = null;
                core.isVisible = true;
            },
        ],
    ])(
        'releases terminal actions when hide returns early because %s',
        (_name, arrangeEarlyReturn) => {
            events._handleFinalRetryFailure(
                'request-3',
                { retained: 'terminal result' },
                'Malformed response'
            );
            const detachedRetryButton = document.querySelector(
                '.dualsub-error-actions .dualsub-btn-primary'
            );
            const animations = new AIContextModalAnimations(core, ui);
            arrangeEarlyReturn();

            animations.hideModal();
            detachedRetryButton.click();

            expect(ui._terminalRetryActionCleanup).toBeNull();
            expect(core.retryState.currentAttempt).toBe(3);
        }
    );

    test('keeps hostile failure data inert and creates no inline event attributes', () => {
        const hostileError = `</pre><img src=x onerror="alert('error')">`;
        const hostileResult = {
            payload: `<script>alert('result')</script><svg onload=alert('svg')>`,
        };

        events._handleFinalRetryFailure(
            'request-3',
            hostileResult,
            hostileError
        );

        const results = document.getElementById('dualsub-analysis-results');
        expect(results.querySelector('img, script, svg')).toBeNull();
        expect(results).toHaveTextContent(hostileError);
        expect(results).toHaveTextContent(hostileResult.payload);

        for (const element of results.querySelectorAll('*')) {
            const inlineEventAttributes = [...element.attributes].filter(
                ({ name }) => name.toLowerCase().startsWith('on')
            );
            expect(inlineEventAttributes).toHaveLength(0);
        }
    });

    test('never executes hostile coercion hooks while rendering terminal data', () => {
        const hostileText = {
            [Symbol.toPrimitive]() {
                throw new Error('primitive coercion must stay contained');
            },
            toString() {
                throw new Error('string coercion must stay contained');
            },
        };
        const hostileError = Object.create(Error.prototype);
        Object.defineProperties(hostileError, {
            message: {
                get() {
                    throw new Error('message accessor must stay contained');
                },
            },
            [Symbol.toPrimitive]: {
                value() {
                    throw new Error('error coercion must stay contained');
                },
            },
            toString: {
                value() {
                    throw new Error('error string must stay contained');
                },
            },
        });
        const hostileResult = {
            toJSON() {
                throw new Error('JSON coercion must stay contained');
            },
            [Symbol.toPrimitive]() {
                throw new Error('result coercion must stay contained');
            },
            toString() {
                throw new Error('result string must stay contained');
            },
        };
        ui._getLocalizedMessage = jest.fn(() => hostileText);

        expect(() =>
            events._handleFinalRetryFailure(
                'request-3',
                hostileResult,
                hostileError
            )
        ).not.toThrow();

        const results = document.getElementById('dualsub-analysis-results');
        expect(results.querySelector('img, script, svg')).toBeNull();
        expect(results).toHaveTextContent('Analysis Failed');
        expect(results).toHaveTextContent('[unavailable]');
        expect(results.querySelectorAll('button')).toHaveLength(2);
    });

    test('reaches terminal retry UI through hostile result-ingress metadata', () => {
        core.currentRequest = 'request-3';
        core.isAnalyzing = true;
        const nameTrap = jest.fn(() => {
            throw new Error('name getter trap');
        });
        const messageTrap = jest.fn(() => {
            throw new Error('message getter trap');
        });
        const detailOwnKeysTrap = jest.fn(() => {
            throw new Error('detail ownKeys trap');
        });
        const resultOwnKeysTrap = jest.fn(() => {
            throw new Error('result ownKeys trap');
        });
        const hostileError = {};
        Object.defineProperties(hostileError, {
            name: { get: nameTrap },
            message: { get: messageTrap },
        });
        const hostileResult = new Proxy(
            {},
            {
                ownKeys: resultOwnKeysTrap,
            }
        );
        const detail = new Proxy(
            {
                requestId: 'request-3',
                result: hostileResult,
                success: false,
                error: hostileError,
                shouldRetry: true,
            },
            {
                ownKeys: detailOwnKeysTrap,
            }
        );

        expect(() => events._handleAnalysisResult({ detail })).not.toThrow();

        const results = document.getElementById('dualsub-analysis-results');
        expect(results.querySelectorAll('button')).toHaveLength(2);
        expect(
            results.querySelectorAll(
                '.dualsub-error-actions .dualsub-btn-primary'
            )
        ).toHaveLength(1);
        expect(
            results.querySelectorAll(
                '.dualsub-error-actions .dualsub-btn-secondary'
            )
        ).toHaveLength(1);
        expect(
            results.querySelector('.dualsub-error-actions .dualsub-btn-primary')
        ).toHaveTextContent('Try Again');
        expect(
            results.querySelector(
                '.dualsub-error-actions .dualsub-btn-secondary'
            )
        ).toHaveTextContent('Close');
        expect(results).toHaveTextContent('Attempts: 3/3');
        expect(core.retryState.currentAttempt).toBe(3);
        expect(nameTrap).toHaveBeenCalledTimes(1);
        expect(messageTrap).toHaveBeenCalledTimes(1);
        expect(detailOwnKeysTrap).toHaveBeenCalledTimes(1);
        expect(resultOwnKeysTrap).toHaveBeenCalledTimes(2);
    });

    test('contains each coercion hook independently', () => {
        const primitiveTrap = jest.fn(() => {
            throw new Error('primitive trap');
        });
        const stringTrap = jest.fn(() => {
            throw new Error('string trap');
        });
        const messageTrap = jest.fn(() => {
            throw new Error('message trap');
        });
        const primitiveValue = {
            [Symbol.toPrimitive]: primitiveTrap,
        };
        const stringValue = {
            toString: stringTrap,
        };
        const messageAccessorError = new Error('hidden');
        Object.defineProperty(messageAccessorError, 'message', {
            get: messageTrap,
        });

        expect(safeDisplayText(primitiveValue)).toBe('[unavailable]');
        expect(safeDisplayText(stringValue)).toBe('[unavailable]');
        expect(safeDisplayText(messageAccessorError)).toBe('[unavailable]');
        expect(primitiveTrap).toHaveBeenCalledTimes(1);
        expect(stringTrap).toHaveBeenCalledTimes(1);
        expect(messageTrap).toHaveBeenCalledTimes(1);

        const jsonTrap = jest.fn(() => {
            throw new Error('JSON trap');
        });
        const resultPrimitiveTrap = jest.fn(() => 'must-not-run');
        expect(() =>
            ui.showTerminalRetryFailure({
                title: 'Analysis Failed',
                message: 'Malformed response received.',
                error: 'Malformed response',
                result: {
                    toJSON: jsonTrap,
                    [Symbol.toPrimitive]: resultPrimitiveTrap,
                },
                currentAttempt: 3,
                maxRetries: 3,
                retryLabel: 'Try Again',
                closeLabel: 'Close',
            })
        ).not.toThrow();
        expect(jsonTrap).toHaveBeenCalledTimes(1);
        expect(resultPrimitiveTrap).not.toHaveBeenCalled();
    });

    test('renders primitive result previews without object coercion', () => {
        const cases = [
            [undefined, 'undefined'],
            [null, 'null'],
            [42n, '42'],
            [Symbol('preview'), 'Symbol(preview)'],
            [true, 'true'],
        ];

        for (const [result, expectedPreview] of cases) {
            ui.showTerminalRetryFailure({
                title: 'Analysis Failed',
                message: 'Malformed response received.',
                error: 'Malformed response',
                result,
                currentAttempt: 3,
                maxRetries: 3,
                retryLabel: 'Try Again',
                closeLabel: 'Close',
            });

            expect(
                document.querySelector('#dualsub-analysis-results pre')
            ).toHaveTextContent(`Result Preview: ${expectedPreview}`);
        }
    });

    test('contains throwing terminal-detail accessors and bounds display text', () => {
        const details = {
            currentAttempt: 3,
            maxRetries: 3,
            onRetry: jest.fn(),
            onClose: jest.fn(),
        };
        for (const key of [
            'title',
            'message',
            'error',
            'result',
            'retryLabel',
            'closeLabel',
        ]) {
            Object.defineProperty(details, key, {
                get() {
                    throw new Error(`${key} accessor must stay contained`);
                },
            });
        }

        expect(() => ui.showTerminalRetryFailure(details)).not.toThrow();

        const results = document.getElementById('dualsub-analysis-results');
        expect(results.querySelector('h4')).toHaveTextContent(
            'Analysis Failed'
        );
        expect(results.querySelector('p')).toHaveTextContent('[unavailable]');
        expect(results.querySelector('.dualsub-btn-primary')).toHaveTextContent(
            'Try Again'
        );
        expect(
            results.querySelector('.dualsub-btn-secondary')
        ).toHaveTextContent('Close');

        ui.showTerminalRetryFailure({
            title: 't'.repeat(5000),
            message: 'm'.repeat(5000),
            error: 'e'.repeat(5000),
            result: 'r'.repeat(5000),
            currentAttempt: 3,
            maxRetries: 3,
            retryLabel: 'y'.repeat(5000),
            closeLabel: 'n'.repeat(5000),
        });
        expect(
            results.querySelector('h4').textContent.length
        ).toBeLessThanOrEqual(200);
        expect(
            results.querySelector('p').textContent.length
        ).toBeLessThanOrEqual(2000);
        expect(
            results.querySelector('.dualsub-btn-primary').textContent.length
        ).toBeLessThanOrEqual(200);
        expect(
            results
                .querySelector('pre')
                .textContent.split('Result Preview: ')[1].length
        ).toBeLessThanOrEqual(500);
    });

    test('leaves a coherent display state when the results container is missing', () => {
        core.element = document.createElement('div');
        core.element.classList.add('dualsub-processing-disabled');
        core.contentElement.classList.add(
            'dualsub-processing-active',
            'dualsub-processing-sticky'
        );
        const startButton = document.getElementById('dualsub-start-analysis');
        startButton.className = 'dualsub-analysis-button processing';
        startButton.dataset.pausedToggle = 'true';
        startButton.textContent = 'Pause';
        document.getElementById('dualsub-analysis-results').remove();
        core.setState('processing');

        events._handleFinalRetryFailure(
            'request-3',
            { malformed: true },
            'Malformed response'
        );

        expect(core.state).toBe('display');
        expect(core.isAnalyzing).toBe(false);
        expect(core.contentElement).not.toHaveClass(
            'dualsub-processing-active',
            'dualsub-processing-sticky'
        );
        expect(core.element).not.toHaveClass('dualsub-processing-disabled');
        const resetButton = document.getElementById('dualsub-start-analysis');
        expect(resetButton).toHaveTextContent('Start Analysis');
        expect(resetButton).not.toHaveAttribute('data-paused-toggle');
        expect(core.retryState.currentAttempt).toBe(3);
        expect(ui._terminalRetryActionCleanup).toBeNull();
    });
});
