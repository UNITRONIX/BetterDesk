<!--
  Component kit (developer page, dev server only: +page.ts answers 404 in a
  build). Every component in src/lib/ui in the sections, states and order
  of .ui-rework/ui-kit.html, then the components the old kit has no
  section for, in the order of .ui-rework/tools/svelte-kit-ref.html.
  Hover and focus are shown with .is-hover and .is-focus: on mount the page
  copies every :hover and :focus(-visible) rule of the loaded stylesheets to
  those classes, as ui-kit.html does. Sample text is in S below (developer
  text, not translated).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { formatBytes, formatDuration, formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import Avatar from '#lib/ui/Avatar.svelte';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import ColorField from '#lib/ui/ColorField.svelte';
	import ColumnChooser from '#lib/ui/ColumnChooser.svelte';
	import ConnectionDiagram from '#lib/ui/ConnectionDiagram.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FilePicker from '#lib/ui/FilePicker.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Input from '#lib/ui/Input.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Pagination from '#lib/ui/Pagination.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Presence from '#lib/ui/Presence.svelte';
	import QR from '#lib/ui/QR.svelte';
	import Radio from '#lib/ui/Radio.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Select from '#lib/ui/Select.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import Split from '#lib/ui/Split.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Terminal from '#lib/ui/Terminal.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import Version from '#lib/ui/Version.svelte';
	import type { Column, SortState } from '#lib/ui/table.ts';
	import type { TerminalConnect } from '#lib/ui/terminal.ts';

	// Sample text: a developer page, so it is not in the translation files
	const S = {
		kit: 'Component kit',
		buttons: 'Buttons',
		iconButtons: 'Icon buttons',
		menus: 'Menu button and menu',
		fields: 'Fields',
		checks: 'Checkboxes and radios',
		segmented: 'Segmented control (view filters)',
		tabs: 'Tabs',
		toolbar: 'Toolbar',
		table: 'Table',
		inline: 'Inline actions and values',
		dataDisplay: 'Data display',
		sheets: 'Sheets and dialogs',
		moreFields: 'More fields',
		forms: 'Save bar, status, danger zone',
		feedback: 'Toasts, notices, states',
		disclosure: 'Disclosure',
		paginationBar: 'Pagination bar',
		people: 'Avatars and presence',
		values: 'Values',
		text: 'Code, steps, flags, QR',
		platforms: 'Platforms',
		lists: 'Row list and split',
		tableStates: 'Table states and selection',
		charts: 'Charts',
		diagram: 'Connection diagram',
		terminal: 'Terminal',
		vDefault: 'default',
		vHover: 'hover',
		vFocus: 'focus',
		vOpen: 'open',
		vDisabled: 'disabled',
		kSecondary: 'secondary',
		kPrimary: 'primary',
		kGhost: 'ghost',
		kDangerQuiet: 'danger-quiet',
		kDanger: 'danger',
		kSm: 'sm',
		kSmGhost: 'sm ghost',
		kSmPrimary: 'sm primary',
		kClose: 'close',
		kKebab: 'row menu',
		kCopy: 'copy',
		export: 'Export',
		addUser: 'Add user',
		newFolder: 'New folder',
		deleteDots: 'Delete…',
		deleteDevice: 'Delete device',
		approve: 'Approve',
		reject: 'Reject',
		newGroup: 'New group',
		saveFlow: 'Save flow',
		close: 'Close',
		actions: 'Actions',
		copy: 'Copy',
		connect: 'Connect',
		closeSearch: 'Close search',
		searchMessages: 'Search messages',
		columns: 'Columns',
		edit: 'Edit',
		tagsHover: 'Tags (hover)',
		moveFocus: 'Move to folder (focus)',
		view: 'View',
		platform: 'Platform',
		lastSeen: 'Last seen',
		lDefault: 'Default',
		hDefault: 'Placeholder in --text-muted.',
		lFocus: 'Focus',
		lDisabled: 'Disabled',
		lInvalid: 'Invalid',
		eInvalid: 'Use a port from 1 to 65535.',
		lSelect: 'Select',
		lSearch: 'Search field',
		searchDevices: 'Search by ID, name, user or tag',
		lSmallSelect: 'Small select',
		apply: 'Apply',
		lTextarea: 'Text area',
		showDeleted: 'Show deleted',
		checked: 'Checked',
		radio: 'Radio',
		twoFactor: 'Require two-factor sign-in',
		twoFactorHint: 'Everyone sets up an authenticator app at the next sign-in.',
		enrollMode: 'Enrollment mode',
		approval: 'Approval',
		approvalDesc: 'New devices wait until someone approves them.',
		open: 'Open',
		openDesc: 'Any device can join without approval.',
		status: 'Status',
		all: 'All',
		onlineHover: 'Online (hover)',
		offlineFocus: 'Offline (focus)',
		banned: 'Banned',
		list: 'List',
		grid: 'Grid',
		online: 'Online',
		offline: 'Offline',
		overview: 'Overview',
		hardwareHover: 'Hardware (hover)',
		metricsFocus: 'Metrics (focus)',
		overviewFocus: 'Overview (open, focus)',
		hardware: 'Hardware',
		metrics: 'Metrics',
		search: 'Search',
		tagsMenu: 'Tags',
		device: 'Device',
		devices: 'Devices',
		selected: 'demo-reception-02 (selected)',
		justNow: 'Just now',
		hoursAgo: '11h ago',
		inSentence: 'A link in a sentence that runs an action is a link button:',
		resolved: '3 resolved',
		notVariant: 'It is not a button variant.',
		valueField: 'Device ID',
		warning: 'Warning',
		approved: 'Approved',
		waiting: 'Waiting',
		queued: 'Queued',
		rejected: 'Rejected',
		noSignal: 'No signal',
		degraded: 'Degraded',
		failed: 'Failed',
		ddGood: 'Status, good',
		ddWaiting: 'Status, waiting',
		ddNeutral: 'Status, neutral',
		ddWarning: 'Status, warning',
		ddDanger: 'Status, danger',
		ddOnOff: 'On / off',
		ddCategory: 'Category, source, type',
		ddTagIcon: 'Tag with an icon',
		ddTags: 'Tags',
		ddValues: 'ID, address, port',
		ddVersion: 'Version',
		ddTime: 'Time',
		ddPlatform: 'Platform',
		ddPerson: 'Person',
		ddAvatars: 'Avatar colours, sizes',
		ddNoValue: 'No value',
		ddNumbers: 'Number, size, length, share',
		cStatus: '<Status tone="good" label>',
		cStatusW: '<Status tone="waiting" label>',
		cStatusN: '<Status tone="neutral" label>',
		cStatusWa: '<Status tone="warning" label>',
		cStatusD: '<Status tone="danger" label>',
		cBool: '<BooleanStatus value>',
		cTag: '<Tag label>',
		cTagIcon: '<Tag label icon="history">',
		cTags: '<TagSet tags>',
		cValue: '<ValueCopy value copy>',
		cVersion: '<Version version>',
		cTime: '<Time value>',
		cPlatform: '<Platform platform>',
		cUser: '<User user avatar picture>',
		cAvatar: '<Avatar user size picture>',
		cEmpty: '<Empty> / <Empty word="Never">',
		cNumbers: 'formatNumber / formatBytes / formatDuration / formatPercent',
		localNetwork: 'Local network',
		rustdeskClient: 'RustDesk client',
		operator: 'Operator',
		scheduled: 'Scheduled',
		manual: 'Manual',
		client: 'Client',
		never: 'Never',
		enrollment: 'An enrollment request',
		aDevice: 'A device',
		numbersTable: 'Numbers in a table',
		ipAddress: 'IP address',
		cameVia: 'Came in via',
		asked: 'Asked',
		byLinus: 'by Linus Rath',
		openDevice: 'Open device',
		id: 'ID',
		name: 'Name',
		type: 'Type',
		tags: 'Tags',
		session: 'Session',
		signedInAs: 'Signed in as',
		length: 'Length',
		dataSent: 'Data sent',
		files: 'Files',
		cpu: 'CPU',
		recording: 'Recording',
		sessions: 'Sessions',
		openSheet: 'Open the sheet',
		openWide: 'Open a wide sheet',
		openDialog: 'Open a dialog',
		openStacked: 'Open a dialog over the sheet',
		sheetTitle: 'Add RDP/VNC target',
		sheetSub:
			'A computer without the BetterDesk client. People connect to it in the browser, through this server.',
		displayName: 'Display name',
		displayNameHint: 'How it appears in the device list.',
		connection: 'Connection',
		technology: 'Technology',
		host: 'Host or IP',
		port: 'Port',
		signIn: 'Sign-in',
		password: 'Password',
		askEvery: 'Ask at every connection',
		saveOnServer: 'Save on this server',
		savedPassword: 'Saved password',
		savedPasswordHint: 'Shown only while "Save on this server" is chosen.',
		reached: 'Reached 10.0.9.14 on port 3389.',
		cancel: 'Cancel',
		testConnection: 'Test connection',
		save: 'Save',
		wideTitle: 'Edit workflow',
		wideSub: 'Steps run in order on every device in the group.',
		dialogTitle: 'Delete device?',
		dialogMessage: 'demo-reception-01 leaves the list. It can join again with a new request.',
		discardTitle: 'Discard changes?',
		discardMessage: 'The target is not saved yet.',
		discard: 'Discard',
		timeout: 'Session timeout',
		timeoutHint: 'Minutes without activity before someone is signed out.',
		appliesNew: 'Applies to new sessions.',
		relayPort: 'Relay port',
		afterRestart: 'Applies after a restart of the server.',
		useProxy: 'Use a proxy',
		useProxyHint: 'Connections to the update server go through it.',
		proxyHost: 'Proxy host',
		accent: 'Accent colour',
		accentHex: 'Accent colour, hex value',
		logo: 'Logo',
		logoHint: 'PNG or SVG, up to 1 MB.',
		saveSignIn: 'Save sign-in settings',
		saved: 'Saved.',
		couldNotSave: 'Could not save: the server did not answer.',
		testing: 'Testing…',
		reset: 'Reset',
		resetNote: 'These change the whole server at once.',
		regenTitle: 'Regenerate server key',
		regenDesc: 'Every client stops connecting until it gets the new key.',
		regen: 'Regenerate…',
		wipeTitle: 'Delete all devices',
		wipeDesc: 'The list is emptied; devices join again with new requests.',
		wipe: 'Delete all…',
		countLine: '{count} devices, {online} online',
		tSaved: 'Saved',
		tRenamed: 'The device was renamed.',
		tCouldNot: 'Could not save',
		tNoAnswer: 'The server did not answer.',
		tRestart: 'Restart needed to apply.',
		tOffline: 'Two devices are offline.',
		tNoTitle: 'Message without a title.',
		nInfo: 'Devices update their client on the next restart.',
		nWarning: 'Restoring secrets replaces the server key. Every client must be set up again.',
		nDanger: 'The relay server does not answer on port 21117.',
		nOk: 'Backups run every night at 02:00.',
		nTitle: 'Two-factor sign-in is off',
		nTitleMsg: 'Anyone with a password can sign in.',
		loadingRequests: 'Loading requests…',
		noRequests: 'No help requests. They appear here when someone asks for help from the desktop app.',
		couldNotLoad: 'Could not load requests.',
		tryAgain: 'Try again',
		serverDetails: 'Server details',
		threeRules: '3 rules',
		openDisclosure: 'Advanced options',
		disclosureBody: 'Content of the open section.',
		pages: 'Pages',
		ben: 'Ben Cole',
		zoe: 'Zoe Hart',
		noah: 'Noah Park',
		eva: 'Eva Lind',
		tom: 'Tom Fischer',
		admin: 'admin',
		linus: 'Linus Rath',
		jan: 'Jan Blume',
		symbols: '***',
		away: 'Away',
		busy: 'Busy',
		serverKey: 'Server key',
		config: 'Config string',
		version: 'Version',
		uptime: 'Uptime',
		relay: 'Relay',
		notSet: 'Not set',
		disk: 'Disk',
		devicesShare: 'Devices',
		install: 'install.ps1',
		step1: 'Download the installer.',
		step2: 'Run it as administrator.',
		step3: 'Enter the server address and key.',
		english: 'English',
		german: 'Deutsch',
		arabic: 'العربية',
		chineseTw: '繁體中文',
		unmapped: 'Esperanto',
		qrLabel: 'QR code for the server configuration',
		chromeos: 'ChromeOS 126',
		ios: 'iOS 18',
		debian: 'Debian 12',
		unknownOs: 'Plan 9',
		enrollments: 'Enrollment requests',
		enrollmentsSub: 'New devices that asked to join',
		helpRequests: 'Help requests',
		helpSub: 'Waiting for an operator',
		noAlerts: 'No alerts.',
		buttonRow: 'Row that runs one thing',
		buttonRowSub: 'A button over the whole row',
		withActions: 'Row with actions',
		withActionsSub: 'Opens with a click anywhere; the buttons stay separate',
		current: 'Current item',
		plainRow: 'Plain row',
		plainSub: 'Nothing to open',
		ago: '2h ago',
		chat: 'Chat',
		pickConversation: 'Pick a conversation on the start side.',
		selectAll: 'Select all',
		loadingDevices: 'Loading devices…',
		noDevices: 'No devices match the filter.',
		couldNotLoadDevices: 'Could not load the devices.',
		lineLabel: 'Devices online',
		lineSummary: 'Between 9 and 14 devices were online each day; most on Thursday.',
		colLabel: 'Connections per day',
		colSummary: 'Most connections were on Tuesday (31).',
		day: 'Day',
		windowsS: 'Windows',
		linuxS: 'Linux',
		connections: 'Connections',
		terminalLabel: 'Shell on the console host',
		terminalDone: 'Session ended.',
		deskHost: 'desk.example.com',
		codePs:
			'$ErrorActionPreference = "Stop"\nInvoke-WebRequest https://remote.example.com/install.ps1 -OutFile install.ps1\n.\\install.ps1 -Server remote.example.com -Key QmFzZTY0IHNlcnZlciBrZXk=',
		codeSh: 'docker compose pull\ndocker compose up -d'
	} as const;

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const PICTURE =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' fill='%23b7c4cc'/%3E%3Ccircle cx='24' cy='19' r='9' fill='%23eef2f4'/%3E%3Cpath d='M8 48c2-11 9-16 16-16s14 5 16 16z' fill='%23eef2f4'/%3E%3C/svg%3E";
	const ago = (h: number) => new Date(Date.now() - h * 3600e3);

	/* ── Interactive state of the kit ── */
	let menuOpen = $state(true);
	let segValue = $state('all');
	let viewValue = $state('list');
	let tabA = $state('overview');
	let tabB = $state('overview');
	let mode = $state('approval');
	let radioRow = $state('a');
	let proxy = $state(true);
	let proxyOff = $state(false);
	let accent = $state('#1b62cf');
	let page = $state(4);
	let pageSize = $state(25);
	let colPlatform = $state(true);
	let colSeen = $state(false);
	let sheetOpen = $state(false);
	let wideOpen = $state(false);
	let dialogOpen = $state(false);
	let stackedOpen = $state(false);
	let selection = $state(new Set<string>(['900100002']));
	let sort = $state<SortState | null>({ column: 'device', dir: 'asc' });
	let chooserCols = $state([
		{ id: 'platform', label: S.platform, hideable: true, visible: true },
		{ id: 'seen', label: S.lastSeen, hideable: true, visible: false }
	]);

	function openStacked() {
		sheetOpen = true;
		// The dialog opens after the sheet is on screen, so it stacks on it
		setTimeout(() => (stackedOpen = true), 50);
	}

	/* ── Hover and focus as classes (the kit's .is-hover / .is-focus) ── */

	function splitList(text: string): string[] {
		const parts: string[] = [];
		let depth = 0;
		let start = 0;
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (c === '(') depth++;
			else if (c === ')') depth--;
			else if (c === ',' && depth === 0) {
				parts.push(text.slice(start, i));
				start = i + 1;
			}
		}
		parts.push(text.slice(start));
		return parts;
	}

	function mirrorStates() {
		const add: string[] = [];
		const walk = (list: CSSRuleList) => {
			for (const r of Array.from(list)) {
				if (r instanceof CSSMediaRule) {
					if (window.matchMedia(r.media.mediaText).matches) walk(r.cssRules);
					continue;
				}
				if (!(r instanceof CSSStyleRule) || !/:hover|:focus/.test(r.selectorText)) continue;
				const sel = splitList(r.selectorText)
					.map((s) => s.trim())
					.filter((s) => /:hover|:focus/.test(s))
					.map((s) =>
						s.replace(/:hover/g, '.is-hover').replace(/:focus-visible|:focus-within|:focus/g, '.is-focus')
					)
					.join(', ');
				add.push(`${sel} { ${r.style.cssText} }`);
			}
		};
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				walk(sheet.cssRules);
			} catch {
				/* a sheet from another origin */
			}
		}
		const st = document.createElement('style');
		st.dataset.kitStates = '';
		st.textContent = add.join('\n');
		document.head.appendChild(st);
		return () => st.remove();
	}

	/** Adds a state class to elements inside a component that has no class prop for them */
	function mark(selector: string, cls: string) {
		return (node: HTMLElement) => {
			node.querySelectorAll(selector).forEach((el) => el.classList.add(cls));
		};
	}

	onMount(() => {
		let undo: (() => void) | undefined;
		void document.fonts.ready.then(() => (undo = mirrorStates()));
		return () => undo?.();
	});

	/* ── Table samples ── */

	interface DevRow {
		id: string;
		name: string;
		tone: string;
		status: string;
		seen: string;
	}
	const devRows: DevRow[] = [
		{ id: '900100001', name: 'demo-reception-01', tone: 'online', status: S.online, seen: S.justNow },
		{ id: '900100002', name: S.selected, tone: 'offline', status: S.offline, seen: S.hoursAgo }
	];

	interface RegRow {
		name: string;
		id: string;
		os: string;
		v: string;
		ip: string;
		via: string;
		asked: Date;
		waiting: boolean;
	}
	const regRows: RegRow[] = [
		{
			name: 'demo-reception-03',
			id: '900100031',
			os: 'Windows 11 Pro',
			v: '1.4.2',
			ip: '192.168.10.31',
			via: S.localNetwork,
			asked: ago(3),
			waiting: true
		},
		{
			name: 'warehouse-scanner',
			id: '900100044',
			os: 'Android 14',
			v: '1.3.9',
			ip: '',
			via: S.rustdeskClient,
			asked: ago(52),
			waiting: false
		}
	];

	interface DeviceRow {
		id: string;
		name: string;
		type: string;
		os: string;
		seen: Date;
		online: boolean;
		tags: string[];
	}
	const deviceRows: DeviceRow[] = [
		{
			id: '900100001',
			name: 'demo-reception-01',
			type: 'RustDesk',
			os: 'Windows 11 Pro',
			seen: ago(0.01),
			online: true,
			tags: ['office', 'reception']
		},
		{
			id: '900100017',
			name: 'build-server',
			type: 'BetterDesk',
			os: 'Ubuntu 24.04',
			seen: ago(11),
			online: false,
			tags: []
		}
	];

	interface NumRow {
		dev: string;
		user: string;
		secs: number;
		bytes: number;
		files: number;
		cpu: number;
		rec: boolean;
	}
	const numRows: NumRow[] = [
		{
			dev: 'demo-reception-01',
			user: 'Linus Rath',
			secs: 5420,
			bytes: 734003200,
			files: 12,
			cpu: 41,
			rec: true
		},
		{ dev: 'build-server', user: 'operator', secs: 183900, bytes: 52428800, files: 3, cpu: 7.5, rec: false }
	];

	const devColumns: Column<DevRow>[] = [
		{ id: 'device', label: S.device, cell: devCell, sortValue: (r) => r.id, primary: true },
		{ id: 'status', label: S.status, cell: devStatus },
		{ id: 'seen', label: S.lastSeen, cell: devSeen },
		{ id: 'actions', label: S.actions, labelHidden: true, cell: devActions, align: 'actions' }
	];
	const regColumns: Column<RegRow>[] = [
		{ id: 'device', label: S.device, cell: regDevice, primary: true },
		{ id: 'platform', label: S.platform, cell: regPlatform },
		{ id: 'ip', label: S.ipAddress, cell: regIp },
		{ id: 'via', label: S.cameVia, cell: regVia },
		{ id: 'asked', label: S.asked, cell: regAsked },
		{ id: 'status', label: S.status, cell: regStatus },
		{ id: 'actions', label: S.actions, labelHidden: true, cell: regActions, align: 'actions' }
	];
	const deviceColumns: Column<DeviceRow>[] = [
		{ id: 'id', label: S.id, cell: dId },
		{ id: 'name', label: S.name, cell: dName },
		{ id: 'type', label: S.type, cell: dType },
		{ id: 'platform', label: S.platform, cell: dPlatform },
		{ id: 'seen', label: S.lastSeen, cell: dSeen },
		{ id: 'status', label: S.status, cell: dStatus },
		{ id: 'tags', label: S.tags, cell: dTags }
	];
	const numColumns: Column<NumRow>[] = [
		{ id: 'dev', label: S.session, cell: nDev },
		{ id: 'user', label: S.signedInAs, cell: nUser },
		{ id: 'secs', label: S.length, cell: nSecs, align: 'num' },
		{ id: 'bytes', label: S.dataSent, cell: nBytes, align: 'num' },
		{ id: 'files', label: S.files, cell: nFiles, align: 'num' },
		{ id: 'cpu', label: S.cpu, cell: nCpu, align: 'num' },
		{ id: 'rec', label: S.recording, cell: nRec }
	];
	const selColumns: Column<DevRow>[] = [
		{ id: 'device', label: S.device, cell: devCell, sortValue: (r) => r.id, primary: true },
		{ id: 'status', label: S.status, cell: devStatus, sortValue: (r) => r.status },
		{ id: 'seen', label: S.lastSeen, cell: devSeen },
		{ id: 'actions', label: S.actions, labelHidden: true, cell: devActions, align: 'actions' }
	];

	const fakeTerminal: TerminalConnect = (session) => {
		session.writeln('$ uptime');
		session.writeln(' 10:42:01 up 12 days,  3:04,  1 user,  load average: 0.08, 0.04, 0.01');
		session.status('closed', S.terminalDone);
		return { input() {}, resize() {}, close() {} };
	};
</script>

{#snippet devCell(r: DevRow)}<span class="mono">{r.id}</span><span class="cell-sub">{r.name}</span>{/snippet}
{#snippet devStatus(r: DevRow)}<Status tone={r.tone} label={r.status} />{/snippet}
{#snippet devSeen(r: DevRow)}{r.seen}{/snippet}
{#snippet devActions(r: DevRow)}<Button size="sm">{S.connect}</Button><MenuButton
		kebab
		label="{S.actions} {r.id}"><MenuItem icon="edit">{S.edit}</MenuItem></MenuButton
	>{/snippet}

{#snippet regDevice(r: RegRow)}<span class="row-name">{r.name}</span><span class="cell-sub"
		><ValueCopy value={r.id} copy={false} /></span
	>{/snippet}
{#snippet regPlatform(r: RegRow)}<Platform platform={r.os} /><span class="cell-sub"
		>{S.client} <Version version={r.v} /></span
	>{/snippet}
{#snippet regIp(r: RegRow)}<ValueCopy value={r.ip} />{/snippet}
{#snippet regVia(r: RegRow)}<Tag label={r.via} />{/snippet}
{#snippet regAsked(r: RegRow)}<Time value={r.asked} />{/snippet}
{#snippet regStatus(r: RegRow)}{#if r.waiting}<Status tone="waiting" label={S.waiting} />{:else}<Status
			tone="good"
			label={S.approved}
		/><span class="cell-sub">{S.byLinus}</span>{/if}{/snippet}
{#snippet regActions(r: RegRow)}{#if r.waiting}<Button size="sm" icon="approve">{S.approve}</Button><Button
			size="sm"
			variant="danger-quiet"
			icon="reject">{S.reject}</Button
		>{:else}<Button size="sm" variant="ghost" href="#kit-dd">{S.openDevice}</Button>{/if}<MenuButton
		kebab
		label="{S.actions} {r.name}"><MenuItem icon="edit">{S.edit}</MenuItem></MenuButton
	>{/snippet}

{#snippet dId(r: DeviceRow)}<ValueCopy value={r.id} />{/snippet}
{#snippet dName(r: DeviceRow)}{r.name}{/snippet}
{#snippet dType(r: DeviceRow)}<Tag label={r.type} />{/snippet}
{#snippet dPlatform(r: DeviceRow)}<Platform platform={r.os} />{/snippet}
{#snippet dSeen(r: DeviceRow)}<Time value={r.seen} empty={S.never} />{/snippet}
{#snippet dStatus(r: DeviceRow)}<Status
		tone={r.online ? 'good' : 'neutral'}
		label={r.online ? S.online : S.offline}
	/>{/snippet}
{#snippet dTags(r: DeviceRow)}<TagSet tags={r.tags} />{/snippet}

{#snippet nDev(r: NumRow)}{r.dev}{/snippet}
{#snippet nUser(r: NumRow)}<User user={r.user} />{/snippet}
{#snippet nSecs(r: NumRow)}{formatDuration(r.secs)}{/snippet}
{#snippet nBytes(r: NumRow)}{formatBytes(r.bytes)}{/snippet}
{#snippet nFiles(r: NumRow)}{formatNumber(r.files)}{/snippet}
{#snippet nCpu(r: NumRow)}{formatPercent(r.cpu)}{/snippet}
{#snippet nRec(r: NumRow)}<BooleanStatus value={r.rec} />{/snippet}

{#snippet stepWithCode()}{S.step3} <code translate="no">remote.example.com</code>{/snippet}
{#snippet factStatus()}<Status tone="good" label={S.online} />{/snippet}
{#snippet factTime()}<Time value={ago(30)} />{/snippet}
{#snippet factValue()}<ValueCopy value="relay.example.org:21117" />{/snippet}
{#snippet rowAvatar()}<Avatar user={S.zoe} />{/snippet}
{#snippet rowEnd()}<Time value={ago(2)} />{/snippet}
{#snippet rowActions()}<Button size="sm">{S.connect}</Button><MenuButton kebab label={S.actions}
		><MenuItem icon="edit">{S.edit}</MenuItem></MenuButton
	>{/snippet}

<div class="kit" id="kit">
	<h1 class="kit-title">{S.kit}</h1>

	<!-- ═════ The sections of ui-kit.html, in its order ═════ -->

	<section class="kit-section" id="kit-buttons">
		<h2>{S.buttons}</h2>
		<div class="kit-grid">
			<span></span><span class="kit-head">{S.vDefault}</span><span class="kit-head">{S.vHover}</span><span
				class="kit-head">{S.vFocus}</span
			><span class="kit-head">{S.vDisabled}</span>
			<span class="kit-label">{S.kSecondary}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button class={st === 'dis' ? '' : st} disabled={st === 'dis'}>{S.export}</Button>
			{/each}
			<span class="kit-label">{S.kPrimary}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button variant="primary" icon="add" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.addUser}</Button
				>
			{/each}
			<span class="kit-label">{S.kGhost}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button variant="ghost" icon="add" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.newFolder}</Button
				>
			{/each}
			<span class="kit-label">{S.kDangerQuiet}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button variant="danger-quiet" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.deleteDots}</Button
				>
			{/each}
			<span class="kit-label">{S.kDanger}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button variant="danger" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.deleteDevice}</Button
				>
			{/each}
			<span class="kit-label">{S.kSm}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button size="sm" class={st === 'dis' ? '' : st} disabled={st === 'dis'}>{S.approve}</Button>
			{/each}
			<span class="kit-label">{S.kSmGhost}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button size="sm" variant="ghost" icon="add" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.newGroup}</Button
				>
			{/each}
			<span class="kit-label">{S.kSmPrimary}</span>
			{#each ['', 'is-hover', 'is-focus', 'dis'] as st (st)}
				<Button size="sm" variant="primary" class={st === 'dis' ? '' : st} disabled={st === 'dis'}
					>{S.saveFlow}</Button
				>
			{/each}
		</div>
	</section>

	<section class="kit-section" id="kit-icon-buttons">
		<h2>{S.iconButtons}</h2>
		<div class="kit-grid kit-grid-5">
			<span></span><span class="kit-head">{S.vDefault}</span><span class="kit-head">{S.vHover}</span><span
				class="kit-head">{S.vFocus}</span
			><span class="kit-head">{S.vOpen}</span><span class="kit-head">{S.vDisabled}</span>
			<span class="kit-label">{S.kClose}</span>
			<IconButton icon="close" label={S.close} class="modal-close" />
			<IconButton icon="close" label={S.close} class="modal-close is-hover" />
			<IconButton icon="close" label={S.close} class="modal-close is-focus" />
			<span></span>
			<IconButton icon="close" label={S.close} class="modal-close" disabled />
			<span class="kit-label">{S.kKebab}</span>
			<IconButton icon="more_vert" label={S.actions} class="kebab-btn" />
			<IconButton icon="more_vert" label={S.actions} class="kebab-btn is-hover" />
			<IconButton icon="more_vert" label={S.actions} class="kebab-btn is-focus" />
			<IconButton icon="more_vert" label={S.actions} class="kebab-btn" aria-expanded="true" />
			<IconButton icon="more_vert" label={S.actions} class="kebab-btn" disabled />
			<span class="kit-label">{S.kCopy}</span>
			<IconButton icon="copy" label={S.copy} class="copy-btn" />
			<IconButton icon="copy" label={S.copy} class="copy-btn is-hover" />
			<IconButton icon="copy" label={S.copy} class="copy-btn is-focus" />
			<span></span>
			<IconButton icon="copy" label={S.copy} class="copy-btn" disabled />
		</div>
		<div class="kit-row">
			<Button size="sm">{S.connect}</Button><MenuButton kebab label={S.actions}
				><MenuItem icon="edit">{S.edit}</MenuItem></MenuButton
			><span class="mono kit-gap" translate="no">900100001</span><IconButton
				icon="copy"
				label="{S.copy} 900100001"
				class="copy-btn"
			/>
		</div>
		<div class="kit-stack">
			<Toolbar>
				{#snippet search()}<SearchField label={S.searchMessages} />{/snippet}
				<IconButton icon="close" label={S.closeSearch} />
				{#snippet end()}<Button>{S.export}</Button>{/snippet}
			</Toolbar>
		</div>
	</section>

	<section class="kit-section" id="kit-menus">
		<h2>{S.menus}</h2>
		<div class="kit-row kit-top">
			<MenuButton label={S.columns} bind:open={menuOpen}>
				<MenuItem icon="edit">{S.edit}</MenuItem>
				<MenuItem icon="tags" class="is-hover">{S.tagsHover}</MenuItem>
				<MenuItem icon="folder" class="is-focus">{S.moveFocus}</MenuItem>
				<MenuDivider />
				<MenuItem icon="delete" danger>{S.deleteDots}</MenuItem>
			</MenuButton>
			<span class="kit-menu-gap"></span>
			<MenuButton label={S.view} class="kit-checkmenu">
				<MenuItem type="checkbox" bind:checked={colPlatform}>{S.platform}</MenuItem>
				<MenuItem type="checkbox" bind:checked={colSeen}>{S.lastSeen}</MenuItem>
			</MenuButton>
			<ColumnChooser
				columns={chooserCols}
				align="start"
				onchange={(id, visible) =>
					(chooserCols = chooserCols.map((c) => (c.id === id ? { ...c, visible } : c)))}
			/>
		</div>
	</section>

	<section class="kit-section" id="kit-fields">
		<h2>{S.fields}</h2>
		<div class="kit-fields">
			<Field label={S.lDefault} hint={S.hDefault}>
				{#snippet children(f)}<Input {...f} placeholder={S.deskHost} />{/snippet}
			</Field>
			<Field label={S.lFocus}>
				{#snippet children(f)}<Input {...f} class="is-focus" value="desk.example.com" />{/snippet}
			</Field>
			<Field label={S.lDisabled}>
				{#snippet children(f)}<Input {...f} value="21116" disabled />{/snippet}
			</Field>
			<Field label={S.lInvalid} error={S.eInvalid}>
				{#snippet children(f)}<Input {...f} value="70000" />{/snippet}
			</Field>
			<Field label={S.lSelect}>
				{#snippet children(f)}<Select
						{...f}
						options={[{ value: 'eb', label: 'Europe/Berlin' }]}
						value="eb"
					/>{/snippet}
			</Field>
			<Field label={S.lSearch}>
				{#snippet children(f)}<SearchField id={f.id} label={S.searchDevices} />{/snippet}
			</Field>
			<Field label={S.lSmallSelect}>
				{#snippet children(f)}<span class="kit-row kit-flush"
						><Select {...f} small class="kit-auto" options={[{ value: 20, label: '20' }]} value={20} /><Button
							size="sm">{S.apply}</Button
						></span
					>{/snippet}
			</Field>
			<Field label={S.lTextarea}>
				{#snippet children(f)}<Textarea {...f} rows={3} value="pool.ntp.org" />{/snippet}
			</Field>
		</div>
	</section>

	<section class="kit-section" id="kit-checks">
		<h2>{S.checks}</h2>
		<div class="kit-row">
			<Checkbox inline label={S.showDeleted} />
			<Checkbox inline label={S.checked} checked />
			<Checkbox inline label={S.lFocus} inputClass="is-focus" />
			<Checkbox inline label={S.lDisabled} disabled />
			<span class="kit-contents">
				<Radio label={S.radio} name="kr" value="a" bind:group={radioRow} />
				<Radio label={S.radio} name="kr" value="b" bind:group={radioRow} />
			</span>
			<Switch inline label={S.online} checked />
		</div>
		<div class="kit-stack">
			<Checkbox label={S.twoFactor} hint={S.twoFactorHint} checked />
		</div>
		<div class="kit-stack">
			<ChoiceList
				label={S.enrollMode}
				bind:value={mode}
				choices={[
					{ value: 'approval', title: S.approval, description: S.approvalDesc },
					{ value: 'open', title: S.open, description: S.openDesc }
				]}
			/>
		</div>
	</section>

	<section class="kit-section" id="kit-segmented">
		<h2>{S.segmented}</h2>
		<div class="kit-row">
			<span
				class="kit-contents"
				{@attach mark('.filter-btn:nth-child(2)', 'is-hover')}
				{@attach mark('.filter-btn:nth-child(3)', 'is-focus')}
			>
				<SegmentedFilter
					label={S.status}
					bind:value={segValue}
					options={[
						{ value: 'all', label: S.all },
						{ value: 'online', label: S.onlineHover },
						{ value: 'offline', label: S.offlineFocus },
						{ value: 'banned', label: S.banned, disabled: true }
					]}
				/>
			</span>
			<SegmentedFilter
				label={S.view}
				bind:value={viewValue}
				options={[
					{ value: 'list', label: S.list },
					{ value: 'grid', label: S.grid }
				]}
			/>
		</div>
	</section>

	<section class="kit-section" id="kit-tabs">
		<h2>{S.tabs}</h2>
		<div
			class="kit-stack"
			{@attach mark('.tab:nth-child(2)', 'is-hover')}
			{@attach mark('.tab:nth-child(3)', 'is-focus')}
		>
			<Tabs
				label={S.tabs}
				bind:value={tabA}
				tabs={[
					{ id: 'overview', label: S.overview },
					{ id: 'hardware', label: S.hardwareHover },
					{ id: 'metrics', label: S.metricsFocus }
				]}
			/>
		</div>
		<div class="kit-stack" {@attach mark('.tab:nth-child(1)', 'is-focus')}>
			<Tabs
				label={S.tabs}
				bind:value={tabB}
				tabs={[
					{ id: 'overview', label: S.overviewFocus },
					{ id: 'hardware', label: S.hardware }
				]}
			/>
		</div>
	</section>

	<section class="kit-section" id="kit-toolbar">
		<h2>{S.toolbar}</h2>
		<div class="kit-stack">
			<Toolbar>
				{#snippet search()}<SearchField label={S.search} placeholder={S.searchDevices} />{/snippet}
				<SegmentedFilter
					label={S.status}
					value="all"
					options={[
						{ value: 'all', label: S.all },
						{ value: 'online', label: S.online },
						{ value: 'offline', label: S.offline }
					]}
				/>
				{#snippet end()}<Checkbox inline label={S.showDeleted} /><MenuButton label={S.tagsMenu}
						><MenuItem>{S.edit}</MenuItem></MenuButton
					>{/snippet}
			</Toolbar>
		</div>
	</section>

	<section class="kit-section" id="kit-table">
		<h2>{S.table}</h2>
		<div class="kit-stack">
			<Table
				label={S.devices}
				rows={devRows}
				columns={devColumns}
				key={(r) => r.id}
				bind:sort
				rowClass={(r) => r.id === '900100002' && 'selected'}
			/>
		</div>
		<div class="kit-row" {@attach mark('.pagination-btn:nth-child(4)', 'is-hover')}>
			<Pagination page={1} pageCount={3} label={S.pages} />
		</div>
	</section>

	<section class="kit-section" id="kit-inline">
		<h2>{S.inline}</h2>
		<p class="kit-stack">
			{S.inSentence}
			<Button variant="link">{S.resolved}</Button>. {S.notVariant}
		</p>
		<div class="kit-row"><ValueField value="900100001" label={S.valueField} /></div>
		<div class="kit-row">
			<Status tone="online" label={S.online} /><Status tone="offline" label={S.offline} /><Status
				tone="warning"
				label={S.warning}
			/><Status tone="banned" label={S.banned} />
		</div>
	</section>

	<section class="kit-section" id="kit-dd">
		<h2>{S.dataDisplay}</h2>
		<div class="kit-dd">
			<span class="kit-label">{S.ddGood}</span>
			<span class="kit-sample"
				><Status tone="good" label={S.online} /><Status tone="approved" label={S.approved} /></span
			>
			<code>{S.cStatus}</code>
			<span class="kit-label">{S.ddWaiting}</span>
			<span class="kit-sample"
				><Status tone="waiting" label={S.waiting} /><Status tone="queued" label={S.queued} /></span
			>
			<code>{S.cStatusW}</code>
			<span class="kit-label">{S.ddNeutral}</span>
			<span class="kit-sample"
				><Status tone="neutral" label={S.offline} /><Status tone="rejected" label={S.rejected} /></span
			>
			<code>{S.cStatusN}</code>
			<span class="kit-label">{S.ddWarning}</span>
			<span class="kit-sample"
				><Status tone="warning" label={S.noSignal} /><Status tone="degraded" label={S.degraded} /></span
			>
			<code>{S.cStatusWa}</code>
			<span class="kit-label">{S.ddDanger}</span>
			<span class="kit-sample"
				><Status tone="danger" label={S.failed} /><Status tone="banned" label={S.banned} /></span
			>
			<code>{S.cStatusD}</code>
			<span class="kit-label">{S.ddOnOff}</span>
			<span class="kit-sample"><BooleanStatus value={true} /><BooleanStatus value={false} /></span>
			<code>{S.cBool}</code>
			<span class="kit-label">{S.ddCategory}</span>
			<span class="kit-sample"
				><Tag label={S.localNetwork} /><Tag label={S.rustdeskClient} /><Tag label={S.operator} /></span
			>
			<code>{S.cTag}</code>
			<span class="kit-label">{S.ddTagIcon}</span>
			<span class="kit-sample"
				><Tag label={S.scheduled} icon="history" /><Tag label={S.manual} icon="user" /></span
			>
			<code>{S.cTagIcon}</code>
			<span class="kit-label">{S.ddTags}</span>
			<span class="kit-sample"><TagSet tags={['office', 'finance', 'reception desk 2']} /></span>
			<code>{S.cTags}</code>
			<span class="kit-label">{S.ddValues}</span>
			<span class="kit-sample"
				><ValueCopy value="900100001" /><ValueCopy value="192.168.10.24" copy={false} /><ValueCopy
					value="relay.example.org:21117"
					copy={false}
				/></span
			>
			<code>{S.cValue}</code>
			<span class="kit-label">{S.ddVersion}</span>
			<span class="kit-sample"
				><Version version="v1.4.2" /><span class="text-muted">{S.client} <Version version="1.4.2" /></span
				></span
			>
			<code>{S.cVersion}</code>
			<span class="kit-label">{S.ddTime}</span>
			<span class="kit-sample"
				><Time value={ago(3)} /><Time value={ago(0.2)} /><Time value={ago(400)} /><Time
					value={ago(30)}
					relative={false}
					format={{ hour: undefined, minute: undefined }}
				/></span
			>
			<code>{S.cTime}</code>
			<span class="kit-label">{S.ddPlatform}</span>
			<span class="kit-sample"
				><Platform platform="Windows 11 Pro" /><Platform platform="Ubuntu 24.04" /><Platform
					platform="macOS 15.1"
				/><Platform platform="Android 14" /></span
			>
			<code>{S.cPlatform}</code>
			<span class="kit-label">{S.ddPerson}</span>
			<span class="kit-sample"
				><User user={S.linus} /><User user={S.linus} avatar /><User
					user={S.jan}
					avatar
					picture={PICTURE}
				/></span
			>
			<code>{S.cUser}</code>
			<span class="kit-label">{S.ddAvatars}</span>
			<span class="kit-sample">
				{#each [S.ben, S.zoe, S.noah, S.eva, S.tom, S.admin] as n (n)}<Avatar user={n} />{/each}
				<Avatar user={S.linus} size="md" /><Avatar user={S.linus} size="lg" /><Avatar
					user={S.jan}
					size="lg"
					picture={PICTURE}
				/>
			</span>
			<code>{S.cAvatar}</code>
			<span class="kit-label">{S.ddNoValue}</span>
			<span class="kit-sample"><Empty /><Empty word={S.never} /><TagSet tags={[]} /></span>
			<code>{S.cEmpty}</code>
			<span class="kit-label">{S.ddNumbers}</span>
			<span class="kit-sample"
				><span class="tabular">{formatNumber(12345)}</span><span class="tabular"
					>{formatBytes(1610612736)}</span
				><span class="tabular">{formatDuration(183900)}</span><span class="tabular"
					>{formatPercent(62.4)}</span
				></span
			>
			<code>{S.cNumbers}</code>
		</div>

		<h3 class="kit-h3">{S.enrollment}</h3>
		<div class="kit-stack">
			<Table label={S.enrollment} rows={regRows} columns={regColumns} key={(r) => r.id} />
		</div>
		<h3 class="kit-h3">{S.aDevice}</h3>
		<div class="kit-stack">
			<Table label={S.aDevice} rows={deviceRows} columns={deviceColumns} key={(r) => r.id} />
		</div>
		<h3 class="kit-h3">{S.numbersTable}</h3>
		<div class="kit-stack">
			<Table label={S.sessions} rows={numRows} columns={numColumns} key={(r) => r.dev} />
		</div>
	</section>

	<section class="kit-section" id="kit-sheets">
		<h2>{S.sheets}</h2>
		<div class="kit-row">
			<Button id="kit-open-sheet" onclick={() => (sheetOpen = true)}>{S.openSheet}</Button>
			<Button id="kit-open-wide" onclick={() => (wideOpen = true)}>{S.openWide}</Button>
			<Button id="kit-open-dialog" onclick={() => (dialogOpen = true)}>{S.openDialog}</Button>
			<Button id="kit-open-stacked" onclick={openStacked}>{S.openStacked}</Button>
		</div>
	</section>

	<!-- ═════ Components ui-kit.html has no section for (svelte-kit-ref.html, same order) ═════ -->

	<section class="kit-section" id="x-fields">
		<h2>{S.moreFields}</h2>
		<div class="kit-fields">
			<div>
				<Field label={S.timeout} hint={S.timeoutHint} effect={S.appliesNew} width="short">
					{#snippet children(f)}<Input {...f} type="number" value="30" />{/snippet}
				</Field>
				<Field label={S.relayPort} effect={S.afterRestart} effectTone="restart" width="short">
					{#snippet children(f)}<Input {...f} type="number" value="21117" />{/snippet}
				</Field>
			</div>
			<div>
				<Checkbox
					label={S.useProxy}
					hint={S.useProxyHint}
					bind:checked={proxy}
					{...showWhenControl('kit-proxy', proxy)}
				/>
				<ShowWhen id="kit-proxy" when={proxy}>
					<Field label={S.proxyHost} width="host">
						{#snippet children(f)}<Input {...f} value="proxy.example.com:3128" />{/snippet}
					</Field>
				</ShowWhen>
				<Checkbox
					label={S.useProxy}
					bind:checked={proxyOff}
					{...showWhenControl('kit-proxy-off', proxyOff)}
				/>
				<ShowWhen id="kit-proxy-off" when={proxyOff}>
					<Field label={S.proxyHost}>
						{#snippet children(f)}<Input {...f} />{/snippet}
					</Field>
				</ShowWhen>
			</div>
			<Field label={S.accent}>
				{#snippet children(f)}<ColorField {...f} label={S.accent} bind:value={accent} />{/snippet}
			</Field>
			<Field label={S.logo} hint={S.logoHint}>
				{#snippet children(f)}<FilePicker {...f} accept="image/png,image/svg+xml" />{/snippet}
			</Field>
		</div>
	</section>

	<section class="kit-section" id="x-forms">
		<h2>{S.forms}</h2>
		<!-- Each bar in its own box: a dirty bar sticks only inside its parent, so it stays in its row -->
		<div class="kit-stack">
			<div><SaveBar label={S.saveSignIn} /></div>
			<div><SaveBar label={S.saveSignIn} dirty /></div>
			<div><SaveBar label={S.saveSignIn} status={{ state: 'saved', message: S.saved }} /></div>
			<div><SaveBar label={S.saveSignIn} dirty status={{ state: 'error', message: S.couldNotSave }} /></div>
		</div>
		<div class="kit-row">
			<FormStatus message={S.testing} /><FormStatus message={S.reached} tone="ok" /><FormStatus
				message={S.couldNotSave}
				tone="error"
			/>
		</div>
		<div class="kit-stack">
			<CountLine text={S.countLine} values={{ count: 6, online: 3 }} />
		</div>
		<div class="kit-stack">
			<DangerZone
				title={S.reset}
				note={S.resetNote}
				rows={[
					{ title: S.regenTitle, consequence: S.regenDesc, action: S.regen, onclick: () => {} },
					{ title: S.wipeTitle, consequence: S.wipeDesc, action: S.wipe, onclick: () => {}, disabled: true }
				]}
			/>
		</div>
	</section>

	<section class="kit-section" id="x-feedback">
		<h2>{S.feedback}</h2>
		<div class="kit-toasts">
			<Toast toast={{ id: 90001, type: 'success', title: S.tSaved, message: S.tRenamed }} />
			<Toast toast={{ id: 90002, type: 'error', title: S.tCouldNot, message: S.tNoAnswer }} />
			<Toast toast={{ id: 90003, type: 'warning', title: S.warning, message: S.tRestart }} />
			<Toast toast={{ id: 90004, type: 'info', message: S.tOffline }} />
			<Toast toast={{ id: 90005, type: 'success', message: S.tNoTitle }} />
		</div>
		<div class="kit-stack kit-gap-y">
			<Notice message={S.nInfo} />
			<Notice tone="warning" message={S.nWarning} />
			<Notice tone="danger" message={S.nDanger} />
			<Notice tone="ok" message={S.nOk} />
			<Notice tone="warning" title={S.nTitle} message={S.nTitleMsg} />
		</div>
		<div class="kit-stack">
			<States kind="loading" message={S.loadingRequests} />
			<States kind="empty" message={S.noRequests} />
			<States kind="error" message={S.couldNotLoad} retryLabel={S.tryAgain} onretry={() => {}} />
		</div>
	</section>

	<section class="kit-section" id="x-disclosure">
		<h2>{S.disclosure}</h2>
		<div class="kit-stack">
			<Disclosure title={S.serverDetails} meta={S.threeRules}><p>{S.disclosureBody}</p></Disclosure>
			<Disclosure title={S.openDisclosure} open level={3}><p>{S.disclosureBody}</p></Disclosure>
		</div>
	</section>

	<section class="kit-section" id="x-pagination">
		<h2>{S.paginationBar}</h2>
		<div class="kit-stack">
			<Pagination bind:page bind:pageSize total={312} pageSizes={[25, 50, 100]} label={S.pages} />
		</div>
	</section>

	<section class="kit-section" id="x-people">
		<h2>{S.people}</h2>
		<div class="kit-row">
			<Avatar user={S.linus} /><Avatar user={S.linus} size="md" /><Avatar user={S.linus} size="lg" />
			<Avatar user={S.jan} picture={PICTURE} /><Avatar user={S.jan} size="md" picture={PICTURE} /><Avatar
				user={S.jan}
				size="lg"
				picture={PICTURE}
			/>
			<Avatar user={S.symbols} /><Avatar user={S.symbols} size="md" /><Avatar user={S.symbols} size="lg" />
		</div>
		<div class="kit-row">
			<Avatar user={S.zoe} size="md" presence="online" presenceLabel={S.online} />
			<Avatar user={S.noah} size="md" presence="away" presenceLabel={S.away} />
			<Avatar user={S.eva} size="md" presence="busy" presenceLabel={S.busy} />
			<Avatar user={S.tom} size="md" presence="offline" presenceLabel={S.offline} />
			<Avatar user={S.jan} size="lg" picture={PICTURE} presence="online" presenceLabel={S.online} />
			<Avatar user={S.ben} presence="offline" presenceLabel={S.offline} />
		</div>
		<div class="kit-row">
			<span class="kit-pair"><Presence status="online" />{S.online}</span>
			<span class="kit-pair"><Presence status="away" />{S.away}</span>
			<span class="kit-pair"><Presence status="busy" />{S.busy}</span>
			<span class="kit-pair"><Presence status="offline" />{S.offline}</span>
			<User user={S.zoe} avatar presence="online" presenceLabel={S.online} />
			<User user={S.linus} avatar size="md" />
		</div>
	</section>

	<section class="kit-section" id="x-values">
		<h2>{S.values}</h2>
		<div class="kit-stack kit-gap-y">
			<span><ValueField value="QmFzZTY0IHNlcnZlciBrZXkgZm9yIHRoZSBraXQ=" label={S.serverKey} /></span>
			<span><ValueField value="QmFzZTY0IHNlcnZlciBrZXkgZm9yIHRoZSBraXQ=" label={S.serverKey} hidden /></span>
			<span class="kit-narrow"
				><ValueField
					value="host=remote.example.com,key=QmFzZTY0IHNlcnZlciBrZXkgZm9yIHRoZSBraXQ=,relay=relay.example.org"
					label={S.config}
				/></span
			>
		</div>
		<div class="kit-stack">
			<Facts
				items={[
					{ label: S.version, value: '1.4.2' },
					{ label: S.status, value: factStatus },
					{ label: S.uptime, value: factTime },
					{ label: S.relay, value: factValue },
					{ label: S.proxyHost, value: '', empty: S.notSet },
					{ label: S.port, value: null }
				]}
			/>
		</div>
		<div class="kit-meters">
			<Meter value={0} /><Meter value={40} /><Meter value={62.4} /><Meter value={86} /><Meter
				value={97}
			/><Meter value={31} max={50} text="31 / 50" /><Meter value={null} />
		</div>
		<div class="kit-stack">
			<ShareBar
				label={S.devicesShare}
				parts={[
					{ value: 21, label: S.online, tone: 'ok' },
					{ value: 9, label: S.offline, tone: 'muted' },
					{ value: 2, label: S.noSignal, tone: 'warning' },
					{ value: 1, label: S.banned, tone: 'danger' },
					{ value: 0, label: S.rejected, tone: 'muted' }
				]}
			/>
		</div>
	</section>

	<section class="kit-section" id="x-text">
		<h2>{S.text}</h2>
		<div class="kit-stack">
			<CodeBlock title={S.install} code={S.codePs} />
		</div>
		<div class="kit-stack">
			<CodeBlock code={S.codeSh} />
		</div>
		<div class="kit-stack">
			<Steps items={[S.step1, S.step2, stepWithCode]} />
		</div>
		<div class="kit-row">
			<LangFlag code="en" name={S.english} /><LangFlag code="de" name={S.german} /><LangFlag
				code="ar"
				name={S.arabic}
			/><LangFlag code="zh-TW" name={S.chineseTw} /><LangFlag code="eo" name={S.unmapped} /><LangFlag
				code="fr"
			/>
		</div>
		<div class="kit-row">
			<QR text="rustdesk://config?host=remote.example.com&key=QmFzZTY0IHNlcnZlciBrZXk=" label={S.qrLabel} />
			<QR text="https://remote.example.com/d/900100001" label={S.qrLabel} size={120} />
		</div>
	</section>

	<section class="kit-section" id="x-platforms">
		<h2>{S.platforms}</h2>
		<div class="kit-row">
			<Platform platform="Windows 11 Pro" /><Platform platform="macOS 15.1" /><Platform
				platform={S.ios}
			/><Platform platform="Android 14" /><Platform platform={S.chromeos} /><Platform
				platform={S.debian}
			/><Platform platform={S.unknownOs} /><Platform platform="" />
		</div>
	</section>

	<section class="kit-section" id="x-lists">
		<h2>{S.lists}</h2>
		<div class="kit-stack">
			<RowList>
				<ListRow title={S.enrollments} sub={S.enrollmentsSub} count={3} href="#x-lists" />
				<ListRow title={S.helpRequests} sub={S.helpSub} count={1} mark="danger" href="#x-lists" />
				<ListRow title={S.buttonRow} sub={S.buttonRowSub} mark="info" onclick={() => {}} />
				<ListRow
					title={S.withActions}
					sub={S.withActionsSub}
					start={rowAvatar}
					end={rowEnd}
					actions={rowActions}
					href="#x-lists"
				/>
				<ListRow title={S.current} sub={S.plainSub} current onclick={() => {}} end={rowEnd} />
				<ListRow title={S.plainRow} sub={S.plainSub} mark="warning" />
				<ListRow title={S.noAlerts} empty />
			</RowList>
		</div>
		<div class="kit-stack">
			<Split listLabel={S.chat}>
				{#snippet list()}
					<RowList>
						<ListRow title={S.zoe} sub={S.tRenamed} start={rowAvatar} current onclick={() => {}} />
						<ListRow title={S.noah} sub={S.tOffline} onclick={() => {}} />
					</RowList>
				{/snippet}
				{#snippet detail()}<p class="kit-pad">{S.pickConversation}</p>{/snippet}
			</Split>
		</div>
	</section>

	<section class="kit-section" id="x-table">
		<h2>{S.tableStates}</h2>
		<div class="kit-stack">
			<Table
				label={S.devices}
				rows={devRows}
				columns={selColumns}
				key={(r) => r.id}
				bind:sort
				selectable
				bind:selection
				selectAllLabel={S.selectAll}
				onrowclick={() => {}}
			/>
		</div>
		<div class="kit-stack">
			<Table
				label={S.devices}
				rows={[]}
				columns={devColumns}
				key={(r) => r.id}
				loading
				loadingText={S.loadingDevices}
			/>
		</div>
		<div class="kit-stack">
			<Table label={S.devices} rows={[]} columns={devColumns} key={(r) => r.id} emptyText={S.noDevices} />
		</div>
		<div class="kit-stack">
			<Table
				label={S.devices}
				rows={[]}
				columns={devColumns}
				key={(r) => r.id}
				error={S.couldNotLoadDevices}
				onretry={() => {}}
			/>
		</div>
	</section>

	<section class="kit-section" id="x-charts">
		<h2>{S.charts}</h2>
		<div class="kit-stack">
			<Chart
				kind="line"
				label={S.lineLabel}
				summary={S.lineSummary}
				labels={DAYS}
				xHeading={S.day}
				series={[
					{ name: S.windowsS, values: [7, 8, 9, 11, 10, 6, 5] },
					{ name: S.linuxS, values: [3, 3, 4, 3, null, 2, 2] }
				]}
			/>
		</div>
		<div class="kit-stack">
			<Chart
				kind="columns"
				label={S.colLabel}
				summary={S.colSummary}
				labels={DAYS}
				xHeading={S.day}
				series={[{ name: S.connections, values: [12, 31, 18, 22, 9, 2, 0] }]}
			/>
		</div>
	</section>

	<section class="kit-section" id="x-diagram">
		<h2>{S.diagram}</h2>
		<div class="kit-stack">
			<ConnectionDiagram idServer="remote.example.com" relay="relay.example.org" />
		</div>
		<div class="kit-stack">
			<ConnectionDiagram idServer="remote.example.com" mode="relay-only" />
		</div>
		<div class="kit-stack kit-narrow-diagram">
			<ConnectionDiagram idServer="remote.example.com" relay="relay.example.org" />
		</div>
	</section>

	<section class="kit-section" id="x-terminal">
		<h2>{S.terminal}</h2>
		<div class="kit-stack">
			<Terminal label={S.terminalLabel} connect={fakeTerminal} />
		</div>
	</section>
</div>

{#if sheetOpen}
	<Sheet
		title={S.sheetTitle}
		subtitle={S.sheetSub}
		status={S.reached}
		statusTone="ok"
		onclose={() => {
			sheetOpen = false;
			stackedOpen = false;
		}}
	>
		<form class="kit-form" onsubmit={(e) => e.preventDefault()}>
			<Field label={S.displayName} hint={S.displayNameHint}>
				{#snippet children(f)}<Input {...f} value="Reception PC" />{/snippet}
			</Field>
			<FormSection title={S.connection}>
				<Field label={S.technology} width="medium">
					{#snippet children(f)}<Select
							{...f}
							options={[
								{ value: 'rdp', label: 'RDP' },
								{ value: 'vnc', label: 'VNC' }
							]}
							value="rdp"
						/>{/snippet}
				</Field>
				<Field label={S.host} width="host">
					{#snippet children(f)}<Input {...f} value="10.0.9.14" />{/snippet}
				</Field>
				<Field label={S.port} width="short">
					{#snippet children(f)}<Input {...f} type="number" value="3389" />{/snippet}
				</Field>
			</FormSection>
			<FormSection title={S.signIn}>
				<Field label={S.password} width="host">
					{#snippet children(f)}<Select
							{...f}
							options={[
								{ value: 'ask', label: S.askEvery },
								{ value: 'save', label: S.saveOnServer }
							]}
							value="save"
						/>{/snippet}
				</Field>
				<Field label={S.savedPassword} hint={S.savedPasswordHint} width="medium">
					{#snippet children(f)}<Input {...f} type="password" value="xxxxxxxx" />{/snippet}
				</Field>
			</FormSection>
		</form>
		{#snippet footer()}
			<Button class="sheet-footer-start" onclick={() => (sheetOpen = false)}>{S.cancel}</Button>
			<Button>{S.testConnection}</Button>
			<Button variant="primary" onclick={() => (sheetOpen = false)}>{S.save}</Button>
		{/snippet}
	</Sheet>
{/if}

{#if wideOpen}
	<Sheet title={S.wideTitle} subtitle={S.wideSub} wide status="" onclose={() => (wideOpen = false)}>
		<Table label={S.devices} rows={devRows} columns={devColumns} key={(r) => r.id} />
		{#snippet footer()}
			<Button class="sheet-footer-start" onclick={() => (wideOpen = false)}>{S.cancel}</Button>
			<Button variant="primary" onclick={() => (wideOpen = false)}>{S.save}</Button>
		{/snippet}
	</Sheet>
{/if}

{#if dialogOpen}
	<Dialog title={S.dialogTitle} message={S.dialogMessage} onclose={() => (dialogOpen = false)}>
		{#snippet footer()}
			<Button onclick={() => (dialogOpen = false)}>{S.cancel}</Button>
			<Button variant="danger" onclick={() => (dialogOpen = false)}>{S.deleteDevice}</Button>
		{/snippet}
	</Dialog>
{/if}

{#if stackedOpen}
	<Dialog title={S.discardTitle} message={S.discardMessage} onclose={() => (stackedOpen = false)}>
		{#snippet footer()}
			<Button onclick={() => (stackedOpen = false)}>{S.cancel}</Button>
			<Button variant="danger" onclick={() => (stackedOpen = false)}>{S.discard}</Button>
		{/snippet}
	</Dialog>
{/if}

<style>
	/* Kit layout only (as in ui-kit.html): nothing here styles a component */
	/* The shell's <main> gives the page its padding */
	.kit {
		min-width: 0;
	}
	.kit-title {
		margin-bottom: var(--space-5);
	}
	.kit-section > h2 {
		margin-top: var(--space-6);
	}
	.kit-section:first-of-type > h2 {
		margin-top: 0;
	}
	.kit-h3 {
		margin-top: var(--space-5);
	}
	.kit-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	/* Room for the open menu under its button */
	.kit-row.kit-top {
		align-items: flex-start;
		min-height: 230px;
	}
	.kit-row.kit-flush {
		margin: 0;
	}
	.kit-stack {
		margin-top: var(--space-3);
	}
	.kit-gap-y {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.kit-gap-y > :global(.notice) {
		align-self: stretch;
	}
	.kit-contents {
		display: contents;
	}
	.kit-gap {
		margin-inline-start: var(--space-5);
	}
	.kit-menu-gap {
		width: 240px;
	}
	.kit-grid {
		display: grid;
		grid-template-columns: 9rem repeat(4, max-content);
		align-items: center;
		gap: var(--space-3) var(--space-4);
		margin-top: var(--space-3);
	}
	.kit-grid.kit-grid-5 {
		grid-template-columns: 9rem repeat(5, max-content);
	}
	.kit-label {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.kit-head {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
	.kit-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
	.kit-row :global(.kit-auto) {
		width: auto;
	}
	.kit-dd {
		display: grid;
		grid-template-columns: 10rem minmax(0, 1fr) minmax(0, 1.3fr);
		align-items: center;
		gap: var(--space-3) var(--space-4);
		margin-top: var(--space-3);
	}
	.kit-sample {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		min-width: 0;
	}
	.kit-dd > code {
		color: var(--text-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.kit-toasts {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.kit-pair {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.kit-meters {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: var(--space-3) var(--space-5);
		margin-top: var(--space-3);
	}
	.kit-narrow {
		display: block;
		max-width: 360px;
	}
	.kit-narrow-diagram {
		max-width: 420px;
	}
	.kit-pad {
		padding: var(--space-4);
		color: var(--text-muted);
	}
	.kit-form {
		display: block;
	}
	@media (max-width: 640px) {
		.kit-dd,
		.kit-fields {
			grid-template-columns: minmax(0, 1fr);
		}
		.kit-dd {
			gap: var(--space-1) 0;
		}
		.kit-dd > code {
			margin-bottom: var(--space-3);
		}
		.kit-grid,
		.kit-grid.kit-grid-5 {
			overflow-x: auto;
		}
	}
</style>
