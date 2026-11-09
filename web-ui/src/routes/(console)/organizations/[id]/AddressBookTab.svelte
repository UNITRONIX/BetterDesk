<!--
  Address book tab: the contacts the RustDesk client shows every member of
  the organization. With org.edit it is a form (shared on/off, contacts as
  rows, global tags, or the whole book as JSON) with one save, and each
  contact can get a preset password (stored encrypted on the server, never
  in the book). Without org.edit the same data, read-only.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		clearPeerCredential,
		getAddressBook,
		listOrgDevices,
		listPeerCredentials,
		saveAddressBook,
		setPeerCredential
	} from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import {
		BOOK_ERROR_KEYS,
		bookJson,
		bookPayload,
		checkBookJson,
		importDevices,
		parseBook,
		splitTags,
		type Book
	} from '#lib/people/orgs.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { createForm, FormError, warnOnLeave } from '#lib/ui/form.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let { orgId }: { orgId: string } = $props();

	const canEdit = can('org.edit');
	const uid = $props.id();

	/** A contact as the form edits it: tags as the text in their field, a key for the row */
	interface Row {
		key: number;
		id: string;
		alias: string;
		tags: string;
	}
	interface Values {
		enabled: boolean;
		peers: Row[];
		tags: string;
		json: string;
	}

	let seq = 0;
	const toRows = (book: Book): Row[] =>
		book.peers.map((p) => ({ key: ++seq, id: p.id, alias: p.alias, tags: p.tags.join(', ') }));
	const toBook = (v: Values): Book => ({
		peers: v.peers.map((r) => ({ id: r.id.trim(), alias: r.alias.trim(), tags: splitTags(r.tags) })),
		tags: splitTags(v.tags)
	});

	let phase = $state<'loading' | 'ok' | 'error'>('loading');
	let loadError = $state('');
	let passwords = $state.raw(new Set<string>());
	let asJson = $state(false);

	const form = createForm<Values>({
		initial: { enabled: true, peers: [], tags: '', json: '' },
		submit: async (v) => {
			let data: unknown;
			if (asJson) {
				const checked = checkBookJson(v.json);
				if ('error' in checked) throw new FormError(t(BOOK_ERROR_KEYS[checked.error]), 'json');
				data = checked.payload;
			} else {
				data = bookPayload(toBook(v));
			}
			try {
				await saveAddressBook(orgId, data, v.enabled);
			} catch (err) {
				throw new FormError(
					`${t('organizations.address_book_save_failed')}: ${err instanceof Error ? err.message : ''}`
				);
			}
			// What was saved: rows without an ID are gone
			if (asJson) return v;
			const book = toBook(v);
			return { ...v, peers: v.peers.filter((r) => r.id.trim()), tags: book.tags.join(', ') };
		},
		savedMessage: t('organizations.address_book_saved')
	});

	$effect(() => warnOnLeave(() => form.dirty));

	async function load() {
		phase = 'loading';
		try {
			const [ab, creds] = await Promise.all([
				getAddressBook(orgId),
				listPeerCredentials(orgId).catch(() => new Set<string>()) // optional on older servers
			]);
			const book = parseBook(ab.data);
			passwords = creds;
			asJson = false;
			form.reset({
				enabled: ab.enabled,
				peers: toRows(book),
				tags: book.tags.join(', '),
				json: bookJson(book)
			});
			phase = 'ok';
		} catch (err) {
			loadError = err instanceof Error ? err.message : t('organizations.loading_failed');
			phase = 'error';
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	/* ── Rows ── */

	let table = $state<HTMLElement | null>(null);

	async function addRow() {
		form.values.peers = [...form.values.peers, { key: ++seq, id: '', alias: '', tags: '' }];
		await tick();
		const inputs = table?.querySelectorAll<HTMLInputElement>('input.peer-id');
		inputs?.[inputs.length - 1]?.focus();
	}

	function removeRow(row: Row) {
		form.values.peers = form.values.peers.filter((r) => r.key !== row.key);
		table?.querySelector<HTMLElement>('.add-contact')?.focus();
	}

	async function importOrgDevices() {
		try {
			const devices = await listOrgDevices(orgId);
			const { book, added } = importDevices(toBook(form.values), devices);
			if (added) {
				const known = new Set(form.values.peers.map((r) => r.id.trim()));
				const extra = book.peers.filter((p) => !known.has(p.id));
				form.values.peers = [
					...form.values.peers,
					...extra.map((p) => ({ key: ++seq, id: p.id, alias: p.alias, tags: '' }))
				];
				toast.success(t('organizations.address_book_imported'));
			} else {
				toast.info(t('organizations.address_book_import_none'));
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('organizations.loading_failed'));
		}
	}

	async function setPassword(row: Row) {
		const id = row.id.trim();
		if (!id) {
			toast.error(t('organizations.address_book_peer_id_required'));
			return;
		}
		const password = await prompt({
			title: t('organizations.address_book_set_password'),
			label: t('organizations.address_book_set_password_prompt'),
			type: 'password',
			required: true,
			confirmLabel: t('actions.save')
		});
		if (password === null) return;
		if (!password.trim()) {
			toast.error(t('organizations.address_book_password_required'));
			return;
		}
		try {
			await setPeerCredential(orgId, id, password.trim());
			passwords = new Set([...passwords, id]);
			toast.success(t('organizations.address_book_password_saved'));
		} catch (err) {
			toast.error(
				err instanceof Error && err.message
					? err.message
					: t('organizations.address_book_password_save_failed')
			);
		}
	}

	async function clearPassword(row: Row) {
		const id = row.id.trim();
		const ok = await confirm({
			title: t('organizations.address_book_clear_password'),
			message: t('organizations.address_book_clear_password_confirm'),
			confirmLabel: t('organizations.address_book_clear_password'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await clearPeerCredential(orgId, id);
			passwords = new Set([...passwords].filter((p) => p !== id));
			toast.success(t('organizations.address_book_password_cleared'));
		} catch (err) {
			toast.error(
				err instanceof Error && err.message
					? err.message
					: t('organizations.address_book_password_clear_failed')
			);
		}
	}

	/* ── Table or JSON ── */

	function toggleJson() {
		if (!asJson) {
			form.values.json = bookJson(toBook(form.values));
			asJson = true;
			return;
		}
		const checked = checkBookJson(form.values.json);
		if ('error' in checked) {
			form.setError('json', t(BOOK_ERROR_KEYS[checked.error]));
			return;
		}
		form.values.peers = toRows(checked.book);
		form.values.tags = checked.book.tags.join(', ');
		asJson = false;
	}

	const editColumns = $derived<Column<Row>[]>([
		{ id: 'id', label: t('organizations.address_book_peer_id'), cell: idEdit },
		{ id: 'alias', label: t('organizations.address_book_alias'), cell: aliasEdit },
		{ id: 'tags', label: t('organizations.address_book_peer_tags'), cell: tagsEdit },
		{ id: 'password', label: t('organizations.address_book_preset_password'), cell: passwordCell },
		{ id: 'actions', label: t('organizations.actions'), labelHidden: true, cell: rowMenu, align: 'actions' }
	]);
	const readColumns = $derived<Column<Row>[]>([
		{ id: 'id', label: t('organizations.address_book_peer_id'), cell: idRead },
		{ id: 'alias', label: t('organizations.address_book_alias'), cell: aliasRead },
		{ id: 'tags', label: t('organizations.address_book_peer_tags'), cell: tagsRead },
		{ id: 'password', label: t('organizations.address_book_preset_password'), cell: passwordCell }
	]);
	const rowNumber = (row: Row) => form.values.peers.findIndex((r) => r.key === row.key) + 1;
</script>

{#snippet idEdit(row: Row)}<Input
		class="peer-id mono"
		small
		maxlength={64}
		spellcheck="false"
		aria-label="{t('organizations.address_book_peer_id')} {rowNumber(row)}"
		bind:value={row.id}
	/>{/snippet}
{#snippet aliasEdit(row: Row)}<Input
		small
		maxlength={120}
		aria-label="{t('organizations.address_book_alias')} {rowNumber(row)}"
		bind:value={row.alias}
	/>{/snippet}
{#snippet tagsEdit(row: Row)}<Input
		small
		maxlength={200}
		placeholder={t('organizations.address_book_peer_tags_placeholder')}
		aria-label="{t('organizations.address_book_peer_tags')} {rowNumber(row)}"
		bind:value={row.tags}
	/>{/snippet}
{#snippet idRead(row: Row)}<span class="mono">{row.id}</span>{/snippet}
{#snippet aliasRead(row: Row)}{#if row.alias}{row.alias}{:else}<Empty />{/if}{/snippet}
{#snippet tagsRead(row: Row)}{#if row.tags}<TagSet tags={splitTags(row.tags)} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet passwordCell(row: Row)}<BooleanStatus
		value={!!row.id.trim() && passwords.has(row.id.trim())}
		on={t('organizations.address_book_password_set')}
		off={t('organizations.address_book_password_unset')}
	/>{/snippet}
{#snippet rowMenu(row: Row)}<MenuButton
		kebab
		label={t('organizations.actions_for', { name: row.id || row.alias || String(rowNumber(row)) })}
	>
		<MenuItem icon={ICONS.password} onselect={() => void setPassword(row)}
			>{t('organizations.address_book_set_password')}</MenuItem
		>
		{#if row.id.trim() && passwords.has(row.id.trim())}
			<MenuItem icon={ICONS.delete} onselect={() => void clearPassword(row)}
				>{t('organizations.address_book_clear_password')}</MenuItem
			>
		{/if}
		<MenuDivider />
		<MenuItem icon={ICONS.delete} danger onselect={() => removeRow(row)}
			>{t('organizations.address_book_remove_contact')}</MenuItem
		>
	</MenuButton>{/snippet}

{#if phase === 'loading'}
	<States kind="loading" />
{:else if phase === 'error'}
	<States kind="error" message={loadError} onretry={() => void load()} />
{:else if !canEdit}
	<section class="section" aria-labelledby="{uid}-contacts">
		<p class="section-note">{t('organizations.address_book_intro')}</p>
		<p class="shared">
			{t('organizations.address_book_enabled')}: <BooleanStatus value={form.values.enabled} />
		</p>
		<h2 id="{uid}-contacts">{t('organizations.address_book_contacts')}</h2>
		<p class="section-note">{t('organizations.address_book_password_vault_hint')}</p>
		{#if form.values.peers.length}
			<Table
				rows={form.values.peers}
				columns={readColumns}
				key={(r) => String(r.key)}
				label={t('organizations.address_book_contacts')}
			/>
		{:else}
			<States message={t('organizations.address_book_no_peers')} />
		{/if}
		<h3>{t('organizations.address_book_tags_label')}</h3>
		{#if form.values.tags}<TagSet tags={splitTags(form.values.tags)} />{:else}<Empty />{/if}
	</section>
{:else}
	<form id={form.id} class="book" onsubmit={form.onsubmit} novalidate>
		<section class="section">
			<p class="section-note">{t('organizations.address_book_intro')}</p>
			<Checkbox label={t('organizations.address_book_enabled')} bind:checked={form.values.enabled} />
		</section>

		{#if !asJson}
			<section class="section" aria-labelledby="{uid}-contacts" bind:this={table}>
				<div class="section-head">
					<h2 id="{uid}-contacts">{t('organizations.address_book_contacts')}</h2>
					<Button class="add-contact" size="sm" icon={ICONS.add} onclick={() => void addRow()}
						>{t('organizations.address_book_add_peer')}</Button
					>
					<Button size="sm" icon={ICONS.add} onclick={() => void importOrgDevices()}
						>{t('organizations.address_book_import_devices')}</Button
					>
				</div>
				<p class="section-note">{t('organizations.address_book_password_vault_hint')}</p>
				{#if form.values.peers.length}
					<div class="book-table">
						<Table
							rows={form.values.peers}
							columns={editColumns}
							key={(r) => String(r.key)}
							label={t('organizations.address_book_contacts')}
						/>
					</div>
				{:else}
					<States message={t('organizations.address_book_no_peers')} />
				{/if}
				<Field
					label={t('organizations.address_book_tags_label')}
					hint={t('organizations.address_book_tags_hint')}
				>
					{#snippet children(f)}
						<Input
							{...f}
							width="host"
							placeholder={t('organizations.address_book_tags_placeholder')}
							bind:value={form.values.tags}
						/>
					{/snippet}
				</Field>
			</section>
		{:else}
			<Field
				label={t('organizations.address_book_json')}
				hint={t('organizations.address_book_json_hint')}
				error={form.errors.json}
			>
				{#snippet children(f)}
					<Textarea {...f} class="book-json" spellcheck="false" rows={14} bind:value={form.values.json} />
				{/snippet}
			</Field>
		{/if}
		<div>
			<Button size="sm" aria-pressed={asJson} onclick={toggleJson}
				>{asJson
					? t('organizations.address_book_hide_json')
					: t('organizations.address_book_show_json')}</Button
			>
		</div>

		<SaveBar {form} label={t('organizations.address_book_save')} />
	</form>
{/if}

<style>
	.book {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.shared {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}
	.book-table :global(td) {
		padding-block: var(--space-1);
	}
	.book-table :global(.form-input) {
		min-width: 10ch;
	}
	.book :global(.book-json) {
		min-height: 260px;
		font-family: var(--mono);
		font-size: var(--text-sm);
	}
</style>
