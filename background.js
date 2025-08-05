/**
 * DualSub Extension Background Script
 *
 * Entry point for the background service worker.
 * Imports and initializes the modular background system.
 *
 * All functionality is now handled by the modular background services:
 * - Translation Service: Manages providers, caching, batch processing
 * - Subtitle Service: Handles subtitle fetching and processing
 * - Message Handler: Processes content script requests
 * - Batch Queue: Optimizes translation performance
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

// Import modular background services
import './background/index.js';
