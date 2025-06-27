// eslint.config.js
import globals from "globals";
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";

export default [
  // Global recommended rules from ESLint
  js.configs.recommended,

  // Configuration for all JavaScript files in the project
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      // Example rule: warn about using console.log during development.
      // You can customize your rules here.
      "no-console": "warn"
    }
  },

  // This should be the last configuration in the array.
  // It disables any ESLint formatting rules that might conflict with Prettier.
  prettierConfig
];
