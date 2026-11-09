<!--
  One ticket in a wide sheet: its facts, the status and assignee buttons
  right under them, the description, attachments and the comments. The
  comment field sits between the scrolling body and the footer, so it
  stays in view and keeps a half-written comment while the ticket reloads.
  Footer: Delete (start), Edit, Close. Results go in the status line.

  A device ID opens the device panel, which takes the sheet's place (one
  sheet at a time); closing the panel returns to the list.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		addComment,
		attachmentUrl,
		getTicket,
		MAX_ATTACHMENT_BYTES,
		updateTicket,
		uploadAttachment,
		type Ticket,
		type TicketChanges,
		type TicketDetail
	} from '#lib/api/tickets.ts';
	import { ApiError } from '#lib/api/client.ts';
	import { formatBytes } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import {
		isOverdue,
		priorityTone,
		safeKey,
		statusActions,
		statusTone,
		type StatusAction
	} from '#lib/support/tickets.ts';

	interface Props {
		id: number;
		/** The list's copy, for the title while the ticket loads */
		initial?: Ticket | undefined;
		onclose: () => void;
		/** Something changed: reload the list */
		onchanged: () => void;
		onedit: (ticket: Ticket) => void;
		ondelete: (ticket: Ticket) => Promise<boolean>;
	}

	let { id, initial, onclose, onchanged, onedit, ondelete }: Props = $props();

	const uid = $props.id();
	let ticket = $state.raw<TicketDetail | null>(null);
	let loadError = $state<string | null>(null);
	let status = $state('');
	let statusKind = $state<'neutral' | 'ok' | 'error'>('neutral');
	let busy = $state(false);
	let comment = $state('');
	let internal = $state(false);
	let commentError = $state<string | undefined>(undefined);
	let commentField = $state<HTMLTextAreaElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let sheetEl = $state<HTMLElement | null>(null);

	const canEdit = $derived(can('device.edit'));
	const canOpenDevice = $derived(can('device.view'));
	/** The server keeps internal notes from viewers out (role name, as it checks) */
	const canInternal = $derived(session.user?.role !== 'viewer');
	const me = $derived(session.user?.username ?? '');
	const title = $derived(
		ticket ? `#${ticket.id} ${ticket.title}` : initial ? `#${initial.id} ${initial.title}` : `#${id}`
	);

	function say(text: string, kind: 'neutral' | 'ok' | 'error' = 'ok') {
		status = text;
		statusKind = kind;
	}

	function message(err: unknown): string {
		return err instanceof Error && err.message ? err.message : t('tickets.load_detail_failed');
	}

	let seq = 0;
	async function load(): Promise<void> {
		const mine = ++seq;
		try {
			const d = await getTicket(id);
			if (mine !== seq) return;
			ticket = d;
			loadError = null;
		} catch (err) {
			if (mine !== seq) return;
			loadError = `${t('tickets.load_detail_failed')} ${err instanceof ApiError ? err.message : ''}`.trim();
		}
	}

	$effect(() => {
		void id;
		untrack(() => void load());
	});

	async function change(changes: TicketChanges) {
		if (busy || !ticket) return;
		busy = true;
		try {
			await updateTicket(ticket.id, changes);
			await load();
			onchanged();
			say(t('tickets.updated_success'));
			// The pressed button may be gone after the reload: keep focus in the sheet
			await tick();
			(sheetEl?.querySelector<HTMLElement>('.ticket-actions .btn') ?? commentField)?.focus();
		} catch (err) {
			say(message(err), 'error');
		} finally {
			busy = false;
		}
	}

	function run(a: StatusAction) {
		if (a.kind === 'status') void change({ status: a.status });
		else if (a.kind === 'assign') void change({ assigned_to: me });
		else void change({ assigned_to: null });
	}

	function actionLabel(a: StatusAction): string {
		if (a.kind === 'assign') return t('tickets.assign_to_me');
		if (a.kind === 'unassign') return t('tickets.unassign');
		if (a.status === 'in_progress') return t('tickets.mark_in_progress');
		if (a.status === 'resolved') return t('tickets.mark_resolved');
		return t('tickets.close_ticket');
	}

	async function sendComment(e?: SubmitEvent) {
		e?.preventDefault();
		if (busy || !ticket) return;
		const text = comment.trim();
		if (!text) {
			commentError = t('tickets.comment_required');
			say(t('tickets.comment_required'), 'error');
			commentField?.focus();
			return;
		}
		busy = true;
		try {
			await addComment(ticket.id, text, canInternal && internal);
			comment = '';
			internal = false;
			commentError = undefined;
			await load();
			say(t('tickets.comment_added'));
			await tick();
			sheetEl?.querySelector('.ticket-comments > li:last-child')?.scrollIntoView({ block: 'nearest' });
			commentField?.focus();
		} catch (err) {
			say(message(err), 'error');
		} finally {
			busy = false;
		}
	}

	async function attach() {
		const file = fileInput?.files?.[0];
		if (fileInput) fileInput.value = '';
		if (!file || !ticket) return;
		if (file.size > MAX_ATTACHMENT_BYTES) {
			say(tf('tickets.attach_too_large', 'This file is larger than 25 MB.'), 'error');
			return;
		}
		busy = true;
		say(tf('tickets.attach_uploading', 'Uploading {name}…', { name: file.name }), 'neutral');
		try {
			await uploadAttachment(ticket.id, file);
			await load();
			say(tf('tickets.attach_done', '{name} attached.', { name: file.name }));
		} catch (err) {
			say(message(err), 'error');
		} finally {
			busy = false;
		}
	}

	function openDeviceFromSheet(deviceId: string) {
		// The panel takes the sheet's place; closing it goes back to the list
		openDevice(deviceId);
	}

	async function remove() {
		if (!ticket) return;
		if (await ondelete(ticket)) onclose();
	}
</script>

{#snippet deviceValue(deviceId: string)}{#if !deviceId}<Empty />{:else if canOpenDevice}<Button
			variant="link"
			class="mono ticket-device"
			onclick={() => openDeviceFromSheet(deviceId)}>{deviceId}</Button
		>{:else}<span class="mono">{deviceId}</span>{/if}{/snippet}

<Sheet {title} wide class="ticket-sheet" bind:element={sheetEl} {status} statusTone={statusKind} {onclose}>
	{#snippet body()}
		<div class="sheet-body ticket-body">
			{#if loadError}
				<p class="state is-error">
					<span>{loadError}</span>
					<Button size="sm" icon={ICONS.refresh} onclick={() => void load()}>{t('actions.retry')}</Button>
				</p>
			{:else if !ticket}
				<p class="state">{t('common.loading')}</p>
			{:else}
				{@const overdue = isOverdue(ticket)}
				<dl class="facts ticket-facts">
					<dt>{t('tickets.status')}</dt>
					<dd>
						<Status tone={statusTone(ticket.status)} label={t(`tickets.status_${safeKey(ticket.status)}`)} />
					</dd>
					<dt>{t('tickets.priority')}</dt>
					<dd>
						<Status
							tone={priorityTone(ticket.priority)}
							label={t(`tickets.priority_${safeKey(ticket.priority)}`)}
						/>
					</dd>
					<dt>{t('tickets.category')}</dt>
					<dd>
						{#if ticket.category}<Tag
								label={tf(`tickets.category_${safeKey(ticket.category)}`, ticket.category)}
							/>{:else}<Empty />{/if}
					</dd>
					<dt>{t('tickets.assigned_to')}</dt>
					<dd><User user={ticket.assigned_to || null} avatar empty={t('tickets.unassigned')} /></dd>
					<dt>{t('tickets.device')}</dt>
					<dd>{@render deviceValue(ticket.device_id)}</dd>
					<dt>{t('tickets.created_by')}</dt>
					<dd><User user={ticket.created_by || null} /></dd>
					<dt>{t('tickets.created_at')}</dt>
					<dd><Time value={ticket.created_at} relative={false} /></dd>
					<dt>{t('tickets.sla_due')}</dt>
					<dd>
						{#if ticket.sla_due_at}<Time value={ticket.sla_due_at} relative={false} />{#if overdue}<span
									class="sla-overdue">{t('tickets.sla_overdue')}</span
								>{/if}{:else}<Empty />{/if}
					</dd>
				</dl>

				{#if canEdit}
					{@const actions = statusActions(ticket, me)}
					{#if actions.length}
						<div class="ticket-actions" role="group" aria-label={t('tickets.status_actions')}>
							{#each actions as a (a.kind + (a.kind === 'status' ? a.status : ''))}
								<Button
									size="sm"
									icon={a.kind === 'status' && a.status === 'resolved' ? ICONS.resolve : undefined}
									disabled={busy}
									onclick={() => run(a)}>{actionLabel(a)}</Button
								>
							{/each}
						</div>
					{/if}
				{/if}

				{#if ticket.description}
					<section class="ticket-block">
						<h3>{t('tickets.description')}</h3>
						<p class="ticket-text">{ticket.description}</p>
					</section>
				{/if}

				{#if ticket.attachments.length || canEdit}
					<section class="ticket-block" aria-labelledby="{uid}-att">
						<div class="block-head">
							<h3 id="{uid}-att">{t('tickets.attachments')}</h3>
							{#if canEdit}
								<Button
									size="sm"
									icon={ICONS.upload}
									disabled={busy}
									aria-describedby="{uid}-att-hint"
									onclick={() => fileInput?.click()}>{tf('tickets.attach_file', 'Attach a file')}</Button
								>
								<input
									bind:this={fileInput}
									type="file"
									class="sr-only"
									tabindex="-1"
									aria-hidden="true"
									onchange={() => void attach()}
								/>
							{/if}
						</div>
						{#if canEdit}<p class="hint" id="{uid}-att-hint">
								{tf(
									'tickets.attach_hint',
									'Files up to 25 MB. Everyone who can see this ticket can download them.'
								)}
							</p>{/if}
						{#if ticket.attachments.length}
							<RowList label={t('tickets.attachments')}>
								{#each ticket.attachments as a (a.id)}
									<ListRow
										href={attachmentUrl(a.id)}
										chevron={false}
										title={a.filename}
										sub={a.uploaded_by
											? `${formatBytes(a.size_bytes)}, ${a.uploaded_by}`
											: formatBytes(a.size_bytes)}
									/>
								{/each}
							</RowList>
						{:else}
							<p class="state">{t('tickets.no_attachments')}</p>
						{/if}
					</section>
				{/if}

				<section class="ticket-block" aria-labelledby="{uid}-comments">
					<h3 id="{uid}-comments">{t('tickets.comments')}</h3>
					{#if ticket.comments.length}
						<ul class="ticket-comments">
							{#each ticket.comments as c (c.id)}
								<li class={['comment', c.is_internal && 'is-internal']}>
									<div class="comment-main">
										<span class="comment-head">
											<User user={c.author || null} avatar size="sm" />,
											<Time value={c.created_at} />{#if c.is_internal}, <span class="internal-label"
													>{t('tickets.internal_label')}</span
												>{/if}
										</span>
										<p class="ticket-text">{c.body}</p>
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="state">{t('tickets.no_comments')}</p>
					{/if}
				</section>
			{/if}
		</div>
		{#if ticket}
			<form class="ticket-composer" onsubmit={sendComment} novalidate>
				<label class="composer-label" for="{uid}-comment">{t('tickets.comment_label')}</label>
				<Textarea
					id="{uid}-comment"
					rows={2}
					maxlength={2000}
					bind:element={commentField}
					bind:value={comment}
					invalid={!!commentError}
					oninput={() => (commentError = undefined)}
				/>
				<div class="composer-row">
					{#if canInternal}
						<Checkbox inline label={t('tickets.internal_note')} bind:checked={internal} />
					{/if}
					<Button variant="primary" type="submit" busy={busy && !!comment.trim()}
						>{t('tickets.add_comment')}</Button
					>
				</div>
			</form>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if canEdit && ticket}
			<Button
				class="sheet-footer-start ticket-delete"
				variant="danger-quiet"
				icon={ICONS.delete}
				onclick={() => void remove()}>{t('tickets.delete')}</Button
			>
			<Button class="ticket-edit" icon={ICONS.edit} onclick={() => ticket && onedit(ticket)}
				>{t('tickets.edit')}</Button
			>
		{/if}
		<Button onclick={onclose}>{t('actions.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.ticket-body {
		display: flex;
		flex-direction: column;
	}
	/* Narrower labels than the page's facts; on a phone one column (base.css) */
	@media (min-width: 641px) {
		.ticket-facts {
			grid-template-columns: minmax(110px, 160px) minmax(0, 1fr);
		}
	}
	.sla-overdue {
		color: var(--warning);
		font-weight: 600;
	}
	.ticket-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.ticket-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}
	.block-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.block-head h3 {
		margin-inline-end: auto;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.ticket-text {
		margin: 0;
		max-width: var(--measure);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/* Comments on rules, like the console's row lists */
	.ticket-comments {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.comment {
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.comment .ticket-text {
		margin-top: 2px;
	}
	.comment-head {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.internal-label {
		color: var(--warning);
		font-weight: 600;
	}
	.state {
		margin: 0;
		color: var(--text-muted);
	}
	.state.is-error {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--danger);
	}

	/* The comment field, pinned between the scrolling body and the footer */
	.ticket-composer {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--sheet-pad-x, var(--space-5));
		border-top: 1px solid var(--rule);
		background: var(--bg-float);
	}
	.composer-label {
		font-weight: 600;
	}
	.ticket-composer :global(textarea) {
		min-height: calc(2 * var(--control-h));
		max-height: 30vh;
		resize: vertical;
	}
	.composer-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2) var(--space-4);
	}
	.composer-row :global(.checkbox-row) {
		margin-inline-end: auto;
	}
	@media (max-width: 640px) {
		.ticket-composer :global(textarea) {
			min-height: calc(1.5 * var(--control-h));
			max-height: 20vh;
		}
	}
	@media (pointer: coarse) {
		.ticket-body :global(.ticket-device) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
