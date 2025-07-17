/**
 * Location Mock Utility
 * 
 * Provides a configurable location mock that doesn't trigger JSDOM navigation errors.
 * This utility allows tests to modify location properties without causing navigation issues.
 */

class LocationMock {
  constructor(initialLocation = {}) {
    this.hostname = initialLocation.hostname || 'localhost';
    this.pathname = initialLocation.pathname || '/';
    this.search = initialLocation.search || '';
    this.hash = initialLocation.hash || '';
    this.protocol = initialLocation.protocol || 'http:';
    this.port = initialLocation.port || '';
    this.host = initialLocation.host || this.hostname;
    this.origin = initialLocation.origin || `${this.protocol}//${this.host}`;
    // Don't set href in constructor to avoid JSDOM navigation issues
    this._href = initialLocation.href || `${this.origin}${this.pathname}${this.search}${this.hash}`;
  }

  get href() {
    return this._href;
  }

  set href(value) {
    this._href = value;
    // Parse the URL to update other properties
    try {
      const url = new URL(value);
      this.protocol = url.protocol;
      this.hostname = url.hostname;
      this.port = url.port;
      this.pathname = url.pathname;
      this.search = url.search;
      this.hash = url.hash;
      this.host = url.host;
      this.origin = url.origin;
    } catch (e) {
      // If URL parsing fails, just keep the href value
    }
  }

  /**
   * Update location properties without triggering navigation
   * @param {Object} newLocation - Object containing location properties to update
   */
  setLocation(newLocation) {
    Object.keys(newLocation).forEach(key => {
      if (key === 'href') {
        this._href = newLocation[key];
      } else if (key in this) {
        this[key] = newLocation[key];
      }
    });
    
    // Update derived properties
    this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname;
    this.origin = `${this.protocol}//${this.host}`;
    this._href = `${this.origin}${this.pathname}${this.search}${this.hash}`;
  }

  /**
   * Reset location to default state
   */
  reset() {
    this.hostname = 'localhost';
    this.pathname = '/';
    this.search = '';
    this.hash = '';
    this.protocol = 'http:';
    this.port = '';
    this.host = 'localhost';
    this.origin = 'http://localhost';
    this._href = 'http://localhost/';
  }

  /**
   * Create a Netflix location mock
   * @param {string} movieId - Netflix movie ID
   * @returns {LocationMock} Configured location mock for Netflix
   */
  static createNetflixMock(movieId = '12345') {
    return new LocationMock({
      hostname: 'www.netflix.com',
      pathname: `/watch/${movieId}`,
      protocol: 'https:',
      href: `https://www.netflix.com/watch/${movieId}`
    });
  }

  /**
   * Create a Disney Plus location mock
   * @param {string} contentId - Disney Plus content ID
   * @returns {LocationMock} Configured location mock for Disney Plus
   */
  static createDisneyPlusMock(contentId = 'abc123') {
    return new LocationMock({
      hostname: 'www.disneyplus.com',
      pathname: `/video/${contentId}`,
      protocol: 'https:',
      href: `https://www.disneyplus.com/video/${contentId}`
    });
  }
}

/**
 * Mock window.location for tests using property getters to avoid JSDOM navigation
 * @param {Object|LocationMock} locationConfig - Location configuration or LocationMock instance
 * @returns {Function} Cleanup function to restore original location
 */
function mockWindowLocation(locationConfig) {
  const locationMock = locationConfig instanceof LocationMock 
    ? locationConfig 
    : new LocationMock(locationConfig);

  // Store original property descriptors
  const originalDescriptors = {};
  const propertiesToMock = ['hostname', 'pathname', 'href', 'search', 'hash', 'protocol', 'port', 'host', 'origin'];
  
  propertiesToMock.forEach(prop => {
    originalDescriptors[prop] = Object.getOwnPropertyDescriptor(window.location, prop);
  });

  // Mock properties using getters to avoid JSDOM navigation issues
  propertiesToMock.forEach(prop => {
    if (locationMock[prop] !== undefined) {
      try {
        Object.defineProperty(window.location, prop, {
          get: () => locationMock[prop],
          set: (value) => {
            locationMock[prop] = value;
            // Update derived properties
            if (prop === 'hostname' || prop === 'port') {
              locationMock.host = locationMock.port ? `${locationMock.hostname}:${locationMock.port}` : locationMock.hostname;
              locationMock.origin = `${locationMock.protocol}//${locationMock.host}`;
              locationMock._href = `${locationMock.origin}${locationMock.pathname}${locationMock.search}${locationMock.hash}`;
            }
          },
          configurable: true
        });
      } catch (error) {
        // Silently continue if property can't be mocked
      }
    }
  });

  // Add setLocation method to the existing location object
  try {
    Object.defineProperty(window.location, 'setLocation', {
      value: function(newLocation) {
        Object.keys(newLocation).forEach(key => {
          if (propertiesToMock.includes(key) && newLocation[key] !== undefined) {
            locationMock[key] = newLocation[key];
          }
        });
        
        // Update derived properties
        locationMock.host = locationMock.port ? `${locationMock.hostname}:${locationMock.port}` : locationMock.hostname;
        locationMock.origin = `${locationMock.protocol}//${locationMock.host}`;
        locationMock._href = `${locationMock.origin}${locationMock.pathname}${locationMock.search}${locationMock.hash}`;
      },
      writable: true,
      configurable: true
    });
  } catch (error) {
    // Silently continue if setLocation can't be added
  }

  // Return cleanup function
  return () => {
    propertiesToMock.forEach(prop => {
      try {
        if (originalDescriptors[prop]) {
          Object.defineProperty(window.location, prop, originalDescriptors[prop]);
        }
      } catch (error) {
        // Silently continue if property can't be restored
      }
    });
    
    // Remove setLocation if we added it
    try {
      delete window.location.setLocation;
    } catch (error) {
      // Silently continue
    }
  };
}

export {
  LocationMock,
  mockWindowLocation
};