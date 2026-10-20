import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'frontend/dist/**', 'data/**', '.run/**', 'test-results/**', 'playwright-report/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
        },
    },
    {
        files: ['server/**/*.ts', 'tests/**/*.{ts,mjs}', 'deploy/**/*.mjs', '*.config.ts', 'frontend/vite.config.ts'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['frontend/public/**/*.js'],
        languageOptions: { globals: globals.browser },
        rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
    },
    {
        files: ['frontend/src/**/*.{ts,tsx}'],
        languageOptions: { globals: globals.browser },
        plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },
    {
        files: ['frontend/src/SiteIcon.tsx'],
        rules: { 'react-refresh/only-export-components': 'off' },
    }
);
