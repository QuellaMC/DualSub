export default {
  testEnvironment: 'jsdom',
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'utils/**/*.js',
    'services/**/*.js',
    'config/**/*.js',
    '!**/*.test.js',
    '!**/*.spec.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};