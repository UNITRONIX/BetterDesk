import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import noLiteralUiText from './eslint-rules/no-literal-ui-text.js';

export default ts.config(
	{ ignores: ['build/', '.svelte-kit/', 'node_modules/', 'test-results/', 'playwright-report/', 'static/'] },
	js.configs.recommended,
	...ts.configs.strict,
	...svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'no-console': ['error', { allow: ['warn', 'error'] }],
			// Text must be text: no {@html} with outside data. The few static, reviewed
			// strings (inline SVG marks) use the Icon/Logo components, not {@html}.
			'svelte/no-at-html-tags': 'error',
			'svelte/no-target-blank': 'error',
			'svelte/require-each-key': 'error',
			'svelte/valid-compile': 'error',
			// hrefs go through link() in #lib/nav.ts (adds the base); goto/pushState must use resolve()
			'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser }
		}
	},
	{
		files: ['src/**/*.svelte'],
		plugins: { local: { rules: { 'no-literal-ui-text': noLiteralUiText } } },
		rules: { 'local/no-literal-ui-text': 'error' }
	},
	{
		files: ['tests/**', 'e2e/**'],
		rules: { '@typescript-eslint/no-non-null-assertion': 'off' }
	},
	{
		files: ['eslint-rules/**', 'scripts/**', '*.config.*'],
		rules: { '@typescript-eslint/no-explicit-any': 'off' }
	}
);
