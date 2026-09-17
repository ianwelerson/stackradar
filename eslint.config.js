import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Rules applied to every TypeScript source in the repo. */
const sharedRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'off',
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'mcp/dist',
      'mcp/node_modules',
      'design-reference',
      'public/companies.json',
      'scripts/**/*.mjs',
    ],
  },
  // The browser app.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { project: ['./tsconfig.app.json'], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, ...sharedRules },
  },
  // Serverless API — Node globals, no DOM, no React.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['api/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: { project: ['./api/tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: sharedRules,
  },
  // MCP server — its own tsconfig and its own dependency tree.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['mcp/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: { project: ['./mcp/tsconfig.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: sharedRules,
  },
);
