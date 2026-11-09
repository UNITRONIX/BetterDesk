<!--
  One background on the Appearance tab (console, sign-in page, download
  page, web remote client): the kind (none, same as console, colour,
  gradient, picture) and the fields of the chosen kind. A picture can be
  uploaded; the server stores it and saves it as this background right
  away (the page's upload() does the request and takes the answer).
  Ids follow the old page: <prefix>-type radios, <prefix>-color,
  <prefix>-gradient, <prefix>-image-url, <prefix>-image-file ...
  children: the fields shown for colour, gradient and picture (blur,
  darken); their ids go in `effects`, so the choices point at them.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import ColorField from '#lib/ui/ColorField.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FilePicker from '#lib/ui/FilePicker.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Radio from '#lib/ui/Radio.svelte';
	import Select from '#lib/ui/Select.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import { BG_MAX, BG_TYPES, fileProblem, type BgType } from './appearance.ts';

	interface Props {
		prefix: string;
		types: readonly BgType[];
		type: BgType;
		color: string;
		gradient: string;
		imageUrl: string;
		size?: string;
		showSize?: boolean;
		gradientPlaceholder: string;
		gradientHint?: boolean;
		imagePlaceholder: string;
		/** The appearance key the server saves an uploaded picture to */
		target: string;
		upload: (file: File, target: string, onProgress: (percent: number) => void) => Promise<unknown>;
		/** "Current picture: x.jpg" */
		fileNote?: string;
		/** Picked from the uploaded pictures (console background) */
		library?: Snippet;
		effects?: readonly string[];
		children?: Snippet;
	}

	let {
		prefix,
		types,
		type = $bindable(),
		color = $bindable(),
		gradient = $bindable(),
		imageUrl = $bindable(),
		size = $bindable('cover'),
		showSize = false,
		gradientPlaceholder,
		gradientHint = false,
		imagePlaceholder,
		target,
		upload,
		fileNote = '',
		library,
		effects = [],
		children
	}: Props = $props();

	const LABEL: Record<BgType, string> = {
		none: 'branding.bg_type_none',
		inherit: 'branding.login_bg_inherit',
		color: 'branding.bg_type_color',
		gradient: 'branding.bg_type_gradient',
		image: 'branding.bg_type_image'
	};

	const panel = (kind: BgType) => `${prefix}-${kind}-panel`;
	const controls = (kind: BgType) =>
		[
			kind === 'color' || kind === 'gradient' || kind === 'image' ? panel(kind) : '',
			...(kind === 'none' || kind === 'inherit' ? [] : effects)
		]
			.filter(Boolean)
			.join(' ') || undefined;

	let files = $state<FileList | null>(null);
	let picker = $state<HTMLInputElement | null>(null);
	let progress = $state<{ state: 'idle' | 'uploading' | 'ok' | 'error'; message: string; percent: number }>({
		state: 'idle',
		message: '',
		percent: 0
	});

	async function onFile() {
		const file = files?.[0];
		if (!file) return;
		const problem = fileProblem(file, BG_TYPES, BG_MAX);
		if (problem) {
			progress = {
				state: 'error',
				message: t(problem === 'size' ? 'branding.bg_image_too_large' : 'branding.bg_image_invalid_type'),
				percent: 0
			};
			if (picker) picker.value = '';
			return;
		}
		progress = { state: 'uploading', message: `${file.name}: ${t('branding.status_saving')}`, percent: 1 };
		try {
			await upload(file, target, (percent) => {
				progress = { state: 'uploading', message: `${file.name}: ${percent} %`, percent };
			});
			progress = {
				state: 'ok',
				message: `${t('branding.bg_upload_success')} ${t('branding.autosaved')}`,
				percent: 100
			};
		} catch (err) {
			progress = {
				state: 'error',
				message: err instanceof Error && err.message ? err.message : t('errors.server_error'),
				percent: 0
			};
		} finally {
			if (picker) picker.value = '';
		}
	}
</script>

<fieldset class="bg-kind">
	<legend class="form-label">{t('settings.appearance.background_type')}</legend>
	<div class="radio-row">
		{#each types as kind (kind)}
			<Radio
				name="{prefix}-type"
				value={kind}
				bind:group={type}
				label={t(LABEL[kind])}
				aria-controls={controls(kind)}
			/>
		{/each}
	</div>
</fieldset>

{#if types.includes('color')}
	<ShowWhen id={panel('color')} when={type === 'color'}>
		<Field id="{prefix}-color" label={t('branding.bg_color')}>
			{#snippet children(f)}
				<ColorField id={f.id} describedby={f.describedby} label={t('branding.bg_color')} bind:value={color} />
			{/snippet}
		</Field>
	</ShowWhen>
{/if}

{#if types.includes('gradient')}
	<ShowWhen id={panel('gradient')} when={type === 'gradient'}>
		<Field
			id="{prefix}-gradient"
			label={t('branding.bg_gradient')}
			hint={gradientHint ? t('branding.bg_gradient_hint') : undefined}
		>
			{#snippet children(f)}
				<Input {...f} class="mono" maxlength={400} placeholder={gradientPlaceholder} bind:value={gradient} />
			{/snippet}
		</Field>
	</ShowWhen>
{/if}

{#if types.includes('image')}
	<ShowWhen id={panel('image')} when={type === 'image'}>
		{@render library?.()}
		<div class="form-group">
			<label class="form-label" for="{prefix}-image-file">{t('branding.bg_image_upload')}</label>
			<FilePicker
				id="{prefix}-image-file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				bind:files
				bind:element={picker}
				describedby="{prefix}-image-file-hint {prefix}-image-file-effect"
				onchange={() => void onFile()}
			/>
			<p class="form-hint" id="{prefix}-image-file-hint">{t('branding.bg_image_hint')}</p>
			{#if fileNote && !library}<p class="form-hint" id="{prefix}-file-name">{fileNote}</p>{/if}
			{#if progress.state !== 'idle'}
				<div class="upload-status" id="{prefix}-upload-status">
					<FormStatus
						message={progress.message}
						tone={progress.state === 'ok' ? 'ok' : progress.state === 'error' ? 'error' : 'neutral'}
					/>
					{#if progress.state === 'uploading'}<Meter
							value={progress.percent}
							text="{progress.percent} %"
						/>{/if}
				</div>
			{/if}
			<p class="field-effect" id="{prefix}-image-file-effect">{t('settings.appearance.bg_upload_effect')}</p>
		</div>
		<Field id="{prefix}-image-url" label={t('branding.bg_image_url')}>
			{#snippet children(f)}
				<Input {...f} placeholder={imagePlaceholder} bind:value={imageUrl} />
			{/snippet}
		</Field>
		{#if showSize}
			<Field id="{prefix === 'bg' ? 'bg' : prefix}-size" label={t('branding.bg_size')} width="medium">
				{#snippet children(f)}
					<Select
						{...f}
						bind:value={size}
						options={[
							{ value: 'cover', label: t('branding.bg_size_cover') },
							{ value: 'contain', label: t('branding.bg_size_contain') },
							{ value: 'auto', label: t('branding.bg_size_auto') }
						]}
					/>
				{/snippet}
			</Field>
		{/if}
	</ShowWhen>
{/if}

{@render children?.()}

<style>
	.bg-kind {
		min-width: 0;
		margin: 0 0 var(--space-4);
		padding: 0;
		border: 0;
	}
	.bg-kind > legend {
		padding: 0;
		font-weight: 600;
	}
	.radio-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-5);
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		margin-bottom: var(--space-4);
	}
	.form-label {
		font-weight: 600;
	}
	.form-hint,
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.upload-status {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
