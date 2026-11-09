import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { Agent } from 'node:http';
import { defineConfig } from 'vitest/config';
import { licenses } from './vite-plugins/licenses.ts';
import { withRoutesList } from './vite-plugins/routes.ts';

// Where the console is served from. "/app" while old and new pages run side
// by side; "" once every page has moved over.
const base = (process.env.BD_UI_BASE ?? '/app') as '' | `/${string}`;
// The Express console that answers /api, /socket and every non-UI path in dev
const backend = process.env.BD_BACKEND ?? 'http://localhost:5000';
// The proxy keeps its connections to Express open and reuses them. Without an
// agent it opens a new connection for every request, and from a container
// through host.docker.internal some of those connects stall for 10 to 60 s
// under load. Idle connections close after 4 s, before Express closes them
// at 5 s, so a request never goes out on a connection that is being closed.
const backendAgent = new Agent({ keepAlive: true, timeout: 4000 });

export default defineConfig({
	// Several dev servers share this folder (one per worker); each keeps its own dependency cache
	cacheDir: process.env.BD_VITE_CACHE,
	plugins: [
		// licenses.txt next to the code; fails the build on a license the console may not ship
		licenses(),
		sveltekit({
			// routes.json beside index.html: the server answers addresses no page has with 404
			adapter: withRoutesList(
				adapter({
					pages: 'build',
					assets: 'build',
					fallback: 'index.html',
					precompress: true,
					strict: true
				}),
				'build'
			),
			paths: { base, relative: false },
			appDir: '_ui',
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// Scripts are hash-only. Styles may be inline: xterm (terminals in server
					// management, IoT devices and the device panel) writes <style> elements
					// and per-cell style attributes, and SvelteKit's route announcer has a
					// style attribute. All outside data renders as text, so nothing can
					// inject markup to abuse this.
					'style-src': ['self', 'unsafe-inline'],
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
		// Windows bind mounts don't deliver file events into containers
		watch: process.env.BD_POLL ? { usePolling: true, interval: 300 } : undefined,
		proxy: {
			// Everything outside the UI base goes to Express (API, sockets, branding.css, fonts, old pages)
			[base === ''
				? '^/(api|socket|ws|css|fonts|branding|uploads|wallpapers|protos|console-boot[.]js)(/|$)'
				: `^/(?!${base.slice(1)}(/|$))`]: {
				target: backend,
				changeOrigin: false,
				ws: true,
				agent: backendAgent
			}
		}
	},
	build: {
		target: 'es2022',
		cssMinify: true,
		reportCompressedSize: true,
		rolldownOptions: {
			output: {
				// Fewer files on first load (about 8 instead of 24 for the device list):
				// over HTTP/1.1 a browser fetches six at a time. "runtime" is Svelte and
				// valibot, "core" the shell, components, state and API client every
				// page uses. Parts that load on demand stay out (terminal, chart, QR,
				// diagram), and so does each page's own code.
				// A group also takes in what its modules import, which here includes
				// SvelteKit's runtime. "boot" keeps the two modules SvelteKit's start
				// and app entries need (Vite's preload helper and SvelteKit's payload)
				// in a chunk of their own: if they sat in "core", the entries would
				// load core, and with it `version = payload.version` in $app/env,
				// before SvelteKit has set the payload. The version would never match
				// and every not-found page would reload forever.
				codeSplitting: {
					groups: [
						{
							name: 'boot',
							test: /(\0vite\/preload-helper\.js|@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]client[\\/]payload\.js)$/,
							priority: 4
						},
						{
							name: 'runtime',
							test: /node_modules[\\/](svelte|esm-env|devalue|clsx|valibot)[\\/]/,
							priority: 3
						},
						{
							name: 'core',
							test: (id) =>
								/src[\\/]lib[\\/]((ui|state|shell|i18n|util)[\\/]|nav\.ts|api[\\/](client|console)\.ts)/.test(
									id
								) &&
								!/[\\/](Terminal\.svelte|terminal\.ts|Chart\.svelte|QR\.svelte|ConnectionDiagram\.svelte)/.test(
									id
								),
							priority: 2
						}
					]
				}
			}
		}
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
