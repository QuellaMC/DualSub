/**
 * Regression coverage for the extension modules involved in the historical
 * AI-context module-loading failure.
 */

import { jest, describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    SelectionPersistenceManager,
    createSelectionPersistenceManager,
} from '../utils/selectionPersistence.js';
import { AIContextManager } from '../core/AIContextManager.js';
import { logWithFallback } from '../../core/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Module Loading Fix', () => {
    describe('Selection Persistence Module Loading', () => {
        test('exports the selection persistence factory', () => {
            expect(createSelectionPersistenceManager).toEqual(
                expect.any(Function)
            );
        });

        test('creates a SelectionPersistenceManager', () => {
            jest.spyOn(console, 'log').mockImplementation(() => {});
            const modalCore = {
                selectedWords: new Set(),
                selectionPersistence: {
                    lastSubtitleContent: '',
                    lastSelectionState: null,
                    isRestoring: false,
                    pendingRestore: false,
                },
            };

            const manager = createSelectionPersistenceManager(modalCore);

            expect(manager).toBeInstanceOf(SelectionPersistenceManager);
            expect(manager.modalCore).toBe(modalCore);
        });
    });

    describe('AI Context Manager Loading', () => {
        test('exports AIContextManager', () => {
            expect(AIContextManager).toEqual(expect.any(Function));
        });

        test('instantiates AIContextManager without initializing it', () => {
            const manager = new AIContextManager('netflix', {
                textHandler: { autoAnalysis: false },
            });

            expect(manager).toBeInstanceOf(AIContextManager);
            expect(manager.platform).toBe('netflix');
            expect(manager.initialized).toBe(false);
        });
    });

    describe('Import Path Verification', () => {
        test('imports logWithFallback from the shared content-script core', () => {
            const selectionPersistenceFile = path.join(
                __dirname,
                '../utils/selectionPersistence.js'
            );
            const content = fs.readFileSync(selectionPersistenceFile, 'utf8');

            expect(content).toContain(
                "import { logWithFallback } from '../../core/utils.js'"
            );
            expect(content).not.toContain(
                "import { logWithFallback } from '../../shared/utils.js'"
            );
        });

        test('loads logWithFallback from core/utils.js', () => {
            expect(logWithFallback).toEqual(expect.any(Function));
        });
    });

    describe('Manifest.json Verification', () => {
        test('exposes every module needed by the AI-context entrypoint', () => {
            const manifestPath = path.join(__dirname, '../../../manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const resources = manifest.web_accessible_resources.flatMap(
                ({ resources: entries }) => entries
            );

            expect(resources).toEqual(
                expect.arrayContaining([
                    'content_scripts/core/utils.js',
                    'content_scripts/aicontext/utils/selectionPersistence.js',
                    'content_scripts/aicontext/core/AIContextManager.js',
                ])
            );
            expect(resources).not.toContain('content_scripts/shared/utils.js');
        });
    });
});
