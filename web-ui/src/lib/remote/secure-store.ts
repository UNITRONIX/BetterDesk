/**
 * Passwords the remote client remembers in this browser: the console
 * sign-in of /remote/login ("Remember me") and device passwords from the
 * viewer ("Remember the password in this browser"). Port of
 * public/js/rdclientSecureStore.js with the changes of DECISIONS S5:
 *
 * - The AES-GCM key is a non-extractable CryptoKey kept in IndexedDB. The
 *   old store kept the raw key bytes next to the ciphertext; a raw key
 *   found there is imported once as non-extractable and the raw bytes are
 *   replaced, so passwords saved before still open.
 * - Device passwords saved before the last sign-out in this browser are
 *   forgotten: sign-out (the shell's account menu) leaves a "logout"
 *   record under betterdesk.session.expired, and the store drops older
 *   device passwords when it next opens. forgetDevicePasswords() clears
 *   them right away.
 * - "Remember me" starts off (the sign-in page decides; nothing here
 *   remembers a password unless asked to).
 *
 * Same database as before (betterdesk-rdclient, store "vault").
 */

export interface VaultBackend {
	get(key: string): Promise<unknown>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

export interface SecureStoreDeps {
	backend: () => Promise<VaultBackend | null>;
	subtle: SubtleCrypto | null;
	random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
	/** When this browser last signed out (ms), 0 when never */
	lastSignOut: () => number;
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface Credentials {
	username: string;
	password: string;
	rememberPassword: boolean;
}

interface Encrypted {
	iv: string;
	data: string;
}

const DB_NAME = 'betterdesk-rdclient';
const DB_VERSION = 2;
const STORE = 'vault';
export const KEY_ID = 'device-key';
export const CRED_ID = 'credentials';
export const USERNAME_KEY = 'bd_rdclient_last_user';
/** Written by the shell on sign-out (session-guard broadcastExpired) */
export const SIGN_OUT_KEY = 'betterdesk.session.expired';
const PEER_PREFIX = 'peer:';

function b64(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
	const bin = atob(text);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function isCryptoKey(v: unknown): v is CryptoKey {
	return !!v && typeof v === 'object' && 'type' in v && 'algorithm' in v && 'usages' in v;
}

export function createSecureStore(deps: SecureStoreDeps) {
	const { subtle } = deps;

	/** The vault key: non-extractable; a raw key from the old store is converted on first use */
	async function vaultKey(db: VaultBackend): Promise<CryptoKey> {
		if (!subtle) throw new Error('Web Crypto unavailable');
		const existing = (await db.get(KEY_ID)) as { cryptoKey?: unknown; key?: unknown } | undefined;
		if (existing && isCryptoKey(existing.cryptoKey)) return existing.cryptoKey;
		let raw: Uint8Array<ArrayBuffer>;
		if (existing && typeof existing.key === 'string') raw = unb64(existing.key);
		else raw = deps.random(new Uint8Array(32));
		const key = await subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
			'encrypt',
			'decrypt'
		]);
		raw.fill(0);
		await db.put(KEY_ID, { cryptoKey: key });
		return key;
	}

	function webCrypto(): SubtleCrypto {
		if (!subtle) throw new Error('Web Crypto unavailable');
		return subtle;
	}

	async function encrypt(key: CryptoKey, text: string): Promise<Encrypted> {
		const iv = deps.random(new Uint8Array(12));
		const data = await webCrypto().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
		return { iv: b64(iv), data: b64(data) };
	}

	async function decrypt(key: CryptoKey, payload: Partial<Encrypted> | null | undefined): Promise<string> {
		if (!payload?.iv || !payload.data) return '';
		const plain = await webCrypto().decrypt(
			{ name: 'AES-GCM', iv: unb64(payload.iv) },
			key,
			unb64(payload.data)
		);
		return new TextDecoder().decode(plain);
	}

	function saveLastUsername(username: string): void {
		try {
			if (username) deps.storage?.setItem(USERNAME_KEY, username);
			else deps.storage?.removeItem(USERNAME_KEY);
		} catch {
			/* storage blocked */
		}
	}

	function loadLastUsername(): string {
		try {
			return deps.storage?.getItem(USERNAME_KEY) ?? '';
		} catch {
			return '';
		}
	}

	async function clearStoredPassword(): Promise<void> {
		const db = await deps.backend();
		if (db) await db.delete(CRED_ID);
	}

	async function saveCredentials(username: string, password: string, remember: boolean): Promise<void> {
		saveLastUsername(username);
		if (!remember || !password) return clearStoredPassword();
		const db = await deps.backend();
		if (!db || !subtle) return;
		const key = await vaultKey(db);
		await db.put(CRED_ID, {
			username,
			password: await encrypt(key, password),
			rememberPassword: true,
			updatedAt: Date.now()
		});
	}

	async function loadCredentials(): Promise<Credentials> {
		const result: Credentials = { username: loadLastUsername(), password: '', rememberPassword: false };
		const db = await deps.backend().catch(() => null);
		if (!db || !subtle) return result;
		try {
			const rec = (await db.get(CRED_ID)) as
				{ username?: string; password?: Encrypted; rememberPassword?: boolean } | undefined;
			if (!rec?.rememberPassword || !rec.password) return result;
			const key = await vaultKey(db);
			return {
				username: rec.username || result.username,
				password: await decrypt(key, rec.password),
				rememberPassword: true
			};
		} catch {
			return result;
		}
	}

	async function clearCredentials(): Promise<void> {
		saveLastUsername('');
		await clearStoredPassword();
	}

	async function hasStoredPassword(): Promise<boolean> {
		const db = await deps.backend().catch(() => null);
		if (!db) return false;
		try {
			const rec = (await db.get(CRED_ID)) as { rememberPassword?: boolean; password?: unknown } | undefined;
			return !!(rec?.rememberPassword && rec.password);
		} catch {
			return false;
		}
	}

	const peerKey = (id: string) => PEER_PREFIX + String(id || '').trim();

	async function savePeerPassword(deviceId: string, password: string): Promise<void> {
		if (!deviceId || !password) return;
		const db = await deps.backend();
		if (!db || !subtle) return;
		const key = await vaultKey(db);
		await db.put(peerKey(deviceId), { encrypted: await encrypt(key, password), updatedAt: Date.now() });
	}

	async function loadPeerPassword(deviceId: string): Promise<string> {
		if (!deviceId) return '';
		const db = await deps.backend().catch(() => null);
		if (!db || !subtle) return '';
		try {
			const rec = (await db.get(peerKey(deviceId))) as
				{ encrypted?: Encrypted; updatedAt?: number } | undefined;
			if (!rec?.encrypted) return '';
			// Saved before the last sign-out in this browser: forget it
			if ((rec.updatedAt ?? 0) <= deps.lastSignOut()) {
				await db.delete(peerKey(deviceId));
				return '';
			}
			return await decrypt(await vaultKey(db), rec.encrypted);
		} catch {
			return '';
		}
	}

	async function clearPeerPassword(deviceId: string): Promise<void> {
		if (!deviceId) return;
		const db = await deps.backend();
		if (db) await db.delete(peerKey(deviceId));
	}

	/** Every remembered device password (sign-out) */
	async function forgetDevicePasswords(): Promise<void> {
		const db = await deps.backend().catch(() => null);
		if (!db) return;
		for (const k of await db.keys()) if (k.startsWith(PEER_PREFIX)) await db.delete(k);
	}

	return {
		saveCredentials,
		loadCredentials,
		clearCredentials,
		clearStoredPassword,
		hasStoredPassword,
		loadLastUsername,
		savePeerPassword,
		loadPeerPassword,
		clearPeerPassword,
		forgetDevicePasswords,
		/** For tests: the key the store uses */
		vaultKey: async () => {
			const db = await deps.backend();
			if (!db) throw new Error('no database');
			return vaultKey(db);
		}
	};
}

export type SecureStore = ReturnType<typeof createSecureStore>;

/* ── The browser's IndexedDB ── */

function idb<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

let opened: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	opened ??= new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
	}).catch((err: unknown) => {
		opened = null;
		throw err;
	});
	return opened;
}

const idbBackend: VaultBackend = {
	async get(key) {
		const db = await openDb();
		return idb(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
	},
	async put(key, value) {
		const db = await openDb();
		await idb(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
	},
	async delete(key) {
		const db = await openDb();
		await idb(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
	},
	async keys() {
		const db = await openDb();
		const keys = await idb(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
		return keys.map(String);
	}
};

/** When the shell last signed this browser out (its "logout" record) */
export function readLastSignOut(storage: Pick<Storage, 'getItem'> | null): number {
	try {
		const rec = JSON.parse(storage?.getItem(SIGN_OUT_KEY) || 'null') as {
			at?: unknown;
			code?: unknown;
		} | null;
		return rec && rec.code === 'logout' && typeof rec.at === 'number' ? rec.at : 0;
	} catch {
		return 0;
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

let browserStore: SecureStore | null = null;

export function secureStore(): SecureStore {
	browserStore ??= createSecureStore({
		backend: async () => (typeof indexedDB === 'undefined' ? null : idbBackend),
		subtle: typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null,
		random: (bytes) => crypto.getRandomValues(bytes),
		lastSignOut: () => readLastSignOut(safeStorage()),
		storage: safeStorage()
	});
	return browserStore;
}

/**
 * Forget remembered device passwords when this browser signs out: now, if
 * a sign-out already happened elsewhere (another tab), and whenever the
 * shell announces one. Returns the function that stops listening.
 */
export function watchSignOut(
	onSignOut: () => void = () => void secureStore().forgetDevicePasswords()
): () => void {
	const onStorage = (e: StorageEvent) => {
		if (e.key === SIGN_OUT_KEY && readLastSignOut(safeStorage()) > 0) onSignOut();
	};
	window.addEventListener('storage', onStorage);
	let channel: BroadcastChannel | null = null;
	try {
		channel =
			typeof BroadcastChannel === 'function' ? new BroadcastChannel('betterdesk-panel-session') : null;
		if (channel)
			channel.onmessage = (e: MessageEvent<{ type?: string; code?: string }>) => {
				if (e.data?.type === 'expired' && e.data.code === 'logout') onSignOut();
			};
	} catch {
		channel = null;
	}
	return () => {
		window.removeEventListener('storage', onStorage);
		channel?.close();
	};
}
