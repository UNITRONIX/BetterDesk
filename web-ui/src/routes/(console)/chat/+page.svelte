<!--
  Chat (/chat): messages with other console users and with the people at a
  device. The list (people and devices, groups) on the start side, the open
  conversation beside it; on a phone one at a time. One search field above
  the list filters names and, from 2 characters, finds messages in every
  loaded conversation (plus what the server finds; it finds nothing yet,
  P8). My status sits under the list.

  Real time: one socket, /ws/chat-operator/panel (reconnects with backoff,
  closes in a hidden tab after 30 s and opens again when shown). It needs
  chat.access; without it the page says so instead of a list that never
  fills. End-to-end encryption stays off (U3): the old page never loaded
  its crypto code.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { listAvatars, MAX_CHAT_FILE, searchChat, uploadChatFile, type AvatarEntry } from '#lib/api/chat.ts';
	import { formatBytes, formatDate } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { socket, type LiveSocket } from '#lib/state/live.ts';
	import { myPresence, setPresence } from '#lib/state/presence.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Avatar from '#lib/ui/Avatar.svelte';
	import Button from '#lib/ui/Button.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Presence from '#lib/ui/Presence.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Split from '#lib/ui/Split.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS, type PersonLike } from '#lib/util/display.ts';
	import {
		ChatState,
		dayOf,
		EMOJI_SET,
		matchesName,
		parseCommand,
		presenceOf,
		searchLoaded,
		sortContacts,
		type ChatMessage,
		type Contact,
		type FrameEffects,
		type Found
	} from '#lib/support/chat.svelte.ts';
	import GroupDialog from './GroupDialog.svelte';
	import MessageItem from './MessageItem.svelte';

	const allowed = $derived(can('chat.access'));
	const me = $derived(session.user?.username ?? '');
	const chat = new ChatState();

	/* ── Socket ── */

	let status = $state<'connecting' | 'open' | 'closed'>('connecting');
	/** The socket has failed at least once since the last time it was open */
	let failed = $state(false);
	let sock: LiveSocket | null = null;

	function send(data: Record<string, unknown>): boolean {
		return sock?.send(data) ?? false;
	}

	$effect(() => {
		if (!allowed) return;
		const s = socket('/ws/chat-operator/panel', {
			onmessage: (data) => handle(data),
			onstatus: (st) => {
				status = st;
				if (st === 'closed') failed = true;
				if (st === 'open') {
					failed = false;
					sock?.send({ type: 'hello', device_id: 'panel', role: 'operator' });
					sock?.send({ type: 'get_contacts', device_id: 'panel' });
					// My status goes out from the effect below, which runs when status turns open
					// Back after a break: the open conversation again
					const open = untrack(() => chat.active);
					if (open) sock?.send({ type: 'get_history', device_id: 'panel', conversation_id: open });
				}
			}
		});
		sock = s;
		return () => {
			s.close();
			sock = null;
		};
	});

	// My status (also changed from the account menu and in other tabs) goes to the others
	$effect(() => {
		const st = myPresence.status;
		if (status === 'open') untrack(() => send({ type: 'presence_update', online: true, status: st }));
	});

	function handle(data: unknown) {
		const fx: FrameEffects = chat.handle(data, me, (action, result) =>
			tf('chat.command_result', 'Result of {action}: {result}', {
				action,
				result: result || tf('chat.command_done', 'done')
			})
		);
		if (fx.receipt) send({ type: 'read_receipt', ...fx.receipt });
		if (fx.notify) notify(fx.notify);
		if (fx.groupCreated !== undefined) {
			toast.success(t('chat.group_created', { name: fx.groupCreated }));
			listTab = 'groups';
		}
		if (fx.scroll) void scrollToEnd();
	}

	/* ── Profile pictures ── */

	let avatars = $state.raw<Map<string, AvatarEntry>>(new Map());
	$effect(() => {
		if (!allowed) return;
		listAvatars().then(
			(list) => (avatars = new Map(list.map((u) => [String(u.username ?? '').toLowerCase(), u]))),
			() => undefined
		);
	});
	function person(name: string): PersonLike | string {
		const a = avatars.get(name.toLowerCase());
		return a ? { id: a.id, username: name, avatar_version: a.avatar_version ?? null } : name;
	}

	/* ── List ── */

	let listTab = $state<'contacts' | 'groups'>('contacts');
	let query = $state('');
	const contacts = $derived(sortContacts(chat.contacts));
	const shownContacts = $derived(contacts.filter((c) => matchesName(c.name, query)));
	const shownGroups = $derived(chat.groups.filter((g) => matchesName(g.name, query)));
	let lastRow: HTMLElement | null = null;

	function roleLabel(role: string): string {
		if (role === 'device') return t('chat.role_device');
		if (role === 'operator') return t('chat.role_operator');
		return role;
	}

	function unreadText(n: number): string {
		return t('chat.unread_count', { count: n > 99 ? '99+' : n });
	}

	function lastOf(id: string): ChatMessage | undefined {
		return chat.conv(id).messages.at(-1);
	}

	/* ── Search ── */

	let serverFound = $state.raw<Found[]>([]);
	let searching = $state(false);
	let searchError = $state(false);
	let searchSeq = 0;
	const q = $derived(query.trim());
	const results = $derived(searchLoaded(chat.conversations, q, serverFound));

	async function searchServer(text: string) {
		const mine = ++searchSeq;
		serverFound = [];
		searchError = false;
		if (text.length < 2) {
			searching = false;
			return;
		}
		searching = true;
		try {
			const found = await searchChat(text);
			if (mine !== searchSeq) return;
			serverFound = found.map((m) => ({
				id: String(m.id ?? ''),
				conversation_id: m.conversation_id ?? '',
				from_name: m.from_name || m.from_id || '',
				text: m.text ?? '',
				timestamp: Number(new Date(m.created_at ?? m.timestamp ?? 0)) || Number(m.timestamp) || 0
			}));
		} catch {
			if (mine === searchSeq) searchError = true;
		} finally {
			if (mine === searchSeq) searching = false;
		}
	}

	$effect(() => {
		const text = q;
		const timer = setTimeout(() => void untrack(() => searchServer(text)), 250);
		return () => clearTimeout(timer);
	});

	let foundId = $state<string | null>(null);
	async function openFound(f: Found) {
		openConversation(f.conversation_id, f.conversation_id.startsWith('group') ? 'group' : 'contact', false);
		foundId = f.id;
		await tick();
		const el = messagesEl?.querySelector<HTMLElement>(`.chat-msg[data-id="${CSS.escape(f.id)}"]`);
		el?.scrollIntoView({ block: 'center' });
		setTimeout(() => {
			if (foundId === f.id) foundId = null;
		}, 2000);
	}

	/* ── Conversation ── */

	let messagesEl = $state<HTMLElement | null>(null);
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let draft = $state('');
	let sendStatus = $state('');
	let pendingFile = $state<File | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);

	const activeContact = $derived(
		chat.activeType === 'contact' ? chat.contacts.find((c) => c.id === chat.active) : undefined
	);
	const activeGroup = $derived(
		chat.activeType === 'group' ? chat.groups.find((g) => g.id === chat.active) : undefined
	);
	const activeName = $derived(activeGroup?.name ?? activeContact?.name ?? chat.active ?? '');
	const activeMessages = $derived(chat.active ? chat.conv(chat.active).messages : []);

	function openConversation(id: string, type: 'contact' | 'group', focus = true) {
		chat.open(id, type);
		sendStatus = '';
		send({ type: 'get_history', device_id: 'panel', conversation_id: id });
		void scrollToEnd();
		if (focus) void tick().then(() => inputEl?.focus());
	}

	function pick(id: string, type: 'contact' | 'group', e: MouseEvent) {
		lastRow = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
		openConversation(id, type);
	}

	function back() {
		chat.close();
		void tick().then(() => {
			if (lastRow?.isConnected) lastRow.focus();
		});
	}

	async function scrollToEnd() {
		await tick();
		requestAnimationFrame(() => {
			if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
		});
	}

	function statusLine(c: Contact | undefined): string {
		if (!c) return '';
		return [roleLabel(c.role), t(`chat.presence_${presenceOf(c)}`)].filter(Boolean).join(', ');
	}

	/** Date separators: a new day starts a new block */
	function dayLabel(ts: number): string {
		const d = dayOf(ts);
		if (d === 'today') return t('chat.today');
		if (d === 'yesterday') return t('chat.yesterday');
		return formatDate(ts, { hour: undefined, minute: undefined });
	}

	/* ── Sending ── */

	let askedNotify = false;
	function askNotifyPermission() {
		if (askedNotify || typeof Notification === 'undefined' || Notification.permission !== 'default') return;
		askedNotify = true;
		void Notification.requestPermission().catch(() => undefined);
	}

	async function sendMessage() {
		const text = draft.trim();
		const conv = chat.active;
		if (!conv || (!text && !pendingFile)) return;
		if (status !== 'open') {
			sendStatus = t('chat.send_failed');
			return;
		}
		sendStatus = '';
		askNotifyPermission();

		const cmd = parseCommand(text);
		if (cmd && !pendingFile) {
			draft = '';
			const label = tf(`chat.cmd_${cmd.def.action}`, cmd.def.label);
			if (cmd.def.confirm) {
				const ok = await confirm({
					title: t('chat.command_confirm', { command: label, device: conv }),
					message: t('chat.command_confirm_hint', { device: conv }),
					confirmLabel: label,
					danger: true
				});
				if (!ok) return;
			}
			send({
				type: 'quick_command',
				conversation_id: conv,
				device_id: conv,
				action: cmd.def.action,
				args: cmd.args
			});
			chat.add({
				id: `local-cmd-${Date.now()}`,
				from: 'system',
				from_name: '',
				text: tf('chat.command_sent', 'Command sent: {command}', {
					command: `${cmd.name} ${cmd.args}`.trim()
				}),
				timestamp: Date.now(),
				conversation_id: conv,
				system: true,
				file: null,
				reactions: {},
				read: false
			});
			void scrollToEnd();
			return;
		}

		if (pendingFile) {
			const file = pendingFile;
			pendingFile = null;
			draft = '';
			await uploadAndShare(conv, file, text);
			return;
		}

		send({ type: 'message', text, conversation_id: conv, timestamp: Date.now() });
		draft = '';
	}

	async function uploadAndShare(conv: string, file: File, caption: string) {
		uploading = true;
		try {
			const up = await uploadChatFile(file);
			send({
				type: 'file_share',
				conversation_id: conv,
				file_id: up.file_id,
				file_name_encrypted: file.name,
				file_size: file.size,
				file_url: up.url
			});
			// The relay sends a shared file to the others only; show it here too
			chat.add({
				id: up.file_id,
				from: 'operator',
				from_name: me,
				text: '',
				timestamp: Date.now(),
				conversation_id: conv,
				system: false,
				file: { id: up.file_id, name: file.name, size: file.size, url: up.url ?? '' },
				reactions: {},
				read: false
			});
			if (caption) send({ type: 'message', text: caption, conversation_id: conv, timestamp: Date.now() });
			toast.success(file.name, t('chat.file_share'));
			void scrollToEnd();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('chat.send_failed'));
		} finally {
			uploading = false;
		}
	}

	function pickFile() {
		const file = fileInput?.files?.[0];
		if (fileInput) fileInput.value = '';
		if (!file) return;
		if (file.size > MAX_CHAT_FILE) {
			toast.error(t('chat.file_too_large'));
			return;
		}
		pendingFile = file;
	}

	let lastTyping = 0;
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void sendMessage();
			return;
		}
		const now = Date.now();
		if (now - lastTyping < 2000 || !chat.active) return;
		lastTyping = now;
		send({ type: 'typing', conversation_id: chat.active });
	}

	// The message field grows with its text up to 120 px
	$effect(() => {
		void draft;
		const el = inputEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	});

	// Typing goes away after 3 s without a new frame
	$effect(() => {
		const tp = chat.typing;
		if (!tp) return;
		const timer = setTimeout(() => {
			if (chat.typing === tp) chat.typing = null;
		}, 3000);
		return () => clearTimeout(timer);
	});

	/* ── Reactions and emoji ── */

	function react(msg: ChatMessage, emoji: string) {
		if (!chat.active) return;
		send({ type: 'reaction', conversation_id: chat.active, message_id: msg.id, emoji });
	}

	/** The one emoji grid: for a message's reactions or for the message field */
	let picker = $state<{ anchor: HTMLElement; onpick: (emoji: string) => void } | null>(null);
	let emojiBtn = $state<HTMLElement | null>(null);

	function moreReactions(msg: ChatMessage, anchor: HTMLElement) {
		picker = { anchor, onpick: (e) => react(msg, e) };
	}

	function emojiForInput() {
		if (!emojiBtn) return;
		if (picker?.anchor === emojiBtn) {
			picker = null;
			return;
		}
		picker = {
			anchor: emojiBtn,
			onpick: (e) => {
				draft += e;
				void tick().then(() => inputEl?.focus());
			}
		};
	}

	/* ── Notifications for messages in other conversations ── */

	function notify(msg: ChatMessage) {
		if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
		if (document.hasFocus()) return;
		try {
			const n = new Notification(`${msg.from_name || msg.from} – ${t('chat.new_message')}`, {
				body: msg.text ? msg.text.slice(0, 100) : t('chat.file_share'),
				icon: '/branding/favicon.svg',
				tag: `chat-${msg.conversation_id}`
			});
			n.onclick = () => {
				window.focus();
				openConversation(msg.conversation_id, msg.conversation_id.startsWith('group') ? 'group' : 'contact');
				n.close();
			};
			setTimeout(() => n.close(), 8000);
		} catch {
			/* notifications blocked */
		}
	}

	/* ── New group ── */

	let groupDialog = $state(false);
	function createGroup(name: string, members: string[]): boolean {
		if (status !== 'open') return false;
		const ids = members.includes('panel') ? members : ['panel', ...members];
		return send({ type: 'create_group', name, member_ids: ids });
	}

	const presenceOptions = $derived([
		{ value: 'online' as const, label: t('chat.presence_online') },
		{ value: 'away' as const, label: t('chat.presence_away') },
		{ value: 'busy' as const, label: t('chat.presence_busy') }
	]);

	const tabs = $derived([
		{ id: 'contacts', label: t('chat.contacts') },
		{ id: 'groups', label: t('chat.groups') }
	]);
</script>

{#snippet lastLine(id: string)}
	{@const last = lastOf(id)}
	{#if last && (last.text || last.file)}<span class="chat-preview">{last.text || last.file?.name}</span>{/if}
{/snippet}

{#snippet rowEnd(id: string, unread: number)}
	{@const last = lastOf(id)}
	<span class="chat-row-end">
		{#if last}<span class="chat-row-time"><Time value={last.timestamp} /></span>{/if}
		{#if unread > 0}<span class="chat-unread">{unreadText(unread)}</span>{/if}
	</span>
{/snippet}

<div class="page page-wide chat-page">
	<div class="page-head">
		<h1>{t('nav.chat')}</h1>
		<p class="page-description">{t('chat.page_description')}</p>
		{#if allowed}
			<div class="page-actions">
				<Button icon={ICONS.add} onclick={() => (groupDialog = true)}>{t('chat.new_group')}</Button>
			</div>
		{/if}
	</div>

	{#if !allowed}
		<Notice
			tone="info"
			message={tf('chat.needs_access', 'Your role cannot use chat. Ask an administrator if you need it.')}
		/>
	{:else}
		{#if failed && status !== 'open'}
			<Notice tone="warning" role="status" message={t('chat.not_connected')} />
		{/if}

		<div class="chat-split">
			<Split open={chat.active !== null} listLabel={t('chat.contacts')}>
				{#snippet list()}
					<div class="chat-sidebar">
						<div class="chat-find" role="search">
							<SearchField label={t('chat.search_placeholder')} autocomplete="off" bind:value={query} />
							{#if q.length === 1}<p class="hint">{t('chat.search_min')}</p>{/if}
						</div>
						{#if q.length >= 2}
							<section class="chat-results" aria-labelledby="chat-results-title">
								<h2 class="chat-results-title" id="chat-results-title">{t('chat.messages')}</h2>
								<div aria-live="polite">
									{#if results.length}
										<RowList>
											{#each results as f (f.conversation_id + '|' + f.id)}
												<ListRow
													title={f.from_name}
													sub={f.text.slice(0, 120)}
													onclick={() => void openFound(f)}
												>
													{#snippet end()}<Time value={f.timestamp} />{/snippet}
												</ListRow>
											{/each}
										</RowList>
									{:else if searchError}
										<p class="state is-error">
											{t('chat.search_failed')}
											<Button size="sm" onclick={() => void searchServer(q)}>{t('actions.retry')}</Button>
										</p>
									{:else}
										<p class="state">{searching ? t('chat.searching') : t('chat.no_results')}</p>
									{/if}
								</div>
							</section>
						{/if}
						<div class="chat-tabs">
							<Tabs
								{tabs}
								value={listTab}
								label={t('nav.chat')}
								onchange={(id) => (listTab = id === 'groups' ? 'groups' : 'contacts')}
							>
								{#snippet children(current)}
									<div class="chat-list-wrap">
										{#if current === 'contacts'}
											<div class="chat-list">
												<RowList>
													{#if !chat.contactsLoaded}
														<ListRow
															empty
															title={status === 'open' || !failed
																? t('chat.loading_contacts')
																: t('chat.contacts_wait_connection')}
														/>
													{:else if !contacts.length}
														<ListRow empty title={t('chat.no_contacts')} />
													{:else if !shownContacts.length}
														<ListRow empty title={t('chat.no_contacts_match')} />
													{:else}
														{#each shownContacts as c (c.id)}
															{@const pres = presenceOf(c)}
															{@const isPerson = c.role === 'operator'}
															<ListRow
																title={c.name}
																current={chat.active === c.id}
																onclick={(e) => pick(c.id, 'contact', e)}
															>
																{#snippet start()}{#if isPerson}<Avatar
																			user={person(c.name)}
																			size="sm"
																			presence={pres}
																		/>{/if}{/snippet}
																{#snippet sub()}<span class="chat-meta"
																		>{#if c.role}<Tag
																				label={roleLabel(c.role)}
																			/>{/if}{#if !isPerson}<Presence status={pres} />{/if}{t(
																			`chat.presence_${pres}`
																		)}</span
																	>{@render lastLine(c.id)}{/snippet}
																{#snippet end()}{@render rowEnd(c.id, chat.conv(c.id).unread)}{/snippet}
															</ListRow>
														{/each}
													{/if}
												</RowList>
											</div>
										{:else}
											<div class="chat-list">
												<RowList>
													{#if !chat.groups.length}
														<ListRow empty title={t('chat.no_groups_hint')} />
													{:else if !shownGroups.length}
														<ListRow empty title={t('chat.no_contacts_match')} />
													{:else}
														{#each shownGroups as g (g.id)}
															<ListRow
																title={g.name}
																current={chat.active === g.id}
																onclick={(e) => pick(g.id, 'group', e)}
															>
																{#snippet sub()}<span class="chat-meta"
																		>{t('chat.member_count', { count: g.members })}</span
																	>{@render lastLine(g.id)}{/snippet}
																{#snippet end()}{@render rowEnd(g.id, chat.conv(g.id).unread)}{/snippet}
															</ListRow>
														{/each}
													{/if}
												</RowList>
											</div>
										{/if}
									</div>
								{/snippet}
							</Tabs>
						</div>
						<div class="chat-presence-bar">
							<label class="presence-label" for="chat-presence">{t('chat.my_presence')}</label>
							<Presence status={myPresence.status} />
							<Select
								id="chat-presence"
								small
								options={presenceOptions}
								value={myPresence.status}
								onchange={(e) => setPresence((e.currentTarget as HTMLSelectElement).value)}
							/>
							<span class="chat-username">{me}</span>
						</div>
					</div>
				{/snippet}
				{#snippet detail()}
					<section class="chat-main" aria-label={t('chat.conversation')}>
						{#if !chat.active}
							<p class="state chat-empty">{t('chat.pick_conversation')}</p>
						{:else}
							<div class="chat-conv-header">
								<Button size="sm" class="chat-back" onclick={back}>{t('chat.all_conversations')}</Button>
								<div class="chat-conv-info">
									<h2 class="chat-conv-name">{activeName}</h2>
									<span class="chat-conv-status"
										>{activeGroup
											? t('chat.member_count', { count: activeGroup.members })
											: statusLine(activeContact)}</span
									>
								</div>
								{#if activeContact?.role === 'device' && can('device.view')}
									<Button size="sm" class="chat-device" onclick={() => chat.active && openDevice(chat.active)}
										>{t('devices.details')}</Button
									>
								{/if}
							</div>

							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div class="chat-messages" bind:this={messagesEl} tabindex="0" aria-label={t('chat.messages')}>
								<div class="chat-messages-inner" role="log" aria-live="polite">
									{#if !activeMessages.length}
										<p class="state">{t('chat.no_messages')}</p>
									{:else}
										{#each activeMessages as m, i (m.id + ':' + i)}
											{@const day = dayLabel(m.timestamp)}
											{#if i === 0 || dayLabel(activeMessages[i - 1]?.timestamp ?? 0) !== day}
												<p class="chat-day">{day}</p>
											{/if}
											<MessageItem
												msg={m}
												{me}
												found={foundId === m.id}
												{person}
												onreact={react}
												onmore={moreReactions}
											/>
										{/each}
									{/if}
								</div>
							</div>

							{#if chat.typing}
								<p class="chat-typing" aria-live="polite">
									{t('chat.typing_name', { name: chat.typing.name })}
								</p>
							{/if}

							<form
								class="chat-input-area"
								onsubmit={(e) => {
									e.preventDefault();
									void sendMessage();
								}}
							>
								{#if pendingFile}
									<div class="chat-file-preview">
										<span class="chat-file-name">{pendingFile.name}</span>
										<span class="chat-file-size">{formatBytes(pendingFile.size)}</span>
										<IconButton
											icon="close"
											label={t('chat.remove_file')}
											onclick={() => (pendingFile = null)}
										/>
									</div>
								{/if}
								<label class="sr-only" for="chat-input">{t('chat.message_label')}</label>
								<Textarea
									id="chat-input"
									class="chat-input"
									rows={2}
									maxlength={4096}
									placeholder={t('chat.message_placeholder')}
									bind:element={inputEl}
									bind:value={draft}
									onkeydown={onKeydown}
								/>
								<div class="chat-input-row">
									<Button icon={ICONS.upload} onclick={() => fileInput?.click()}
										>{t('chat.attach_file')}</Button
									>
									<Button
										bind:element={emojiBtn}
										class="chat-emoji-btn"
										aria-haspopup="menu"
										aria-expanded={picker?.anchor === emojiBtn && !!emojiBtn}
										onclick={emojiForInput}>{t('chat.emoji')}</Button
									>
									<span class={['chat-send-status', sendStatus && 'is-error']} aria-live="polite"
										>{sendStatus}</span
									>
									<Button variant="primary" type="submit" icon={ICONS.send} busy={uploading} class="chat-send"
										>{t('chat.send')}</Button
									>
								</div>
								<input
									bind:this={fileInput}
									type="file"
									class="sr-only"
									tabindex="-1"
									aria-hidden="true"
									onchange={pickFile}
								/>
							</form>
						{/if}
					</section>
				{/snippet}
			</Split>
		</div>
	{/if}

	<!-- The one emoji grid, at the button that opened it -->
	{#if picker}
		<Menu
			open
			anchor={picker.anchor}
			align="end"
			label={t('chat.emoji')}
			class="emoji-grid"
			onclose={(returnFocus) => {
				const a = picker?.anchor;
				picker = null;
				if (returnFocus) a?.focus();
			}}
		>
			{#each EMOJI_SET as e (e)}
				<MenuItem
					onselect={() => {
						const p = picker;
						picker = null;
						p?.onpick(e);
					}}>{e}</MenuItem
				>
			{/each}
		</Menu>
	{/if}
</div>

{#if groupDialog}
	<GroupDialog contacts={chat.contacts} onclose={() => (groupDialog = false)} oncreate={createGroup} />
{/if}

<style>
	/* The page fills the window below the top bar, so the messages scroll and
	   the message field stays in view */
	.chat-page {
		height: calc(100dvh - var(--topbar-h) - var(--page-pad) - var(--space-7));
		min-height: 520px;
		gap: var(--space-4);
	}
	.chat-split {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		border-bottom: 1px solid var(--rule);
	}
	.chat-split > :global(.split) {
		flex: 1;
		min-height: 0;
	}
	@media (min-width: 1200px) {
		.chat-split > :global(.split) {
			grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
		}
	}

	/* ── List ── */
	.chat-sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	/* The list pane does not scroll as a whole: its parts do */
	.chat-split :global(.split-list) {
		overflow: hidden;
	}
	.chat-find {
		padding: var(--space-3) var(--space-3) var(--space-2);
	}
	.hint {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.chat-results {
		max-height: 40vh;
		overflow-y: auto;
		border-bottom: 1px solid var(--rule);
	}
	.chat-results-title {
		margin: 0;
		padding: var(--space-2) var(--space-3) var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.state {
		margin: 0;
		padding: 0 var(--space-3) var(--space-2);
		color: var(--text-muted);
	}
	.state.is-error {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--danger);
	}
	/* Tabs on top, the list under them scrolls, My status stays at the bottom */
	.chat-tabs {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.chat-tabs > :global([role='tablist']) {
		flex: none;
		padding-inline: var(--row-pad-x);
	}
	.chat-tabs > :global([role='tabpanel']) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.chat-list :global(.list) {
		margin-inline: 0;
		border-top: 0;
	}
	.chat-meta {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-2);
	}
	.chat-preview {
		display: block;
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chat-row-end {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.chat-row-time {
		color: var(--text-muted);
	}
	.chat-unread {
		color: var(--accent);
		font-weight: 700;
	}
	.chat-presence-bar {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--row-pad-x);
		border-top: 1px solid var(--rule);
	}
	.presence-label {
		color: var(--text-muted);
	}
	.chat-presence-bar :global(select) {
		width: auto;
	}
	.chat-username {
		margin-inline-start: auto;
		font-weight: 600;
	}

	/* ── Conversation ── */
	.chat-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		height: 100%;
	}
	.chat-empty {
		padding: var(--space-5);
	}
	.chat-conv-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	.chat-conv-info {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-3);
		min-width: 0;
	}
	.chat-conv-name {
		margin: 0;
		font-size: var(--text-md);
		overflow-wrap: anywhere;
	}
	.chat-conv-status {
		color: var(--text-muted);
	}
	.chat-conv-header :global(.chat-back) {
		display: none;
	}
	.chat-conv-header :global(.chat-device) {
		margin-inline-start: auto;
	}
	.chat-messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) var(--space-4);
	}
	.chat-messages:focus-visible {
		outline-offset: -2px;
	}
	.chat-messages-inner,
	.chat-input-area > :global(*),
	.chat-typing {
		max-width: 840px;
	}
	.chat-day {
		margin: var(--space-4) 0 var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.chat-messages-inner .state {
		padding: var(--space-3) 0;
	}
	.chat-typing {
		margin: 0;
		padding: 0 var(--space-4) var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.chat-input-area {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--rule);
	}
	.chat-input-area :global(.chat-input) {
		min-height: 60px;
		max-height: 160px;
		resize: none;
	}
	.chat-input-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.chat-send-status {
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
	}
	.chat-send-status.is-error {
		color: var(--danger);
	}
	.chat-input-row :global(.chat-send) {
		margin-inline-start: auto;
	}
	.chat-file-preview {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.chat-file-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.chat-file-size {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* The emoji grid (a Menu): small square items in rows */
	.chat-page :global(.menu.emoji-grid) {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		width: 232px;
		min-width: 0;
		padding: var(--space-1);
	}
	.chat-page :global(.menu.emoji-grid .menu-item) {
		justify-content: center;
		width: 36px;
		min-height: 36px;
		padding: 0;
		border-radius: var(--radius);
		font-size: 18px;
	}
	@media (pointer: coarse) {
		.chat-page :global(.menu.emoji-grid) {
			width: 280px;
		}
		.chat-page :global(.menu.emoji-grid .menu-item) {
			width: 44px;
			min-height: 44px;
		}
	}

	/* Phones and small tablets: one pane at a time */
	@media (max-width: 767px) {
		.chat-page {
			height: calc(
				100dvh - var(--topbar-h) - var(--page-pad) - var(--space-7) - 56px - env(safe-area-inset-bottom, 0px)
			);
			min-height: 460px;
		}
		.chat-conv-header :global(.chat-back) {
			display: inline-flex;
		}
		.chat-conv-header,
		.chat-messages,
		.chat-input-area,
		.chat-typing,
		.chat-empty {
			padding-inline: 0;
		}
	}
</style>
