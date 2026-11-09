/**
 * The public download pages' server calls: /portal (routes/phase4_5.routes.js)
 * and /d/<id> (routes/generator.routes.js). Nobody is signed in.
 */

import * as v from 'valibot';
import { api, wrapped } from './client';

const Installer = v.looseObject({
	platform: v.string(),
	arch: v.optional(v.string(), ''),
	url: v.string(),
	format: v.optional(v.string(), 'portable'),
	release: v.optional(v.nullable(v.string()))
});
export type Installer = v.InferOutput<typeof Installer>;

/** GET /api/portal/installers: the support agent's latest imported release; `reason` explains an empty list */
export const Installers = v.looseObject({
	success: v.optional(v.boolean()),
	release: v.optional(v.nullable(v.string()), null),
	reason: v.optional(v.nullable(v.string()), null),
	installers: v.optional(v.array(Installer), [])
});
export type Installers = v.InferOutput<typeof Installers>;

export function getInstallers(signal?: AbortSignal): Promise<Installers> {
	return api(Installers, '/api/portal/installers', { signal, allowAnonymous: true });
}

const BundlePlatform = v.object({
	platform: v.string(),
	arch: v.string(),
	format: v.string(),
	label: v.string(),
	status: v.string()
});
export type BundlePlatform = v.InferOutput<typeof BundlePlatform>;

/** GET /api/d/:publicId/page: the bundle's branding and installers (no enrollment token) */
export const BundlePage = v.object({
	publicId: v.string(),
	companyName: v.string(),
	shortText: v.string(),
	logo: v.string(),
	contact: v.object({ email: v.string(), phone: v.string(), url: v.string() }),
	accent: v.string(),
	background: v.string(),
	showPoweredBy: v.boolean(),
	product: v.object({ type: v.string(), label: v.string(), hidden: v.boolean() }),
	defaultLang: v.nullable(v.string()),
	platforms: v.array(BundlePlatform)
});
export type BundlePage = v.InferOutput<typeof BundlePage>;

export function getBundlePage(publicId: string, signal?: AbortSignal): Promise<BundlePage> {
	return api(wrapped(BundlePage), `/api/d/${encodeURIComponent(publicId)}/page`, {
		signal,
		allowAnonymous: true
	});
}

/** GET /api/d/:publicId/manifest: the installers' build state, polled while some still build */
const Manifest = v.object({
	platforms: v.array(
		v.looseObject({ platform: v.string(), arch: v.string(), format: v.string(), status: v.string() })
	)
});

export function getBundleManifest(
	publicId: string,
	signal?: AbortSignal
): Promise<v.InferOutput<typeof Manifest>> {
	return api(wrapped(Manifest), `/api/d/${encodeURIComponent(publicId)}/manifest`, {
		signal,
		allowAnonymous: true
	});
}

/** Where a ready installer downloads from */
export function bundleDownloadUrl(
	publicId: string,
	p: { platform: string; arch: string; format: string }
): string {
	const part = encodeURIComponent;
	return `/api/d/${part(publicId)}/download/${part(p.platform)}/${part(p.arch)}/${part(p.format)}`;
}
