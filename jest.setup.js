// Import jest for ES modules compatibility
import { jest } from '@jest/globals';

// Mock Chrome APIs for testing
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

// Mock console methods to capture logs in tests
global.console = {
  ...console,
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};