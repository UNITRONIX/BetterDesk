/**
 * Remembered passwords of the remote client (DECISIONS S5): the vault key
 * is a non-extractable CryptoKey, a raw key left by the old store is
 * converted (and old passwords still open), device passwords saved before
 * a sign-out are forgotten, and nothing is remembered unless asked.
 */
import { webcrypto } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
	CRED_ID,
	KEY_ID,
	SIGN_OUT_KEY,
	createSecureStore,
	readLastSignOut,
	type VaultBackend
} from '../../../src/lib/remote/secure-store.ts';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

function memory(): VaultBackend & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		get: async (k) => data.get(k),
		put: async (k, v) => void data.set(k, v),
		delete: async (k) => void data.delete(k),
		keys: async () => [...data.keys()]
	};
}

function memStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k)
	};
}

function store(db = memory(), lastSignOut = () => 0) {
	return {
		db,
		s: createSecureStore({
			backend: async () => db,
			subtle,
			random: (b) => webcrypto.getRandomValues(b),
			lastSignOut,
			storage: memStorage()
		})
	};
}

describe('remote client secure store', () => {
	test('keeps a non-extractable key, never raw key bytes', async () => {
		const { db, s } = store();
		await s.savePeerPassword('900100012', 'demo');
		const rec = db.data.get(KEY_ID) as { cryptoKey?: CryptoKey; key?: unknown };
		expect(rec.key).toBeUndefined();
		expect(rec.cryptoKey?.extractable).toBe(false);
		await expect(subtle.exportKey('raw', rec.cryptoKey!)).rejects.toThrow();
		expect(await s.loadPeerPassword('900100012')).toBe('demo');
		// The stored value is ciphertext, not the password
		expect(JSON.stringify(db.data.get('peer:900100012'))).not.toContain('demo');
	});

	test('converts a raw key from the old store; passwords saved with it still open', async () => {
		const db = memory();
		const raw = webcrypto.getRandomValues(new Uint8Array(32));
		const oldKey = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
		const iv = webcrypto.getRandomValues(new Uint8Array(12));
		const data = await subtle.encrypt(
			{ name: 'AES-GCM', iv },
			oldKey,
			new TextEncoder().encode('old-secret')
		);
		const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
		db.data.set(KEY_ID, { key: b64(raw) });
		db.data.set('peer:A01', {
			encrypted: { iv: b64(iv), data: b64(new Uint8Array(data)) },
			updatedAt: Date.now()
		});
		const { s } = store(db);
		expect(await s.loadPeerPassword('A01')).toBe('old-secret');
		const rec = db.data.get(KEY_ID) as { cryptoKey?: CryptoKey; key?: unknown };
		expect(rec.key).toBeUndefined();
		expect(rec.cryptoKey?.extractable).toBe(false);
	});

	test('forgets device passwords saved before the last sign-out', async () => {
		let signedOut = 0;
		const { db, s } = store(memory(), () => signedOut);
		await s.savePeerPassword('A01', 'pw1');
		signedOut = Date.now() + 1;
		expect(await s.loadPeerPassword('A01')).toBe('');
		expect(db.data.has('peer:A01')).toBe(false);
	});

	test('forgetDevicePasswords clears every device password and keeps the rest', async () => {
		const { db, s } = store();
		await s.savePeerPassword('A01', 'pw1');
		await s.savePeerPassword('B02', 'pw2');
		await s.saveCredentials('demo_ui_admin', 'console-pw', true);
		await s.forgetDevicePasswords();
		expect([...db.data.keys()].filter((k) => k.startsWith('peer:'))).toEqual([]);
		expect(db.data.has(CRED_ID)).toBe(true);
	});

	test('the sign-in password is remembered only when asked, and dropped when not', async () => {
		const { db, s } = store();
		await s.saveCredentials('demo_ui_admin', 'console-pw', false);
		expect(db.data.has(CRED_ID)).toBe(false);
		expect((await s.loadCredentials()).username).toBe('demo_ui_admin');
		await s.saveCredentials('demo_ui_admin', 'console-pw', true);
		expect(await s.loadCredentials()).toEqual({
			username: 'demo_ui_admin',
			password: 'console-pw',
			rememberPassword: true
		});
		await s.saveCredentials('demo_ui_admin', 'console-pw', false);
		expect(await s.hasStoredPassword()).toBe(false);
	});

	test('reads the shell sign-out record only for a sign-out', () => {
		const st = memStorage();
		expect(readLastSignOut(st)).toBe(0);
		st.setItem(SIGN_OUT_KEY, JSON.stringify({ at: 1234, code: 'session_expired' }));
		expect(readLastSignOut(st)).toBe(0);
		st.setItem(SIGN_OUT_KEY, JSON.stringify({ at: 1234, code: 'logout' }));
		expect(readLastSignOut(st)).toBe(1234);
		st.setItem(SIGN_OUT_KEY, '{nope');
		expect(readLastSignOut(st)).toBe(0);
	});
});
