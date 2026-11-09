import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Where the console is served from. "/app" while old and new pages run side
// by side; "" once every page has moved over.
const base = (process.env.BD_UI_BASE ?? '/app') as '' | `/${string}`;
// The Express console that answers /api, /socket and every non-UI path in dev
const backend = process.env.BD_BACKEND ?? 'http://localhost:5000';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: true,
				strict: true
			}),
			paths: { base, relative: false },
			appDir: '_ui',
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self'],
					// Only SvelteKit's route announcer (a visually hidden live region)
					// carries a style attribute; allow exactly that value. Our own
					// markup uses style: directives, which go through CSSOM.
					'style-src-attr': ['unsafe-hashes', 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'media-src': ['self', 'blob:'],
					'worker-src': ['self', 'blob:'],
					'frame-src': ['none'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},
			version: { pollInterval: 0 },
			compilerOptions: { runes: true }
		})
	],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			// Everything outside the UI base goes to Express (API, sockets, branding.css, fonts, old pages)
			[base === ''
				? '^/(api|socket|ws|css|fonts|branding|uploads|wallpapers|protos|console-boot[.]js)(/|$)'
				: `^/(?!${base.slice(1)}(/|$))`]: { target: backend, changeOrigin: false, ws: true }
		}
	},
	build: {
		target: 'es2022',
		cssMinify: true,
		reportCompressedSize: true
	},
	test: {
		include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'jsdom',
		globals: true,
		setupFiles: ['tests/unit/setup.ts'],
		restoreMocks: true
	},
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
