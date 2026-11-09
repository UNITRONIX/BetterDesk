<!--
  Client app branding (/client-branding): the name, contact details,
  accent colour and logo that BetterDesk clients and support agents show.
  One form with one save; a live preview beside it follows the form as
  people type. Clients pick changes up when they next check in.

  Needs branding.edit (the route and both calls).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getClientBranding, saveClientBranding, type ClientBranding } from '#lib/api/clientBranding.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		DEFAULT_ACCENT,
		brandingPayload,
		buttonColors,
		checkLogo,
		isHex,
		logoFromDataUrl,
		logoSrc,
		savedAt,
		type BrandingValues
	} from '#lib/clients/branding.ts';
	import { around } from '#lib/clients/text.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import BrandLogo from '#lib/shell/BrandLogo.svelte';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ColorField from '#lib/ui/ColorField.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FilePicker from '#lib/ui/FilePicker.svelte';
	import Input from '#lib/ui/Input.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { FormError, createForm, warnOnLeave } from '#lib/ui/form.svelte.ts';

	const allowed = can('branding.edit');
	/** The website field's placeholder: the start of an address, not text to translate */
	const URL_START = 'https://';

	function valuesOf(b: ClientBranding | null): BrandingValues {
		return {
			company_name: b?.company_name ?? '',
			support_contact: b?.support_contact ?? '',
			phone: b?.phone ?? '',
			email: b?.email ?? '',
			website: b?.website ?? '',
			accent_color: b?.accent_color || DEFAULT_ACCENT,
			logo: b?.logo && (b.logo.data_base64 || b.logo.url) ? { ...b.logo } : null,
			clearLogo: false
		};
	}

	let revision = $state('');
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let files = $state<FileList | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let logoError = $state('');

	const form = createForm({
		initial: valuesOf(null),
		validate: (v) => ({
			accent_color: isHex(v.accent_color) ? undefined : t('client_branding.accent_invalid')
		}),
		submit: async (v) => {
			try {
				const saved = await saveClientBranding(brandingPayload(v));
				revision = saved.revision;
				if (fileInput) fileInput.value = '';
				return valuesOf(saved);
			} catch (err) {
				throw new FormError(
					`${t('client_branding.save_failed')} ${err instanceof Error ? err.message : ''}`.trim()
				);
			}
		},
		savedMessage: t('client_branding.saved')
	});

	async function load(): Promise<void> {
		if (!allowed) return;
		try {
			const b = await getClientBranding();
			revision = b.revision;
			form.reset(valuesOf(b));
			if (fileInput) fileInput.value = '';
			logoError = '';
			loadError = null;
		} catch (err) {
			loadError = `${t('client_branding.load_failed')} ${err instanceof Error ? err.message : ''}`.trim();
		} finally {
			loaded = true;
		}
	}

	$effect(() => untrack(() => void load()));
	// Refresh reloads only when nothing is being edited
	$effect(() =>
		onRefresh(() => {
			if (!form.dirty) void load();
		})
	);
	$effect(() => warnOnLeave(() => form.dirty));

	/* ── Logo ── */

	$effect(() => {
		const file = files?.[0];
		if (!file) return;
		untrack(() => {
			const problem = checkLogo(file);
			if (problem) {
				logoError = t(
					problem === 'too_large' ? 'client_branding.logo_too_large' : 'client_branding.logo_invalid'
				);
				if (fileInput) fileInput.value = '';
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				form.values.logo = logoFromDataUrl(String(reader.result ?? ''), file.type);
				form.values.clearLogo = false;
				logoError = '';
			};
			reader.onerror = () => (logoError = t('client_branding.logo_invalid'));
			reader.readAsDataURL(file);
		});
	});

	function clearLogo() {
		form.values.logo = null;
		form.values.clearLogo = true;
		if (fileInput) fileInput.value = '';
	}

	const logo = $derived(form.values.clearLogo ? '' : logoSrc(form.values.logo));
	const button = $derived(buttonColors(form.values.accent_color));
	const saved = $derived(savedAt(revision));
	const contact = $derived(
		[form.values.phone, form.values.email, form.values.website].map((x) => x.trim()).filter(Boolean)
	);
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page client-branding-page">
		<div class="page-head">
			<h1>{t('nav.client_branding')}</h1>
			<p class="page-description">{t('client_branding.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				{#if loadError}
					<States kind="error" message={loadError} onretry={() => void load()} />
				{/if}

				<form
					id={form.id}
					class="client-branding-form"
					onsubmit={form.onsubmit}
					autocomplete="off"
					novalidate
					aria-busy={!loaded}
				>
					<section class="section" aria-labelledby="cb-contact-title">
						<h2 id="cb-contact-title">{t('client_branding.contact_title')}</h2>
						<p class="section-note">{t('client_branding.contact_note')}</p>
						<Field
							label={t('client_branding.company_name')}
							hint={t('client_branding.company_hint')}
							class="wide-44"
						>
							{#snippet children(f)}
								<Input {...f} maxlength={256} bind:value={form.values.company_name} />
							{/snippet}
						</Field>
						<Field
							label={t('client_branding.support_contact')}
							hint={t('client_branding.support_hint')}
							class="wide-44"
						>
							{#snippet children(f)}
								<Input {...f} maxlength={256} bind:value={form.values.support_contact} />
							{/snippet}
						</Field>
						<Field label={t('client_branding.phone')} width="medium">
							{#snippet children(f)}
								<Input {...f} type="tel" maxlength={256} dir="ltr" bind:value={form.values.phone} />
							{/snippet}
						</Field>
						<Field label={t('client_branding.email')} class="wide-44">
							{#snippet children(f)}
								<Input {...f} type="email" maxlength={256} dir="ltr" bind:value={form.values.email} />
							{/snippet}
						</Field>
						<Field label={t('client_branding.website')} class="wide-44">
							{#snippet children(f)}
								<Input
									{...f}
									type="url"
									maxlength={512}
									dir="ltr"
									placeholder={URL_START}
									bind:value={form.values.website}
								/>
							{/snippet}
						</Field>
					</section>

					<section class="section" aria-labelledby="cb-look-title">
						<h2 id="cb-look-title">{t('client_branding.look_title')}</h2>
						<Field
							label={t('client_branding.accent_color')}
							hint={t('client_branding.accent_hint')}
							error={form.errors.accent_color}
						>
							{#snippet children(f)}
								<ColorField
									id={f.id}
									describedby={f.describedby}
									invalid={f.invalid}
									label={t('client_branding.accent_color')}
									bind:value={form.values.accent_color}
								/>
							{/snippet}
						</Field>
						<Field
							label={t('client_branding.logo')}
							hint={t('client_branding.logo_hint')}
							error={logoError || undefined}
						>
							{#snippet children(f)}
								<div class="logo-current">
									{#if logo}
										<img src={logo} alt={t('client_branding.logo_preview_alt')} />
										<Button size="sm" class="cb-clear-logo" onclick={clearLogo}
											>{t('client_branding.clear_logo')}</Button
										>
									{:else}
										<span class="text-muted">{t('client_branding.no_logo')}</span>
									{/if}
								</div>
								<FilePicker
									{...f}
									accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
									bind:files
									bind:element={fileInput}
								/>
							{/snippet}
						</Field>
						<p class="field-effect">{t('client_branding.effect')}</p>
					</section>

					<SaveBar {form} label={t('client_branding.save')}>
						<span class="cb-revision">
							{#if saved}{@const [pre, post] = around(t('client_branding.last_saved'), '{date}')}{pre}<Time
									value={saved}
								/>{post}{:else if loaded && !loadError}{t('client_branding.never_saved')}{/if}
						</span>
					</SaveBar>
				</form>
			</div>

			<aside class="page-side is-sticky" aria-labelledby="cb-preview-title">
				<section class="section">
					<div class="section-head"><h2 id="cb-preview-title">{t('client_branding.preview_title')}</h2></div>
					<p class="section-note">{t('client_branding.preview_note')}</p>
					<div class="cb-preview">
						<div class="cb-preview-head">
							{#if logo}
								<img class="cb-pv-logo" src={logo} alt="" width="32" height="32" />
							{:else}
								<span class="cb-pv-logo"><BrandLogo mark /></span>
							{/if}
							<span class="cb-pv-name">{form.values.company_name.trim() || 'BetterDesk'}</span>
						</div>
						<div class="cb-preview-body">
							{#if form.values.support_contact.trim()}
								<p class="cb-pv-support">{form.values.support_contact.trim()}</p>
							{/if}
							{#if contact.length}
								<ul class="cb-pv-contact">
									{#each contact as line, i (i)}<li dir="ltr">{line}</li>{/each}
								</ul>
							{/if}
							<span class="cb-pv-button" style:background-color={button.background} style:color={button.text}
								>{t('client_branding.preview_button')}</span
							>
						</div>
					</div>
					<p class="cb-preview-reach">{t('client_branding.hint')}</p>
				</section>
			</aside>
		</div>
	</div>
{/if}

<style>
	/* The main column holds the form only: keep the preview next to it */
	.client-branding-page .page-cols {
		max-width: calc(var(--measure) + var(--side-w) + var(--space-7));
	}
	.client-branding-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		max-width: var(--measure);
	}
	.client-branding-form :global(.wide-44 .form-input) {
		max-width: 44ch;
	}
	.logo-current {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}
	.logo-current img {
		display: block;
		max-width: 160px;
		max-height: 64px;
		padding: var(--space-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		object-fit: contain;
	}
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.cb-revision {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Preview: a small window like the client's */
	.cb-preview {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.cb-preview-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.cb-pv-logo {
		display: block;
		flex: none;
		width: 32px;
		height: 32px;
		object-fit: contain;
	}
	.cb-pv-logo :global(svg) {
		display: block;
		width: 32px;
		height: 32px;
	}
	.cb-pv-name {
		min-width: 0;
		font-size: var(--text-md);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.cb-preview-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-4);
	}
	.cb-pv-support {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.cb-pv-contact {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.cb-pv-button {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h);
		margin-top: var(--space-2);
		padding: 0 var(--space-4);
		border-radius: var(--radius);
		font-weight: 600;
	}
	.cb-preview-reach {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Wide screens: the two groups side by side, one save bar under both */
	@media (min-width: 1700px) {
		.client-branding-page .page-cols {
			max-width: none;
		}
		.client-branding-form {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0 var(--space-7);
			align-items: start;
			max-width: none;
		}
		.client-branding-form > :global(.save-bar) {
			grid-column: 1 / -1;
		}
	}
</style>
