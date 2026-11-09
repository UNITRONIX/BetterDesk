<!--
  One message: who and when on one line (with "Read" or "Delivered" on
  your own), the reaction bar (three quick reactions and the full grid),
  then the file and the text (links open in a new tab), then the reaction
  counts. A system line is muted text only. Everything from the message is
  text, never markup.
-->
<script lang="ts">
	import { formatBytes } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import type { PersonLike } from '#lib/util/display.ts';
	import {
		isMine,
		isPerson,
		linkParts,
		QUICK_REACTIONS,
		type ChatMessage
	} from '#lib/support/chat.svelte.ts';

	interface Props {
		msg: ChatMessage;
		me: string;
		/** A message opened from search is marked for a moment */
		found?: boolean;
		/** Console users with a profile picture, by username */
		person?: (name: string) => PersonLike | string;
		onreact: (msg: ChatMessage, emoji: string) => void;
		/** Opens the full reaction grid at the button */
		onmore: (msg: ChatMessage, anchor: HTMLElement) => void;
	}

	let { msg, me, found = false, person = (n) => n, onreact, onmore }: Props = $props();

	const mine = $derived(isMine(msg, me));
	const name = $derived(msg.from_name || msg.from);
	const parts = $derived(linkParts(msg.text));
	let moreBtn = $state<HTMLButtonElement | null>(null);
</script>

{#if msg.system}
	<div class="chat-msg system" data-id={msg.id}>{msg.text}</div>
{:else}
	<div class={['chat-msg', mine ? 'mine' : 'theirs', found && 'is-found']} data-id={msg.id}>
		<div class="chat-msg-head">
			<span class="chat-msg-sender">
				{#if isPerson(msg)}<User user={person(name)} avatar size="sm" />{:else}{name}{/if}
			</span>
			<span class="chat-msg-meta"
				><Time
					value={msg.timestamp}
					relative={false}
					format={{ year: undefined, month: undefined, day: undefined, hour: '2-digit', minute: '2-digit' }}
				/>{#if mine}, <span class="chat-msg-read"
						>{msg.read ? t('chat.read_receipt') : t('chat.delivered')}</span
					>{/if}</span
			>
			<span class="chat-msg-actions" role="group" aria-label={t('chat.react')}>
				{#each QUICK_REACTIONS as e (e)}
					<button
						type="button"
						class="chat-quick-react"
						aria-label={t('chat.react_with', { emoji: e })}
						title={t('chat.react_with', { emoji: e })}
						onclick={() => onreact(msg, e)}>{e}</button
					>
				{/each}
				<button
					bind:this={moreBtn}
					type="button"
					class="chat-more-react"
					aria-haspopup="menu"
					aria-label={t('chat.more_reactions')}
					title={t('chat.more_reactions')}
					onclick={() => moreBtn && onmore(msg, moreBtn)}><span aria-hidden="true">🙂</span></button
				>
			</span>
		</div>
		<div class="chat-msg-bubble">
			{#if msg.file}
				<p class="chat-file-msg">
					<a href={msg.file.url} target="_blank" rel="noopener noreferrer">{msg.file.name}</a>
					{#if msg.file.size}<span class="chat-file-size">{formatBytes(msg.file.size)}</span>{/if}
				</p>
			{/if}
			{#if msg.text}
				<div class="chat-msg-text">
					{#each parts as p, i (i)}{#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer"
								>{p.text}</a
							>{:else}{p.text}{/if}{/each}
				</div>
			{/if}
		</div>
		{#if Object.keys(msg.reactions).length}
			<div class="chat-reactions">
				{#each Object.entries(msg.reactions) as [emoji, who] (emoji)}
					<button
						type="button"
						class="chat-reaction"
						title={who.join(', ')}
						onclick={() => onreact(msg, emoji)}>{emoji} {who.length}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.chat-msg {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--rule);
		transition: background-color var(--motion);
	}
	.chat-msg:last-child {
		border-bottom: 0;
	}
	.chat-msg.system {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.chat-msg.is-found {
		background: var(--accent-tint);
	}
	.chat-msg-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-2);
	}
	.chat-msg-sender {
		font-weight: 600;
	}
	.chat-msg.mine .chat-msg-sender {
		color: var(--accent);
	}
	.chat-msg-meta {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Reactions: a small bar on the message under the pointer or with focus */
	.chat-msg-actions {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		margin-inline-start: auto;
	}
	.chat-quick-react,
	.chat-more-react {
		min-width: var(--control-h-sm);
		min-height: var(--control-h-sm);
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}
	.chat-quick-react:hover,
	.chat-more-react:hover {
		background: var(--hover);
	}
	@media (hover: hover) {
		.chat-msg:not(:hover):not(:focus-within) .chat-msg-actions {
			opacity: 0;
		}
	}
	/* Touch: no hover, so the grid button stays and the quick ones are in the grid */
	@media (hover: none) {
		.chat-quick-react {
			display: none;
		}
	}
	@media (pointer: coarse) {
		.chat-more-react {
			min-width: 44px;
			min-height: 44px;
		}
	}
	.chat-msg-bubble {
		max-width: var(--measure);
	}
	.chat-msg-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.chat-file-msg {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		margin: 0;
	}
	.chat-file-msg a {
		overflow-wrap: anywhere;
	}
	.chat-file-size {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.chat-reactions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-1);
	}
	.chat-reaction {
		min-height: var(--control-h-sm);
		padding: 0 var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.chat-reaction:hover {
		background: var(--hover);
	}
</style>
