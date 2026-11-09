<!--
  Network tools (/toolkit): checks that run on the server, in four groups
  (Network, Crypto, Encoding, Server). The group is in the URL hash
  (#network, #crypto, #encoding, #system) and written back when it
  changes. Each tool is a disclosure with a short form and its result.
  Tools the role may not run are left out (their APIs need device.connect
  or metrics.view), then groups with nothing left; with no tool at all,
  one sentence.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import * as tk from '#lib/api/toolkit.ts';
	import { formatBytes, formatDate, formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';
	import {
		certTone,
		containerRunning,
		diskPercent,
		dnsRows,
		groupFromHash,
		inRange,
		strength,
		TOOLS,
		urlWithGroup,
		validPort,
		visibleGroups,
		visibleTools,
		withScheme,
		type GroupId,
		type ToolId
	} from '#lib/support/toolkit.ts';
	import Tool from './Tool.svelte';

	const tools = $derived(visibleTools(can));
	const groups = $derived(visibleGroups(tools));
	const shown = (id: ToolId) => tools.some((x) => x.id === id);

	/* ── Group in the URL hash ── */

	let group = $state<GroupId | null>(null);
	onMount(() => {
		group = groupFromHash(location.hash, groups);
	});

	async function pickGroup(id: string) {
		group = id as GroupId;
		await tick();
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL with the group as hash
			replaceState(urlWithGroup(location.href, id as GroupId), page.state);
		} catch {
			/* the router is not ready yet */
		}
	}

	const tabItems = $derived(groups.map((g) => ({ id: g, label: t(`toolkit.cat_${g}`) })));

	/** Open tools stay open when the group changes and back */
	let opened = $state<Record<string, boolean>>(Object.fromEntries(TOOLS.map((x) => [x.id, false])));

	/* ── Running a tool ── */

	type Run<T> = { running: boolean; error: string; data: T | null };
	const idle = <T,>(): Run<T> => ({ running: false, error: '', data: null });

	/** Field errors, by field */
	let errors = $state<Record<string, string>>({});

	function need(field: string, key: string): false {
		errors = { ...errors, [field]: t(key) };
		void tick().then(() => document.getElementById(`tk-${field}`)?.focus());
		return false;
	}

	function clear(...fields: string[]) {
		errors = Object.fromEntries(Object.entries(errors).filter(([k]) => !fields.includes(k)));
	}

	async function run<T>(state: Run<T>, work: () => Promise<T>): Promise<void> {
		if (state.running) return;
		state.running = true;
		state.error = '';
		try {
			state.data = await work();
		} catch (err) {
			state.data = null;
			state.error = err instanceof Error && err.message ? err.message : t('toolkit.failed');
		} finally {
			state.running = false;
		}
	}

	const ms = (value: unknown) => t('toolkit.ms', { value: formatNumber(Math.round(Number(value) || 0)) });

	/* Network */
	let pingHost = $state('');
	const pingRun = $state(idle<tk.PingResult & { asked: string }>());
	function doPing() {
		clear('ping-host');
		const host = pingHost.trim();
		if (!host) return need('ping-host', 'toolkit.need_host');
		void run(pingRun, async () => ({ ...(await tk.ping(host)), asked: host }));
	}

	let tcpHost = $state('');
	let tcpPort = $state<string | number>(443);
	const tcpRun = $state(idle<tk.TcpResult & { address: string }>());
	function doTcp() {
		clear('tcp-host', 'tcp-port');
		const host = tcpHost.trim();
		if (!host) return need('tcp-host', 'toolkit.need_host');
		if (!validPort(tcpPort)) return need('tcp-port', 'toolkit.need_port');
		const port = Number(tcpPort);
		void run(tcpRun, async () => ({ ...(await tk.tcp(host, port)), address: `${host}:${port}` }));
	}

	let sslHost = $state('');
	let sslPort = $state<string | number>(443);
	const sslRun = $state(idle<tk.SslInfo>());
	function doSsl() {
		clear('ssl-host');
		const host = sslHost.trim();
		if (!host) return need('ssl-host', 'toolkit.need_host');
		const port = validPort(sslPort) ? Number(sslPort) : 443;
		void run(sslRun, () => tk.ssl(host, port));
	}

	let httpUrl = $state('');
	const httpRun = $state(idle<tk.HttpResult & { url: string }>());
	function doHttp() {
		clear('http-url');
		if (!httpUrl.trim()) return need('http-url', 'toolkit.need_url');
		const url = withScheme(httpUrl);
		void run(httpRun, async () => ({ ...(await tk.http(url)), url }));
	}

	let dnsDomain = $state('');
	const dnsRun = $state(idle<{ host: string; addresses: string[] }>());
	function doDns() {
		clear('dns-domain');
		const host = dnsDomain.trim();
		if (!host) return need('dns-domain', 'toolkit.need_domain');
		void run(dnsRun, async () => {
			const r = await tk.resolve(host);
			return { host: r.host || host, addresses: r.addresses };
		});
	}

	let whoisDomain = $state('');
	const whoisRun = $state(idle<{ domain: string; rows: { type: string; value: string }[] }>());
	function doWhois() {
		clear('whois-domain');
		const domain = whoisDomain.trim();
		if (!domain) return need('whois-domain', 'toolkit.need_domain');
		void run(whoisRun, async () => {
			const d = await tk.whois(domain);
			return {
				domain: d.domain || domain,
				rows: dnsRows(d, (host, priority) => t('toolkit.mx_value', { host, priority }), t('toolkit.mx_null'))
			};
		});
	}

	const speedRun = $state(idle<{ bytes: number; seconds: number }>());
	const doSpeed = () => void run(speedRun, () => tk.speedTest());

	let wolMac = $state('');
	let wolBroadcast = $state('');
	const wolRun = $state(idle<{ mac: string; broadcast: string }>());
	function doWol() {
		clear('wol-mac');
		const mac = wolMac.trim();
		if (!mac) return need('wol-mac', 'toolkit.need_mac');
		const broadcast = wolBroadcast.trim() || '255.255.255.255';
		void run(wolRun, async () => {
			const d = await tk.wakeOnLan(mac, broadcast);
			return { mac: d.mac ?? mac, broadcast: d.broadcast ?? broadcast };
		});
	}

	/* Crypto */
	let hashAlgo = $state<tk.HashAlgorithm>('sha256');
	let hashText = $state('');
	const hashRun = $state(idle<{ label: string; hash: string }>());
	const hashOptions = [
		{ value: 'md5' as const, label: 'MD5' },
		{ value: 'sha1' as const, label: 'SHA-1' },
		{ value: 'sha256' as const, label: 'SHA-256' },
		{ value: 'sha512' as const, label: 'SHA-512' }
	];
	function doHash() {
		clear('hash-input');
		if (!hashText) return need('hash-input', 'toolkit.need_text');
		const algo = hashAlgo;
		const label = hashOptions.find((o) => o.value === algo)?.label ?? algo.toUpperCase();
		void run(hashRun, async () => ({ label, hash: (await tk.hash(hashText, algo)).hash }));
	}

	let pwdLength = $state<string | number>(20);
	let pwdUpper = $state(true);
	let pwdLower = $state(true);
	let pwdDigits = $state(true);
	let pwdSymbols = $state(false);
	const pwdRun = $state(idle<tk.Password>());
	function doPassword() {
		clear('pwd-length');
		if (!inRange(pwdLength, 4, 128)) return need('pwd-length', 'toolkit.need_length');
		void run(pwdRun, () =>
			tk.password({
				length: Number(pwdLength),
				uppercase: pwdUpper,
				lowercase: pwdLower,
				digits: pwdDigits,
				symbols: pwdSymbols
			})
		);
	}

	let jwtToken = $state('');
	const jwtRun = $state(idle<tk.Jwt>());
	function doJwt() {
		clear('jwt-input');
		const token = jwtToken.trim();
		if (!token) return need('jwt-input', 'toolkit.need_token');
		void run(jwtRun, () => tk.jwtDecode(token));
	}

	/* Encoding */
	let b64Text = $state('');
	const b64Run = $state(idle<{ mode: tk.CodecMode; result: string }>());
	function doB64(mode: tk.CodecMode) {
		clear('b64-input');
		if (!b64Text) return need('b64-input', 'toolkit.need_text');
		void run(b64Run, async () => ({ mode, result: (await tk.base64(b64Text, mode)).result }));
	}

	let urlText = $state('');
	const urlRun = $state(idle<{ mode: tk.CodecMode; result: string }>());
	function doUrl(mode: tk.CodecMode) {
		clear('url-input');
		if (!urlText) return need('url-input', 'toolkit.need_text');
		void run(urlRun, async () => ({ mode, result: (await tk.urlEncode(urlText, mode)).result }));
	}

	/* Server */
	const procRun = $state(idle<tk.SystemInfo>());
	const doProc = () => void run(procRun, () => tk.systemInfo());
	const diskRun = $state(idle<tk.SystemInfo>());
	const doDisk = () => void run(diskRun, () => tk.systemInfo());
	const dbRun = $state(idle<Awaited<ReturnType<typeof tk.databaseStats>>>());
	const doDb = () => void run(dbRun, () => tk.databaseStats());
	const dockerRun = $state(idle<tk.Containers>());
	const doDocker = () => void run(dockerRun, () => tk.dockerContainers());

	let logSource = $state<tk.LogSource>('console');
	let logLines = $state<string | number>(50);
	const logRun = $state(idle<{ source: tk.LogSource; lines: string[] }>());
	function doLogs() {
		clear('log-lines');
		if (!inRange(logLines, 10, 200)) return need('log-lines', 'toolkit.need_lines');
		const source = logSource;
		void run(logRun, async () => ({
			source,
			lines: (await tk.recentLogs(source, Number(logLines))).lines ?? []
		}));
	}

	const logOptions = $derived([
		{ value: 'console' as const, label: t('toolkit.log_console') },
		{ value: 'go' as const, label: t('toolkit.log_go') }
	]);

	/* Result tables */
	type Proc = NonNullable<tk.SystemInfo['processes']>[number] & { i: number };
	type Disk = NonNullable<tk.SystemInfo['disks']>[number] & { i: number };
	type Box = NonNullable<tk.Containers['containers']>[number] & { i: number };
	const dnsColumns = $derived<Column<{ type: string; value: string; i: number }>[]>([
		{ id: 'type', label: t('toolkit.record_type'), cell: dnsTypeCell },
		{ id: 'value', label: t('toolkit.record_value'), cell: dnsValueCell }
	]);
	const procColumns = $derived<Column<Proc>[]>([
		{ id: 'name', label: t('toolkit.process_name'), cell: procNameCell },
		{ id: 'cpu', label: t('toolkit.cpu_percent'), cell: procCpuCell, align: 'num' },
		{ id: 'mem', label: t('toolkit.memory_mb'), cell: procMemCell, align: 'num' }
	]);
	const diskColumns = $derived<Column<Disk>[]>([
		{ id: 'mount', label: t('toolkit.mount'), cell: diskMountCell },
		{ id: 'used', label: t('toolkit.used'), cell: diskUsedCell, minWidth: '220px' }
	]);
	const dbColumns = $derived<Column<{ name: string; count: number }>[]>([
		{ id: 'name', label: t('toolkit.table_name'), cell: dbNameCell },
		{ id: 'count', label: t('toolkit.row_count'), cell: dbCountCell, align: 'num' }
	]);
	const dockerColumns = $derived<Column<Box>[]>([
		{ id: 'name', label: t('toolkit.container'), cell: boxNameCell },
		{ id: 'status', label: t('toolkit.status'), cell: boxStatusCell },
		{ id: 'ports', label: t('toolkit.ports'), cell: boxPortsCell }
	]);

	/** One submit handler per form: Enter in a field runs the tool */
	function submit(fn: () => unknown) {
		return (e: SubmitEvent) => {
			e.preventDefault();
			fn();
		};
	}
</script>

<!-- ── Table cells ── -->

{#snippet dnsTypeCell(r: { type: string })}{r.type}{/snippet}
{#snippet dnsValueCell(r: { value: string })}<span class="mono wrap">{r.value}</span>{/snippet}
{#snippet procNameCell(p: Proc)}<span class="mono wrap">{p.name || p.command || ''}</span>{/snippet}
{#snippet procCpuCell(p: Proc)}{formatNumber(Number(p.cpu) || 0, { maximumFractionDigits: 1 })}{/snippet}
{#snippet procMemCell(p: Proc)}{formatNumber(Number(p.mem) || 0, { maximumFractionDigits: 0 })}{/snippet}
{#snippet diskMountCell(d: Disk)}<span class="mono">{d.mount || d.name || ''}</span>{/snippet}
{#snippet diskUsedCell(d: Disk)}{@const pct = diskPercent(d.used, d.total)}<Meter
		value={pct}
		high={85}
		full={95}
		text={t('toolkit.used_of', {
			used: formatBytes(Number(d.used) || 0),
			total: formatBytes(Number(d.total) || 0),
			percent: pct
		})}
	/>{/snippet}
{#snippet dbNameCell(r: { name: string })}{r.name}{/snippet}
{#snippet dbCountCell(r: { count: number })}{formatNumber(r.count)}{/snippet}
{#snippet boxNameCell(c: Box)}<span class="mono">{c.name || c.names || ''}</span><span class="sub mono"
		>{c.image ?? ''}</span
	>{/snippet}
{#snippet boxStatusCell(c: Box)}<Status
		tone={containerRunning(c) ? 'ok' : 'offline'}
		label={c.status || c.state || ''}
	/>{/snippet}
{#snippet boxPortsCell(c: Box)}{#if c.ports}<span class="mono wrap">{c.ports}</span>{:else}<Empty
		/>{/if}{/snippet}

<!-- ── Shared result pieces ── -->

{#snippet actions(state: Run<unknown>, label: string, icon: string = ICONS.run)}
	<div class="tool-actions">
		<Button type="submit" {icon} busy={state.running}>{label}</Button>
		<span class="form-status" aria-live="polite">{state.running ? t('toolkit.running') : ''}</span>
	</div>
{/snippet}

{#snippet failed(state: Run<unknown>)}
	{#if state.error}<p class="state is-error">{state.error}</p>{/if}
{/snippet}

{#snippet textField(
	id: string,
	label: string,
	bindTo: { get: () => string; set: (v: string) => void },
	opts: { hint?: string; placeholder?: string; inputmode?: 'url' | 'text' } = {}
)}
	<Field {id} {label} hint={opts.hint} error={errors[id.replace(/^tk-/, '')]}>
		{#snippet children(f)}
			<Input
				{...f}
				width="medium"
				autocapitalize="off"
				autocomplete="off"
				spellcheck="false"
				placeholder={opts.placeholder}
				inputmode={opts.inputmode}
				bind:value={bindTo.get, bindTo.set}
			/>
		{/snippet}
	</Field>
{/snippet}

<div class="page page-wide toolkit-page">
	<div class="page-head">
		<h1>{t('nav.toolkit')}</h1>
		<p class="page-description">{t('toolkit.page_description')}</p>
	</div>

	{#if !groups.length}
		<Notice tone="info" message={t('toolkit.none_allowed')} />
	{:else if group}
		<Tabs
			tabs={tabItems}
			value={group}
			label={t('toolkit.groups_label')}
			onchange={(id) => void pickGroup(id)}
		>
			{#snippet children(current)}
				<div class="tool-list">
					{#if current === 'network'}
						{#if shown('ping')}
							<Tool
								id="ping"
								bind:open={opened['ping']}
								title={t('toolkit.ping_title')}
								desc={t('toolkit.ping_desc')}
							>
								<form onsubmit={submit(doPing)} novalidate>
									{@render textField(
										'tk-ping-host',
										t('toolkit.host'),
										{ get: () => pingHost, set: (v) => (pingHost = v) },
										{ hint: t('toolkit.host_hint'), placeholder: 'example.com' }
									)}
									{@render actions(pingRun, t('toolkit.ping_run'))}
								</form>
								{#snippet result()}
									{@render failed(pingRun)}
									{#if pingRun.data}
										{@const d = pingRun.data}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.host')}</dt>
											<dd><ValueCopy value={d.host || d.asked} copy={false} /></dd>
											<dt>{t('toolkit.result')}</dt>
											<dd>
												{#if d.success}<Status tone="ok" label={t('toolkit.ping_answered')} />{:else}<Status
														tone="error"
														label={t('toolkit.ping_no_answer')}
													/>{/if}
											</dd>
											{#if d.success && d.rtt_ms != null}<dt>{t('toolkit.response_time')}</dt>
												<dd>{ms(d.rtt_ms)}</dd>{/if}
											{#if !d.success && d.error}<dt>{t('toolkit.reason')}</dt>
												<dd>{d.error}</dd>{/if}
										</dl>
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('tcp')}
							<Tool
								id="tcp"
								bind:open={opened['tcp']}
								title={t('toolkit.tcp_title')}
								desc={t('toolkit.tcp_desc')}
							>
								<form onsubmit={submit(doTcp)} novalidate>
									{@render textField(
										'tk-tcp-host',
										t('toolkit.host'),
										{ get: () => tcpHost, set: (v) => (tcpHost = v) },
										{ hint: t('toolkit.host_hint'), placeholder: 'example.com' }
									)}
									<Field id="tk-tcp-port" label={t('toolkit.port')} error={errors['tcp-port']}>
										{#snippet children(f)}
											<Input
												{...f}
												type="number"
												width="short"
												min={1}
												max={65535}
												inputmode="numeric"
												bind:value={tcpPort}
											/>
										{/snippet}
									</Field>
									{@render actions(tcpRun, t('toolkit.tcp_run'))}
								</form>
								{#snippet result()}
									{@render failed(tcpRun)}
									{#if tcpRun.data}
										{@const d = tcpRun.data}
										{@const open = !!(d.success || d.open || d.connected)}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.address')}</dt>
											<dd><ValueCopy value={d.address} copy={false} /></dd>
											<dt>{t('toolkit.result')}</dt>
											<dd>
												{#if open}<Status tone="ok" label={t('toolkit.port_open')} />{:else}<Status
														tone="error"
														label={t('toolkit.port_closed')}
													/>{/if}
											</dd>
											{#if open && d.rtt_ms != null}<dt>{t('toolkit.connect_time')}</dt>
												<dd>{ms(d.rtt_ms)}</dd>{/if}
											{#if !open && d.error}<dt>{t('toolkit.reason')}</dt>
												<dd>{d.error}</dd>{/if}
										</dl>
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('ssl')}
							<Tool
								id="ssl"
								bind:open={opened['ssl']}
								title={t('toolkit.ssl_title')}
								desc={t('toolkit.ssl_desc')}
							>
								<form onsubmit={submit(doSsl)} novalidate>
									{@render textField(
										'tk-ssl-host',
										t('toolkit.host'),
										{ get: () => sslHost, set: (v) => (sslHost = v) },
										{ placeholder: 'example.com' }
									)}
									<Field id="tk-ssl-port" label={t('toolkit.port')}>
										{#snippet children(f)}
											<Input
												{...f}
												type="number"
												width="short"
												min={1}
												max={65535}
												inputmode="numeric"
												bind:value={sslPort}
											/>
										{/snippet}
									</Field>
									{@render actions(sslRun, t('toolkit.ssl_run'))}
								</form>
								{#snippet result()}
									{@render failed(sslRun)}
									{#if sslRun.data}
										{@const d = sslRun.data}
										{@const days = Number(d.daysLeft)}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.subject')}</dt>
											<dd>{d.subject ?? ''}</dd>
											<dt>{t('toolkit.issuer')}</dt>
											<dd>
												{d.issuer ?? ''}{#if d.organization && d.organization !== d.issuer}
													({d.organization}){/if}
											</dd>
											<dt>{t('toolkit.valid_from')}</dt>
											<dd><Time value={d.validFrom} relative={false} /></dd>
											<dt>{t('toolkit.valid_to')}</dt>
											<dd><Time value={d.validTo} relative={false} /></dd>
											<dt>{t('toolkit.days_left')}</dt>
											<dd>
												<Status
													tone={certTone(days)}
													label={days < 0
														? t('toolkit.cert_expired_ago', { count: Math.abs(days) })
														: t('toolkit.days_left_count', { count: days })}
												/>
											</dd>
											<dt>{t('toolkit.trusted')}</dt>
											<dd>{d.authorized ? t('common.yes') : t('toolkit.not_trusted')}</dd>
											{#if d.protocol}<dt>{t('toolkit.protocol')}</dt>
												<dd>{d.protocol}</dd>{/if}
											{#if d.cipher?.name}<dt>{t('toolkit.cipher')}</dt>
												<dd>{d.cipher.name}</dd>{/if}
											{#if d.altNames?.length}<dt>{t('toolkit.alt_names')}</dt>
												<dd>
													<ul class="plain mono">
														{#each d.altNames as n, i (i)}<li>{n}</li>{/each}
													</ul>
												</dd>{/if}
											{#if d.serial}<dt>{t('toolkit.serial')}</dt>
												<dd><ValueCopy value={d.serial} label={t('toolkit.serial')} /></dd>{/if}
											{#if d.fingerprint}<dt>{t('toolkit.fingerprint')}</dt>
												<dd><ValueCopy value={d.fingerprint} label={t('toolkit.fingerprint')} /></dd>{/if}
										</dl>
										{#if d.chain && d.chain.length > 1}
											<h3 class="tool-sub">{t('toolkit.chain')}</h3>
											<ol class="chain">
												{#each d.chain as c, i (i)}
													<li>
														{c.subject ?? ''}
														<span class="text-muted"
															>{t('toolkit.issued_by', { issuer: c.issuer ?? '' })}</span
														>
													</li>
												{/each}
											</ol>
										{/if}
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('http')}
							<Tool
								id="http"
								bind:open={opened['http']}
								title={t('toolkit.http_title')}
								desc={t('toolkit.http_desc')}
							>
								<form onsubmit={submit(doHttp)} novalidate>
									{@render textField(
										'tk-http-url',
										t('toolkit.url'),
										{ get: () => httpUrl, set: (v) => (httpUrl = v) },
										{ hint: t('toolkit.url_hint'), placeholder: 'https://example.com', inputmode: 'url' }
									)}
									{@render actions(httpRun, t('toolkit.http_run'))}
								</form>
								{#snippet result()}
									{@render failed(httpRun)}
									{#if httpRun.data}
										{@const d = httpRun.data}
										{@const code = d.status_code ?? 0}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.url')}</dt>
											<dd><ValueCopy value={d.url} copy={false} /></dd>
											<dt>{t('toolkit.result')}</dt>
											<dd>
												{#if code}<Status
														tone={code >= 200 && code < 400 ? 'ok' : 'error'}
														label={t('toolkit.http_answered', { code })}
													/>{:else}<Status tone="error" label={t('toolkit.http_no_answer')} />{/if}
											</dd>
											{#if d.rtt_ms != null}<dt>{t('toolkit.response_time')}</dt>
												<dd>{ms(d.rtt_ms)}</dd>{/if}
											{#if d.error}<dt>{t('toolkit.reason')}</dt>
												<dd>{d.error}</dd>{/if}
										</dl>
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('dns')}
							<Tool
								id="dns"
								bind:open={opened['dns']}
								title={t('toolkit.dns_title')}
								desc={t('toolkit.dns_desc')}
							>
								<form onsubmit={submit(doDns)} novalidate>
									{@render textField(
										'tk-dns-domain',
										t('toolkit.domain'),
										{ get: () => dnsDomain, set: (v) => (dnsDomain = v) },
										{ placeholder: 'example.com' }
									)}
									{@render actions(dnsRun, t('toolkit.dns_run'))}
								</form>
								{#snippet result()}
									{@render failed(dnsRun)}
									{#if dnsRun.data}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.domain')}</dt>
											<dd><ValueCopy value={dnsRun.data.host} copy={false} /></dd>
											<dt>{t('toolkit.resolved')}</dt>
											<dd>
												{#if dnsRun.data.addresses.length}
													<ul class="plain mono">
														{#each dnsRun.data.addresses as a, i (i)}<li>{a}</li>{/each}
													</ul>
												{:else}{t('toolkit.no_address')}{/if}
											</dd>
										</dl>
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('whois')}
							<Tool
								id="whois"
								bind:open={opened['whois']}
								title={t('toolkit.whois_title')}
								desc={t('toolkit.whois_desc')}
							>
								<form onsubmit={submit(doWhois)} novalidate>
									{@render textField(
										'tk-whois-domain',
										t('toolkit.domain'),
										{ get: () => whoisDomain, set: (v) => (whoisDomain = v) },
										{ placeholder: 'example.com' }
									)}
									{@render actions(whoisRun, t('toolkit.whois_run'))}
								</form>
								{#snippet result()}
									{@render failed(whoisRun)}
									{#if whoisRun.data}
										{@const d = whoisRun.data}
										{#if !d.rows.length}
											<p class="state">{t('toolkit.no_records', { domain: d.domain })}</p>
										{:else}
											<p class="count-line">
												{t('toolkit.records_count', { count: d.rows.length, domain: d.domain })}
											</p>
											<Table
												rows={d.rows.map((r, i) => ({ ...r, i }))}
												columns={dnsColumns}
												key={(r) => String(r.i)}
												label={t('toolkit.whois_title')}
											/>
										{/if}
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('speed')}
							<Tool
								id="speed"
								bind:open={opened['speed']}
								title={t('toolkit.speed_title')}
								desc={t('toolkit.speed_desc')}
							>
								<form onsubmit={submit(doSpeed)} novalidate>
									{@render actions(speedRun, t('toolkit.run_speed_test'))}
								</form>
								{#snippet result()}
									{@render failed(speedRun)}
									{#if speedRun.data}
										{@const d = speedRun.data}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.download_speed')}</dt>
											<dd>
												<strong
													>{t('toolkit.mbit', {
														value: formatNumber((d.bytes * 8) / Math.max(d.seconds, 0.001) / 1e6, {
															maximumFractionDigits: 1
														})
													})}</strong
												>
											</dd>
											<dt>{t('toolkit.transferred')}</dt>
											<dd>{formatBytes(d.bytes)}</dd>
											<dt>{t('toolkit.duration')}</dt>
											<dd>{ms(d.seconds * 1000)}</dd>
										</dl>
									{/if}
								{/snippet}
							</Tool>
						{/if}
						{#if shown('wol')}
							<Tool
								id="wol"
								bind:open={opened['wol']}
								title={t('toolkit.wol_title')}
								desc={t('toolkit.wol_desc')}
							>
								<form onsubmit={submit(doWol)} novalidate>
									{@render textField(
										'tk-wol-mac',
										t('toolkit.mac_address'),
										{ get: () => wolMac, set: (v) => (wolMac = v) },
										{ placeholder: 'AA:BB:CC:DD:EE:FF' }
									)}
									{@render textField(
										'tk-wol-broadcast',
										t('toolkit.broadcast'),
										{ get: () => wolBroadcast, set: (v) => (wolBroadcast = v) },
										{ hint: t('toolkit.broadcast_hint'), placeholder: '255.255.255.255' }
									)}
									{@render actions(wolRun, t('toolkit.wol_run'), ICONS.power_on)}
								</form>
								{#snippet result()}
									{@render failed(wolRun)}
									{#if wolRun.data}
										<Notice
											tone="ok"
											message={t('toolkit.wol_sent_to', {
												mac: wolRun.data.mac,
												broadcast: wolRun.data.broadcast
											})}
										/>
									{/if}
								{/snippet}
							</Tool>
						{/if}
					{:else if current === 'crypto'}
						<Tool
							id="hash"
							bind:open={opened['hash']}
							title={t('toolkit.hash_title')}
							desc={t('toolkit.hash_desc')}
						>
							<form onsubmit={submit(doHash)} novalidate>
								<Field id="tk-hash-algo" label={t('toolkit.algorithm')}>
									{#snippet children(f)}<Select
											{...f}
											width="medium"
											options={hashOptions}
											bind:value={hashAlgo}
										/>{/snippet}
								</Field>
								<Field id="tk-hash-input" label={t('toolkit.input_text')} error={errors['hash-input']}>
									{#snippet children(f)}<Textarea
											{...f}
											rows={3}
											spellcheck="false"
											bind:value={hashText}
										/>{/snippet}
								</Field>
								{@render actions(hashRun, t('toolkit.hash_run'))}
							</form>
							{#snippet result()}
								{@render failed(hashRun)}
								{#if hashRun.data}<CodeBlock title={hashRun.data.label} code={hashRun.data.hash} />{/if}
							{/snippet}
						</Tool>
						<Tool
							id="password"
							bind:open={opened['password']}
							title={t('toolkit.password_title')}
							desc={t('toolkit.password_desc')}
						>
							<form onsubmit={submit(doPassword)} novalidate>
								<Field
									id="tk-pwd-length"
									label={t('toolkit.length')}
									hint={t('toolkit.length_hint')}
									error={errors['pwd-length']}
								>
									{#snippet children(f)}
										<Input
											{...f}
											type="number"
											width="short"
											min={4}
											max={128}
											inputmode="numeric"
											bind:value={pwdLength}
										/>
									{/snippet}
								</Field>
								<fieldset class="tool-checks">
									<legend>{t('toolkit.characters')}</legend>
									<Checkbox inline label={t('toolkit.chars_upper')} bind:checked={pwdUpper} />
									<Checkbox inline label={t('toolkit.chars_lower')} bind:checked={pwdLower} />
									<Checkbox inline label={t('toolkit.chars_digits')} bind:checked={pwdDigits} />
									<Checkbox inline label={t('toolkit.chars_symbols')} bind:checked={pwdSymbols} />
								</fieldset>
								{@render actions(pwdRun, t('toolkit.password_run'))}
							</form>
							{#snippet result()}
								{@render failed(pwdRun)}
								{#if pwdRun.data}
									{@const s = strength(pwdRun.data.entropy)}
									<ValueField value={pwdRun.data.password} label={t('toolkit.password_title')} />
									<p class="tool-strength">
										<Status tone={s.tone} label={t(`toolkit.${s.key}`)} />
										<span class="text-muted">{t('toolkit.entropy_bits', { bits: pwdRun.data.entropy })}</span>
									</p>
								{/if}
							{/snippet}
						</Tool>
						<Tool
							id="jwt"
							bind:open={opened['jwt']}
							title={t('toolkit.jwt_title')}
							desc={t('toolkit.jwt_desc')}
						>
							<form onsubmit={submit(doJwt)} novalidate>
								<Field
									id="tk-jwt-input"
									label={t('toolkit.jwt_token')}
									hint={t('toolkit.jwt_hint')}
									error={errors['jwt-input']}
								>
									{#snippet children(f)}<Textarea
											{...f}
											rows={3}
											spellcheck="false"
											bind:value={jwtToken}
										/>{/snippet}
								</Field>
								{@render actions(jwtRun, t('toolkit.decode'), ICONS.decode)}
							</form>
							{#snippet result()}
								{@render failed(jwtRun)}
								{#if jwtRun.data}
									{@const d = jwtRun.data}
									{#if d.expiry}
										<dl class="facts tool-facts">
											<dt>{t('toolkit.expiry')}</dt>
											<dd>
												<Status
													tone={d.expiry.expired ? 'error' : 'ok'}
													label={d.expiry.expired
														? t('toolkit.expired_on', { date: formatDate(d.expiry.date) })
														: t('toolkit.valid_until', { date: formatDate(d.expiry.date) })}
												/>
											</dd>
										</dl>
									{/if}
									<CodeBlock
										title={t('toolkit.jwt_header')}
										code={JSON.stringify(d.header ?? null, null, 2)}
									/>
									<CodeBlock
										title={t('toolkit.jwt_payload')}
										code={JSON.stringify(d.payload ?? null, null, 2)}
									/>
								{/if}
							{/snippet}
						</Tool>
					{:else if current === 'encoding'}
						<Tool
							id="base64"
							bind:open={opened['base64']}
							title={t('toolkit.base64_title')}
							desc={t('toolkit.base64_desc')}
						>
							<form onsubmit={submit(() => doB64('encode'))} novalidate>
								<Field id="tk-b64-input" label={t('toolkit.input_text')} error={errors['b64-input']}>
									{#snippet children(f)}<Textarea
											{...f}
											rows={3}
											spellcheck="false"
											bind:value={b64Text}
										/>{/snippet}
								</Field>
								<div class="tool-actions">
									<Button type="submit" icon={ICONS.encode} busy={b64Run.running}
										>{t('toolkit.encode')}</Button
									>
									<Button icon={ICONS.decode} disabled={b64Run.running} onclick={() => doB64('decode')}
										>{t('toolkit.decode')}</Button
									>
									<span class="form-status" aria-live="polite"
										>{b64Run.running ? t('toolkit.running') : ''}</span
									>
								</div>
							</form>
							{#snippet result()}
								{@render failed(b64Run)}
								{#if b64Run.data}<CodeBlock
										title={b64Run.data.mode === 'decode' ? t('toolkit.decoded') : t('toolkit.encoded')}
										code={b64Run.data.result}
									/>{/if}
							{/snippet}
						</Tool>
						<Tool
							id="urlencode"
							bind:open={opened['urlencode']}
							title={t('toolkit.url_title')}
							desc={t('toolkit.url_desc')}
						>
							<form onsubmit={submit(() => doUrl('encode'))} novalidate>
								<Field id="tk-url-input" label={t('toolkit.input_text')} error={errors['url-input']}>
									{#snippet children(f)}<Textarea
											{...f}
											rows={3}
											spellcheck="false"
											bind:value={urlText}
										/>{/snippet}
								</Field>
								<div class="tool-actions">
									<Button type="submit" icon={ICONS.encode} busy={urlRun.running}
										>{t('toolkit.encode')}</Button
									>
									<Button icon={ICONS.decode} disabled={urlRun.running} onclick={() => doUrl('decode')}
										>{t('toolkit.decode')}</Button
									>
									<span class="form-status" aria-live="polite"
										>{urlRun.running ? t('toolkit.running') : ''}</span
									>
								</div>
							</form>
							{#snippet result()}
								{@render failed(urlRun)}
								{#if urlRun.data}<CodeBlock
										title={urlRun.data.mode === 'decode' ? t('toolkit.decoded') : t('toolkit.encoded')}
										code={urlRun.data.result}
									/>{/if}
							{/snippet}
						</Tool>
					{:else if current === 'system'}
						<Tool
							id="processes"
							bind:open={opened['processes']}
							title={t('toolkit.processes_title')}
							desc={t('toolkit.processes_desc')}
						>
							<form onsubmit={submit(doProc)} novalidate>
								{@render actions(procRun, t('toolkit.show_processes'))}
							</form>
							{#snippet result()}
								{@render failed(procRun)}
								{#if procRun.data}
									{@const procs = procRun.data.processes ?? []}
									{#if !procs.length}<p class="state">{t('toolkit.no_processes')}</p>{:else}
										<Table
											rows={procs.map((p, i) => ({ ...p, i }))}
											columns={procColumns}
											key={(r) => String(r.i)}
											label={t('toolkit.processes_title')}
										/>
									{/if}
								{/if}
							{/snippet}
						</Tool>
						<Tool
							id="disk"
							bind:open={opened['disk']}
							title={t('toolkit.disk_title')}
							desc={t('toolkit.disk_desc')}
						>
							<form onsubmit={submit(doDisk)} novalidate>
								{@render actions(diskRun, t('toolkit.show_disks'))}
							</form>
							{#snippet result()}
								{@render failed(diskRun)}
								{#if diskRun.data}
									{@const disks = diskRun.data.disks ?? []}
									{#if !disks.length}<p class="state">{t('toolkit.no_disks')}</p>{:else}
										<Table
											rows={disks.map((x, i) => ({ ...x, i }))}
											columns={diskColumns}
											key={(r) => String(r.i)}
											label={t('toolkit.disk_title')}
										/>
									{/if}
								{/if}
							{/snippet}
						</Tool>
						<Tool id="db" bind:open={opened['db']} title={t('toolkit.db_title')} desc={t('toolkit.db_desc')}>
							<form onsubmit={submit(doDb)} novalidate>{@render actions(dbRun, t('toolkit.show_db'))}</form>
							{#snippet result()}
								{@render failed(dbRun)}
								{#if dbRun.data}
									{@const d = dbRun.data}
									<dl class="facts tool-facts">
										{#if d.type}<dt>{t('toolkit.db_type')}</dt>
											<dd>{d.type}</dd>{/if}
										{#if d.size}<dt>{t('toolkit.db_size')}</dt>
											<dd>{d.size}</dd>{/if}
										<dt>{t('toolkit.last_backup')}</dt>
										<dd><Time value={d.last_backup} empty={t('toolkit.no_backup')} /></dd>
									</dl>
									{#if d.tables.length}
										<Table
											rows={d.tables}
											columns={dbColumns}
											key={(r) => r.name}
											label={t('toolkit.db_title')}
										/>
									{/if}
								{/if}
							{/snippet}
						</Tool>
						<Tool
							id="docker"
							bind:open={opened['docker']}
							title={t('toolkit.docker_title')}
							desc={t('toolkit.docker_desc')}
						>
							<form onsubmit={submit(doDocker)} novalidate>
								{@render actions(dockerRun, t('toolkit.show_containers'))}
							</form>
							{#snippet result()}
								{@render failed(dockerRun)}
								{#if dockerRun.data}
									{@const list = dockerRun.data.containers ?? []}
									{#if !list.length}
										<p class="state">
											{dockerRun.data.available === false
												? t('toolkit.docker_unavailable')
												: t('toolkit.no_containers')}
										</p>
									{:else}
										<Table
											rows={list.map((c, i) => ({ ...c, i }))}
											columns={dockerColumns}
											key={(r) => String(r.i)}
											label={t('toolkit.docker_title')}
										/>
									{/if}
								{/if}
							{/snippet}
						</Tool>
						<Tool
							id="logs"
							bind:open={opened['logs']}
							title={t('toolkit.logs_title')}
							desc={t('toolkit.logs_desc')}
						>
							<form onsubmit={submit(doLogs)} novalidate>
								<Field id="tk-log-source" label={t('toolkit.source')}>
									{#snippet children(f)}<Select
											{...f}
											width="medium"
											options={logOptions}
											bind:value={logSource}
										/>{/snippet}
								</Field>
								<Field
									id="tk-log-lines"
									label={t('toolkit.lines')}
									hint={t('toolkit.lines_hint')}
									error={errors['log-lines']}
								>
									{#snippet children(f)}
										<Input
											{...f}
											type="number"
											width="short"
											min={10}
											max={200}
											inputmode="numeric"
											bind:value={logLines}
										/>
									{/snippet}
								</Field>
								{@render actions(logRun, t('toolkit.show_logs'))}
							</form>
							{#snippet result()}
								{@render failed(logRun)}
								{#if logRun.data}
									{@const d = logRun.data}
									{#if !d.lines.length}<p class="state">{t('toolkit.no_log_lines')}</p>{:else}
										<CodeBlock
											title={t('toolkit.log_title', {
												source: d.source === 'go' ? t('toolkit.log_go') : t('toolkit.log_console'),
												count: d.lines.length
											})}
											code={d.lines.join('\n')}
										/>
									{/if}
								{/if}
							{/snippet}
						</Tool>
					{/if}
				</div>
			{/snippet}
		</Tabs>
	{/if}
</div>

<style>
	.tool-list {
		display: flex;
		flex-direction: column;
	}
	/* Very wide screens: closed tools in two columns, read left to right; an
	   open tool takes the whole row with its form and result side by side */
	@media (min-width: 1600px) {
		.tool-list {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
			column-gap: var(--space-7);
		}
		.tool-list > :global(.tool[open]) {
			grid-column: 1 / -1;
		}
	}
	.tool-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.form-status {
		color: var(--text-muted);
	}
	.tool-checks {
		min-width: 0;
		margin: 0 0 var(--space-4);
		padding: 0;
		border: 0;
	}
	.tool-checks legend {
		margin-bottom: var(--space-1);
		padding: 0;
		font-weight: 600;
	}
	.tool-checks :global(.checkbox-row) {
		display: flex;
	}
	.tool-facts {
		grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
	}
	.tool-sub {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--text-base);
	}
	.state {
		margin: 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	.count-line {
		margin: 0 0 var(--space-2);
		color: var(--text-muted);
	}
	.plain {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chain {
		margin: 0;
		padding-inline-start: var(--space-5);
	}
	.chain > li + li {
		margin-top: var(--space-1);
	}
	.wrap {
		overflow-wrap: anywhere;
	}
	.sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.tool-strength {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: var(--space-3) 0 0;
	}
	.toolkit-page :global(.tool-result .code-block-wrap + .code-block-wrap),
	.toolkit-page :global(.tool-result .facts + .code-block-wrap) {
		margin-top: var(--space-4);
	}
	@media (max-width: 640px) {
		.tool-facts {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
