'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = [
  {
    ignores: ['node_modules/**', 'swagger_output.json'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    // page.evaluate() callbacks run in the browser; this file mixes Node + DOM globals.
    files: ['src/Services/ProductScraper.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  eslintConfigPrettier,
];
