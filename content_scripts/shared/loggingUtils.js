/**
 * Provides comprehensive logging utilities for the DualSub Extension, including
 * specialized loggers for navigation events, subtitle processing diagnostics,
 * and performance monitoring.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * A specialized logger for navigation events and initialization sequences.
 */
export class NavigationLogger {
    /**
     * Creates a new `NavigationLogger` instance.
     * @param {string} platform - The platform name (e.g., 'netflix', 'disneyplus').
     * @param {Object} [config={}] - Configuration for the logger.
     * @param {Function} [config.logger] - The base logger function to use.
     * @param {boolean} [config.enablePerformanceTracking=true] - Whether to enable performance tracking.
     */
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = {
            logger: null,
            enablePerformanceTracking: true,
            ...config
        };

        // Navigation state tracking
        this.navigationState = {
            currentUrl: null,
            previousUrl: null,
            lastNavigationTime: null,
            navigationCount: 0,
            playerPageEntries: 0,
            playerPageExits: 0
        };

        // Performance tracking
        this.performanceMetrics = {
            initializationStartTime: null,
            initializationEndTime: null,
            totalInitializationTime: 0,
            navigationDetectionTimes: [],
            playerReadyTimes: [],
            averageNavigationTime: 0,
            averagePlayerReadyTime: 0
        };

        // Initialization sequence tracking
        this.initializationSteps = new Map();
        this.currentInitializationId = null;
    }

    /**
     * Logs navigation detection events, including URL changes and timing information.
     * @param {string} fromUrl - The previous URL.
     * @param {string} toUrl - The new URL.
     * @param {Object} [additionalData={}] - Additional context to include in the log.
     */
    logNavigationDetection(fromUrl, toUrl, additionalData = {}) {
        const navigationTime = Date.now();
        const timeSinceLastNavigation = this.navigationState.lastNavigationTime 
            ? navigationTime - this.navigationState.lastNavigationTime 
            : 0;

        // Update navigation state
        this.navigationState.previousUrl = this.navigationState.currentUrl;
        this.navigationState.currentUrl = toUrl;
        this.navigationState.lastNavigationTime = navigationTime;
        this.navigationState.navigationCount++;

        // Track navigation timing
        if (this.config.enablePerformanceTracking && timeSinceLastNavigation > 0) {
            this.performanceMetrics.navigationDetectionTimes.push(timeSinceLastNavigation);
            this.performanceMetrics.averageNavigationTime = 
                this.performanceMetrics.navigationDetectionTimes.reduce((a, b) => a + b, 0) / 
                this.performanceMetrics.navigationDetectionTimes.length;
        }

        this._logNavigation('info', 'Navigation detected', {
            navigation: {
                from: fromUrl,
                to: toUrl,
                navigationTime,
                timeSinceLastNavigation: timeSinceLastNavigation > 0 ? `${timeSinceLastNavigation}ms` : 'first navigation',
                navigationCount: this.navigationState.navigationCount,
                urlChanged: fromUrl !== toUrl,
                pathChanged: this._extractPath(fromUrl) !== this._extractPath(toUrl),
                isPlayerPage: this._isPlayerPage(toUrl),
                wasPlayerPage: this._isPlayerPage(fromUrl)
            },
            performance: this.config.enablePerformanceTracking ? {
                averageNavigationTime: `${this.performanceMetrics.averageNavigationTime.toFixed(2)}ms`,
                totalNavigations: this.performanceMetrics.navigationDetectionTimes.length
            } : null,
            ...additionalData
        });
    }

    /**
     * Logs the progress of an initialization sequence, step by step.
     * @param {string} initializationId - A unique identifier for the initialization sequence.
     * @param {string} step - The name of the current step.
     * @param {string} status - The status of the step ('started', 'completed', 'failed').
     * @param {Object} [stepData={}] - Additional data specific to the step.
     */
    logInitializationStep(initializationId, step, status, stepData = {}) {
        const stepTime = Date.now();
        
        // Initialize tracking for new initialization sequence
        if (!this.initializationSteps.has(initializationId)) {
            this.initializationSteps.set(initializationId, {
                startTime: stepTime,
                steps: [],
                currentStep: null,
                completed: false,
                failed: false
            });
            this.currentInitializationId = initializationId;
            this.performanceMetrics.initializationStartTime = stepTime;
        }

        const initSequence = this.initializationSteps.get(initializationId);
        
        // Update step tracking
        if (status === 'started') {
            initSequence.currentStep = step;
            initSequence.steps.push({
                name: step,
                startTime: stepTime,
                endTime: null,
                duration: null,
                status: 'in_progress',
                data: stepData
            });
        } else {
            // Find and update the step
            const stepIndex = initSequence.steps.findIndex(s => s.name === step && s.status === 'in_progress');
            if (stepIndex >= 0) {
                const stepRecord = initSequence.steps[stepIndex];
                stepRecord.endTime = stepTime;
                stepRecord.duration = stepTime - stepRecord.startTime;
                stepRecord.status = status;
                stepRecord.data = { ...stepRecord.data, ...stepData };
            }
        }

        // Check if initialization is complete
        if (status === 'completed' && step === 'final_validation') {
            initSequence.completed = true;
            this.performanceMetrics.initializationEndTime = stepTime;
            this.performanceMetrics.totalInitializationTime = stepTime - initSequence.startTime;
        } else if (status === 'failed') {
            initSequence.failed = true;
            initSequence.failedStep = step;
        }

        this._logNavigation('info', `Initialization step ${status}`, {
            initialization: {
                id: initializationId,
                step,
                status,
                stepTime,
                stepDuration: status !== 'started' && initSequence.steps.length > 0 
                    ? `${initSequence.steps[initSequence.steps.findIndex(s => s.name === step)]?.duration || 0}ms`
                    : null,
                totalSteps: initSequence.steps.length,
                completedSteps: initSequence.steps.filter(s => s.status === 'completed').length,
                failedSteps: initSequence.steps.filter(s => s.status === 'failed').length,
                currentStep: initSequence.currentStep,
                isComplete: initSequence.completed,
                hasFailed: initSequence.failed
            },
            stepData,
            performance: this.config.enablePerformanceTracking ? {
                totalInitTime: initSequence.completed 
                    ? `${this.performanceMetrics.totalInitializationTime}ms`
                    : `${stepTime - initSequence.startTime}ms (ongoing)`,
                averageStepTime: initSequence.steps.length > 0
                    ? `${(initSequence.steps.reduce((sum, s) => sum + (s.duration || 0), 0) / initSequence.steps.length).toFixed(2)}ms`
                    : '0ms'
            } : null
        });
    }

    /**
     * Logs events related to player ready detection and subtitle system setup.
     * @param {string} event - The type of event (e.g., 'detection_started', 'player_ready').
     * @param {Object} [eventData={}] - Additional data specific to the event.
     */
    logPlayerReadyDetection(event, eventData = {}) {
        const eventTime = Date.now();
        
        // Track player ready timing
        if (event === 'detection_started') {
            this.playerReadyStartTime = eventTime;
        } else if (event === 'player_ready' && this.playerReadyStartTime) {
            const readyTime = eventTime - this.playerReadyStartTime;
            this.performanceMetrics.playerReadyTimes.push(readyTime);
            this.performanceMetrics.averagePlayerReadyTime = 
                this.performanceMetrics.playerReadyTimes.reduce((a, b) => a + b, 0) / 
                this.performanceMetrics.playerReadyTimes.length;
        }

        this._logNavigation('info', `Player ready detection: ${event}`, {
            playerReady: {
                event,
                eventTime,
                detectionDuration: this.playerReadyStartTime 
                    ? `${eventTime - this.playerReadyStartTime}ms`
                    : null,
                isTimeout: event === 'detection_timeout',
                isReady: event === 'player_ready',
                setupComplete: event === 'setup_complete'
            },
            eventData,
            performance: this.config.enablePerformanceTracking ? {
                averagePlayerReadyTime: `${this.performanceMetrics.averagePlayerReadyTime.toFixed(2)}ms`,
                totalDetections: this.performanceMetrics.playerReadyTimes.length,
                fastestDetection: this.performanceMetrics.playerReadyTimes.length > 0
                    ? `${Math.min(...this.performanceMetrics.playerReadyTimes)}ms`
                    : null,
                slowestDetection: this.performanceMetrics.playerReadyTimes.length > 0
                    ? `${Math.max(...this.performanceMetrics.playerReadyTimes)}ms`
                    : null
            } : null
        });
    }

    /**
     * Logs diagnostic information for troubleshooting navigation issues.
     * @param {string} issue - A description of the issue.
     * @param {Object} [diagnosticData={}] - Additional diagnostic information.
     * @param {string} [severity='warn'] - The severity level of the log.
     */
    logNavigationDiagnostic(issue, diagnosticData = {}, severity = 'warn') {
        this._logNavigation(severity, `Navigation diagnostic: ${issue}`, {
            diagnostic: {
                issue,
                timestamp: Date.now(),
                currentState: {
                    url: window.location.href,
                    pathname: window.location.pathname,
                    readyState: document.readyState,
                    visibilityState: document.visibilityState
                },
                navigationState: this.navigationState,
                extensionContext: {
                    hasChrome: typeof chrome !== 'undefined',
                    hasRuntime: typeof chrome?.runtime !== 'undefined',
                    runtimeId: chrome?.runtime?.id || null
                }
            },
            diagnosticData,
            troubleshooting: {
                commonIssues: [
                    'Extension context invalidated',
                    'DOM not ready during navigation',
                    'Player element not found',
                    'Event listeners not attached',
                    'Timing issues with SPA navigation'
                ],
                suggestedActions: [
                    'Check extension context validity',
                    'Verify DOM ready state',
                    'Retry initialization with delay',
                    'Re-attach event listeners',
                    'Validate player element existence'
                ]
            }
        });
    }

    /**
     * Gets a comprehensive performance report for navigation events.
     * @returns {Object} A performance report object.
     */
    getPerformanceReport() {
        const report = {
            platform: this.platform,
            reportTime: Date.now(),
            navigationMetrics: {
                totalNavigations: this.navigationState.navigationCount,
                playerPageEntries: this.navigationState.playerPageEntries,
                playerPageExits: this.navigationState.playerPageExits,
                averageNavigationTime: `${this.performanceMetrics.averageNavigationTime.toFixed(2)}ms`,
                navigationTimeRange: this.performanceMetrics.navigationDetectionTimes.length > 0 ? {
                    fastest: `${Math.min(...this.performanceMetrics.navigationDetectionTimes)}ms`,
                    slowest: `${Math.max(...this.performanceMetrics.navigationDetectionTimes)}ms`
                } : null
            },
            initializationMetrics: {
                totalInitializations: this.initializationSteps.size,
                completedInitializations: Array.from(this.initializationSteps.values()).filter(init => init.completed).length,
                failedInitializations: Array.from(this.initializationSteps.values()).filter(init => init.failed).length,
                averageInitializationTime: this.performanceMetrics.totalInitializationTime > 0 
                    ? `${this.performanceMetrics.totalInitializationTime}ms`
                    : 'N/A'
            },
            playerReadyMetrics: {
                totalDetections: this.performanceMetrics.playerReadyTimes.length,
                averageReadyTime: `${this.performanceMetrics.averagePlayerReadyTime.toFixed(2)}ms`,
                readyTimeRange: this.performanceMetrics.playerReadyTimes.length > 0 ? {
                    fastest: `${Math.min(...this.performanceMetrics.playerReadyTimes)}ms`,
                    slowest: `${Math.max(...this.performanceMetrics.playerReadyTimes)}ms`
                } : null
            }
        };

        this._logNavigation('info', 'Navigation performance report generated.', { report });
        return report;
    }

    /**
     * Resets all performance metrics to their initial state.
     */
    resetMetrics() {
        this.performanceMetrics = {
            initializationStartTime: null,
            initializationEndTime: null,
            totalInitializationTime: 0,
            navigationDetectionTimes: [],
            playerReadyTimes: [],
            averageNavigationTime: 0,
            averagePlayerReadyTime: 0
        };
        
        this.initializationSteps.clear();
        this.currentInitializationId = null;
        
        this._logNavigation('info', 'Performance metrics have been reset.');
    }

    // ========================================
    // PRIVATE HELPER METHODS
    // ========================================

    /**
     * A specialized logging function for navigation events.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data={}] - Additional data to log.
     */
    _logNavigation(level, message, data = {}) {
        const enhancedData = {
            ...data,
            timestamp: new Date().toISOString(),
            platform: this.platform,
            logType: 'navigation',
            context: {
                url: window.location.href,
                pathname: window.location.pathname,
                readyState: document.readyState,
                visibilityState: document.visibilityState
            }
        };

        if (this.config.logger) {
            this.config.logger(level, `[NavigationLogger:${this.platform}] ${message}`, enhancedData);
        } else {
            console.log(`[NavigationLogger:${this.platform}] [${level.toUpperCase()}] ${message}`, enhancedData);
        }
    }

    /**
     * Extracts the pathname from a URL.
     * @private
     * @param {string} url - The URL to extract the path from.
     * @returns {string} The pathname.
     */
    _extractPath(url) {
        try {
            return new URL(url).pathname;
        } catch {
            return url || '';
        }
    }

    /**
     * Checks if a URL corresponds to a player page.
     * @private
     * @param {string} url - The URL to check.
     * @returns {boolean} `true` if the URL is for a player page, otherwise `false`.
     */
    _isPlayerPage(url) {
        if (!url) return false;
        
        const pathname = this._extractPath(url);
        
        // Platform-specific player page detection
        switch (this.platform.toLowerCase()) {
            case 'netflix':
                return pathname.includes('/watch/');
            case 'disneyplus':
                return pathname.includes('/video/') || pathname.includes('/movies/') || pathname.includes('/series/');
            default:
                return pathname.includes('/watch') || pathname.includes('/video') || pathname.includes('/player');
        }
    }
}

/**
 * Provides comprehensive diagnostic logging for subtitle functionality.
 */
export class SubtitleDiagnostics {
    /**
     * Creates a new `SubtitleDiagnostics` instance.
     * @param {string} platform - The platform name.
     * @param {Object} [config={}] - Configuration for the logger.
     */
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = {
            logger: null,
            enableDetailedLogging: true,
            ...config
        };

        // Diagnostic state
        this.diagnosticHistory = [];
        this.errorPatterns = new Map();
        this.performanceBaseline = {
            averageProcessingTime: 0,
            averageDisplayTime: 0,
            successRate: 0
        };
    }

    /**
     * Logs subtitle detection events with source information.
     * @param {string} source - The source of the subtitles ('official', 'api', 'none').
     * @param {Object} [detectionData={}] - Additional data about the detection.
     */
    logSubtitleDetection(source, detectionData = {}) {
        const detection = {
            timestamp: Date.now(),
            source,
            platform: this.platform,
            ...detectionData
        };

        this.diagnosticHistory.push({
            type: 'detection',
            ...detection
        });

        this._logDiagnostic('info', `Subtitle source detected: ${source}`, {
            detection,
            availability: {
                hasOfficial: detectionData.hasOfficial || false,
                hasAPI: detectionData.hasAPI || false,
                userPreference: detectionData.userPreference || null
            }
        });
    }

    /**
     * Logs subtitle display attempts and their results, including any errors.
     * @param {boolean} success - Whether the display was successful.
     * @param {Object} [displayData={}] - Data related to the display attempt.
     * @param {Error|null} [error=null] - The error if the display failed.
     */
    logDisplayAttempt(success, displayData = {}, error = null) {
        const attempt = {
            timestamp: Date.now(),
            success,
            platform: this.platform,
            ...displayData
        };

        let errorKey;
        if (error) {
            attempt.error = {
                message: error.message,
                stack: error.stack,
                name: error.name
            };

            errorKey = `${error.name}:${error.message}`;
            this.errorPatterns.set(errorKey, (this.errorPatterns.get(errorKey) || 0) + 1);
        }

        this.diagnosticHistory.push({
            type: 'display_attempt',
            ...attempt
        });

        const logLevel = success ? 'info' : 'error';
        const message = success ? 'Subtitle display successful' : 'Subtitle display failed';

        this._logDiagnostic(logLevel, message, {
            attempt,
            errorPatterns: error ? {
                currentError: errorKey,
                occurrenceCount: this.errorPatterns.get(errorKey),
                totalUniqueErrors: this.errorPatterns.size,
                mostCommonErrors: Array.from(this.errorPatterns.entries())
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([pattern, count]) => ({ pattern, count }))
            } : null
        });
    }

    /**
     * Logs performance timing for subtitle-related operations.
     * @param {string} operation - The name of the operation being timed.
     * @param {number} duration - The duration of the operation in milliseconds.
     * @param {Object} [operationData={}] - Additional data specific to the operation.
     */
    logPerformanceTiming(operation, duration, operationData = {}) {
        const timing = {
            timestamp: Date.now(),
            operation,
            duration,
            platform: this.platform,
            ...operationData
        };

        this.diagnosticHistory.push({
            type: 'performance_timing',
            ...timing
        });

        // Update performance baseline
        this._updatePerformanceBaseline(operation, duration);

        this._logDiagnostic('debug', `Performance timing: ${operation}`, {
            timing,
            baseline: {
                currentDuration: `${duration}ms`,
                averageForOperation: this._getAverageForOperation(operation),
                performanceRating: this._getPerformanceRating(operation, duration)
            }
        });
    }

    /**
     * Generates a comprehensive diagnostic report for subtitle functionality.
     * @returns {Object} A diagnostic report object.
     */
    generateDiagnosticReport() {
        const now = Date.now();
        const recentHistory = this.diagnosticHistory.filter(entry => now - entry.timestamp < 300000); // Last 5 minutes

        const report = {
            platform: this.platform,
            reportTime: now,
            summary: {
                totalEvents: this.diagnosticHistory.length,
                recentEvents: recentHistory.length,
                detectionEvents: this.diagnosticHistory.filter(e => e.type === 'detection').length,
                displayAttempts: this.diagnosticHistory.filter(e => e.type === 'display_attempt').length,
                successfulDisplays: this.diagnosticHistory.filter(e => e.type === 'display_attempt' && e.success).length,
                failedDisplays: this.diagnosticHistory.filter(e => e.type === 'display_attempt' && !e.success).length,
                performanceEvents: this.diagnosticHistory.filter(e => e.type === 'performance_timing').length
            },
            errorAnalysis: {
                uniqueErrorPatterns: this.errorPatterns.size,
                totalErrors: Array.from(this.errorPatterns.values()).reduce((sum, count) => sum + count, 0),
                topErrors: Array.from(this.errorPatterns.entries())
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([pattern, count]) => ({ pattern, count, percentage: ((count / this.diagnosticHistory.length) * 100).toFixed(2) + '%' }))
            },
            performanceAnalysis: {
                averageProcessingTime: this.performanceBaseline.averageProcessingTime,
                averageDisplayTime: this.performanceBaseline.averageDisplayTime,
                successRate: this.performanceBaseline.successRate,
                recentPerformance: this._analyzeRecentPerformance(recentHistory)
            },
            recommendations: this._generateRecommendations()
        };

        this._logDiagnostic('info', 'Diagnostic report generated.', { report });
        return report;
    }

    // ========================================
    // PRIVATE HELPER METHODS
    // ========================================

    /**
     * A specialized logging function for diagnostic information.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data={}] - Additional data to log.
     */
    _logDiagnostic(level, message, data = {}) {
        const enhancedData = {
            ...data,
            timestamp: new Date().toISOString(),
            platform: this.platform,
            logType: 'diagnostic'
        };

        if (this.config.logger) {
            this.config.logger(level, `[SubtitleDiagnostics:${this.platform}] ${message}`, enhancedData);
        } else {
            console.log(`[SubtitleDiagnostics:${this.platform}] [${level.toUpperCase()}] ${message}`, enhancedData);
        }
    }

    /**
     * Updates the performance baseline metrics.
     * @private
     * @param {string} operation - The name of the operation.
     * @param {number} duration - The duration of the operation in milliseconds.
     */
    _updatePerformanceBaseline(operation, duration) {
        const operationTimings = this.diagnosticHistory
            .filter(e => e.type === 'performance_timing' && e.operation === operation)
            .map(e => e.duration);

        if (operationTimings.length > 0) {
            const average = operationTimings.reduce((sum, d) => sum + d, 0) / operationTimings.length;
            
            if (operation.includes('processing')) {
                this.performanceBaseline.averageProcessingTime = average;
            } else if (operation.includes('display')) {
                this.performanceBaseline.averageDisplayTime = average;
            }
        }

        // Update success rate
        const displayAttempts = this.diagnosticHistory.filter(e => e.type === 'display_attempt');
        const successfulAttempts = displayAttempts.filter(e => e.success);
        this.performanceBaseline.successRate = displayAttempts.length > 0 
            ? (successfulAttempts.length / displayAttempts.length) * 100
            : 0;
    }

    /**
     * Gets the average duration for a specific operation.
     * @private
     * @param {string} operation - The name of the operation.
     * @returns {string} The average duration as a formatted string.
     */
    _getAverageForOperation(operation) {
        const operationTimings = this.diagnosticHistory
            .filter(e => e.type === 'performance_timing' && e.operation === operation)
            .map(e => e.duration);

        if (operationTimings.length === 0) return 'N/A';

        const average = operationTimings.reduce((sum, d) => sum + d, 0) / operationTimings.length;
        return `${average.toFixed(2)}ms`;
    }

    /**
     * Gets a performance rating for an operation based on its duration.
     * @private
     * @param {string} operation - The name of the operation.
     * @param {number} duration - The duration of the operation.
     * @returns {string} A performance rating ('excellent', 'good', 'acceptable', 'poor').
     */
    _getPerformanceRating(operation, duration) {
        const average = this.diagnosticHistory
            .filter(e => e.type === 'performance_timing' && e.operation === operation)
            .map(e => e.duration)
            .reduce((sum, d, _, arr) => sum + d / arr.length, 0);

        if (average === 0) return 'baseline';
        
        const ratio = duration / average;
        if (ratio < 0.8) return 'excellent';
        if (ratio < 1.2) return 'good';
        if (ratio < 1.5) return 'acceptable';
        return 'poor';
    }

    /**
     * Analyzes recent performance trends.
     * @private
     * @param {Array} recentHistory - The recent diagnostic history.
     * @returns {Object} A performance analysis object.
     */
    _analyzeRecentPerformance(recentHistory) {
        const recentDisplays = recentHistory.filter(e => e.type === 'display_attempt');
        const recentSuccesses = recentDisplays.filter(e => e.success);
        
        return {
            recentSuccessRate: recentDisplays.length > 0 
                ? `${((recentSuccesses.length / recentDisplays.length) * 100).toFixed(1)}%`
                : 'N/A',
            recentAttempts: recentDisplays.length,
            trend: this._calculateTrend(recentDisplays)
        };
    }

    /**
     * Calculates the performance trend based on display attempts.
     * @private
     * @param {Array} attempts - An array of display attempts.
     * @returns {string} A description of the trend ('improving', 'declining', 'stable').
     */
    _calculateTrend(attempts) {
        if (attempts.length < 2) return 'insufficient_data';
        
        const midpoint = Math.floor(attempts.length / 2);
        const firstHalf = attempts.slice(0, midpoint);
        const secondHalf = attempts.slice(midpoint);
        
        const firstHalfSuccess = firstHalf.filter(a => a.success).length / firstHalf.length;
        const secondHalfSuccess = secondHalf.filter(a => a.success).length / secondHalf.length;
        
        const difference = secondHalfSuccess - firstHalfSuccess;
        
        if (difference > 0.1) return 'improving';
        if (difference < -0.1) return 'declining';
        return 'stable';
    }

    /**
     * Generates recommendations based on the collected diagnostic data.
     * @private
     * @returns {Array} An array of recommendation objects.
     */
    _generateRecommendations() {
        const recommendations = [];
        
        // Success rate recommendations
        if (this.performanceBaseline.successRate < 80) {
            recommendations.push({
                type: 'success_rate',
                priority: 'high',
                message: 'Low subtitle display success rate detected',
                suggestion: 'Review error patterns and implement additional error handling'
            });
        }
        
        // Performance recommendations
        if (this.performanceBaseline.averageProcessingTime > 1000) {
            recommendations.push({
                type: 'performance',
                priority: 'medium',
                message: 'Slow subtitle processing detected',
                suggestion: 'Consider optimizing subtitle parsing and translation logic'
            });
        }
        
        // Error pattern recommendations
        const topError = Array.from(this.errorPatterns.entries())
            .sort(([,a], [,b]) => b - a)[0];
        
        if (topError && topError[1] > 5) {
            recommendations.push({
                type: 'error_pattern',
                priority: 'high',
                message: `Recurring error pattern detected: ${topError[0]}`,
                suggestion: 'Implement specific handling for this error pattern'
            });
        }
        
        return recommendations;
    }
}

/**
 * Creates a navigation logger instance for a specific platform.
 * @param {string} platform - The platform name.
 * @param {Object} [config={}] - Configuration for the logger.
 * @returns {NavigationLogger} A new `NavigationLogger` instance.
 */
export function createNavigationLogger(platform, config = {}) {
    return new NavigationLogger(platform, config);
}

/**
 * Creates a subtitle diagnostics instance for a specific platform.
 * @param {string} platform - The platform name.
 * @param {Object} [config={}] - Configuration for the logger.
 * @returns {SubtitleDiagnostics} A new `SubtitleDiagnostics` instance.
 */
export function createSubtitleDiagnostics(platform, config = {}) {
    return new SubtitleDiagnostics(platform, config);
}