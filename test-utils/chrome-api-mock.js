/**
 * Chrome API Mock Utility
 * 
 * Provides standardized Chrome extension API mocks for consistent testing.
 * This utility creates mock implementations of Chrome extension APIs.
 */

import { jest } from '@jest/globals';

class ChromeStorageMock {
  constructor() {
    this.data = new Map();
    this.listeners = [];
  }

  local = {
    get: jest.fn((keys, callback) => {
      const result = {};
      if (typeof keys === 'string') {
        keys = [keys];
      }
      if (Array.isArray(keys)) {
        keys.forEach(key => {
          if (this.data.has(key)) {
            result[key] = this.data.get(key);
          }
        });
      } else if (typeof keys === 'object' && keys !== null) {
        Object.keys(keys).forEach(key => {
          result[key] = this.data.has(key) ? this.data.get(key) : keys[key];
        });
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    }),

    set: jest.fn((items, callback) => {
      Object.keys(items).forEach(key => {
        this.data.set(key, items[key]);
      });
      if (callback) callback();
      return Promise.resolve();
    }),

    remove: jest.fn((keys, callback) => {
      if (typeof keys === 'string') {
        keys = [keys];
      }
      keys.forEach(key => {
        this.data.delete(key);
      });
      if (callback) callback();
      return Promise.resolve();
    }),

    clear: jest.fn((callback) => {
      this.data.clear();
      if (callback) callback();
      return Promise.resolve();
    })
  };

  sync = {
    get: jest.fn((keys, callback) => {
      const result = {};
      if (typeof keys === 'string') {
        keys = [keys];
      }
      if (Array.isArray(keys)) {
        keys.forEach(key => {
          if (this.data.has(key)) {
            result[key] = this.data.get(key);
          }
        });
      } else if (typeof keys === 'object' && keys !== null) {
        Object.keys(keys).forEach(key => {
          result[key] = this.data.has(key) ? this.data.get(key) : keys[key];
        });
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    }),

    set: jest.fn((items, callback) => {
      Object.keys(items).forEach(key => {
        this.data.set(key, items[key]);
      });
      if (callback) callback();
      return Promise.resolve();
    }),

    remove: jest.fn((keys, callback) => {
      if (typeof keys === 'string') {
        keys = [keys];
      }
      keys.forEach(key => {
        this.data.delete(key);
      });
      if (callback) callback();
      return Promise.resolve();
    }),

    clear: jest.fn((callback) => {
      this.data.clear();
      if (callback) callback();
      return Promise.resolve();
    })
  };

  onChanged = {
    addListener: jest.fn((listener) => {
      this.listeners.push(listener);
    }),
    removeListener: jest.fn((listener) => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    })
  };

  /**
   * Reset storage mock to clean state
   */
  reset() {
    this.data.clear();
    this.listeners = [];
    jest.clearAllMocks();
  }
}

class ChromeRuntimeMock {
  constructor() {
    this.listeners = [];
  }

  sendMessage = jest.fn((message, callback) => {
    if (callback) callback({ success: true });
    return Promise.resolve({ success: true });
  });

  onMessage = {
    addListener: jest.fn((listener) => {
      this.listeners.push(listener);
    }),
    removeListener: jest.fn((listener) => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    })
  };

  getManifest = jest.fn(() => ({
    version: '1.0.0',
    name: 'Test Extension'
  }));

  /**
   * Reset runtime mock to clean state
   */
  reset() {
    this.listeners = [];
    jest.clearAllMocks();
  }
}

class ChromeTabsMock {
  constructor() {
    this.tabs = [];
  }

  query = jest.fn((queryInfo, callback) => {
    const result = this.tabs.filter(tab => {
      if (queryInfo.active !== undefined && tab.active !== queryInfo.active) return false;
      if (queryInfo.currentWindow !== undefined && tab.windowId !== 1) return false;
      if (queryInfo.url && !tab.url.includes(queryInfo.url)) return false;
      return true;
    });
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  executeScript = jest.fn((tabId, details, callback) => {
    if (callback) callback([]);
    return Promise.resolve([]);
  });

  /**
   * Add a mock tab for testing
   * @param {Object} tab - Tab object
   */
  addTab(tab) {
    this.tabs.push({
      id: tab.id || this.tabs.length + 1,
      url: tab.url || 'http://localhost',
      active: tab.active || false,
      windowId: tab.windowId || 1,
      ...tab
    });
  }

  /**
   * Reset tabs mock to clean state
   */
  reset() {
    this.tabs = [];
    jest.clearAllMocks();
  }
}

class ChromeApiMock {
  constructor() {
    this.storage = new ChromeStorageMock();
    this.runtime = new ChromeRuntimeMock();
    this.tabs = new ChromeTabsMock();
  }

  /**
   * Create a complete Chrome API mock
   * @returns {Object} Chrome API mock object
   */
  static create() {
    return new ChromeApiMock();
  }

  /**
   * Reset all Chrome API mocks to clean state
   */
  reset() {
    this.storage.reset();
    this.runtime.reset();
    this.tabs.reset();
  }
}

/**
 * Mock the global chrome object for tests
 * @param {ChromeApiMock} chromeApiMock - Chrome API mock instance
 * @returns {Function} Cleanup function to restore original chrome object
 */
function mockChromeApi(chromeApiMock = ChromeApiMock.create()) {
  const originalChrome = global.chrome;
  
  global.chrome = chromeApiMock;

  // Return cleanup function
  return () => {
    if (originalChrome) {
      global.chrome = originalChrome;
    } else {
      delete global.chrome;
    }
  };
}

export {
  ChromeApiMock,
  ChromeStorageMock,
  ChromeRuntimeMock,
  ChromeTabsMock,
  mockChromeApi
};