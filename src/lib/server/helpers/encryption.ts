/**
 * Key Lifecycle
 *
 * Resolves, caches, and rotates the AES-256-GCM key.
 * Crypto primitives live in `crypto-utils.ts`; rotation orchestration in `credential-migration.ts`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as CryptoUtils from './crypto-utils';

// ── Config ───────────────────────────────────────────────────────────────

const KEY_BYTES = 32;
const KEY_FILENAME = '.encryption_key';
const LOG = '[Encryption]';
const STORAGE_DIR = process.env.DATA_DIR ?? './data';

// ── Runtime State ────────────────────────────────────────────────────────

let resolvedKey: Buffer | null = null;

/** Populated when the env key differs from the persisted key; cleared by `finalizeKeyRotation()`. */
let stagedRotation: { oldKey: Buffer; newKey: Buffer } | null = null;

// ── Internal Helpers ─────────────────────────────────────────────────────

/** Format an error for logging. */
function fmtErr(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Decode `ENCRYPTION_KEY` env var. Returns a validated 32-byte Buffer, or `null`. */
function decodeEnvKey(): Buffer | null {
	const envValue = process.env.ENCRYPTION_KEY;
	if (!envValue) return null;

	let decoded: Buffer;
	try {
		decoded = Buffer.from(envValue, 'base64');
	} catch {
		console.warn(`${LOG} ENCRYPTION_KEY is not valid base64 — falling back to key file`);
		return null;
	}

	if (decoded.length !== KEY_BYTES) {
		console.warn(
			`${LOG} ENCRYPTION_KEY is ${decoded.length} bytes (need ${KEY_BYTES}) — falling back to key file`
		);
		return null;
	}

	return decoded;
}

/** Read and validate the persisted key file. Throws on I/O error or corruption. */
function loadStoredKey(path: string): Buffer {
	let data: Buffer;
	try {
		data = readFileSync(path);
	} catch (err) {
		throw new Error(`${LOG} Cannot read key file at ${path}: ${fmtErr(err)}`);
	}

	if (data.length !== KEY_BYTES) {
		throw new Error(
			`${LOG} Key file corrupt — ${data.length} bytes, expected ${KEY_BYTES} (${path})`
		);
	}

	return data;
}

/** Generate a random key and write it to disk. Returns the key even if persistence fails. */
function createNewKey(path: string): Buffer {
	if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });

	const fresh = randomBytes(KEY_BYTES);
	console.log(`${LOG} Generated new ${KEY_BYTES * 8}-bit encryption key`);

	try {
		writeFileSync(path, fresh, { mode: 0o600 });
		console.log(`${LOG} Key persisted to ${path} (mode 0600)`);
	} catch (err) {
		console.error(`${LOG} Could not write key file: ${fmtErr(err)}`);
		console.error(`${LOG} Key is in-memory only — will be lost on restart`);
	}

	return fresh;
}

/** Remove the key file after it is no longer needed. Warns on failure. */
function eraseKeyFile(path: string): void {
	try {
		unlinkSync(path);
		console.log(`${LOG} Key file removed — env var is now the sole key source`);
	} catch (err) {
		console.warn(`${LOG} Could not remove key file (${path}): ${fmtErr(err)}`);
	}
}

/**
 * Reconcile the stored key with the env key and decide what action to take.
 * Returns the key that should be active right now.
 */
function reconcileKeys(storedKey: Buffer, envKey: Buffer, filePath: string): Buffer {
	if (storedKey.equals(envKey)) {
		eraseKeyFile(filePath);
		return envKey;
	}

	console.log(`${LOG} ENCRYPTION_KEY differs from stored key — staging rotation`);
	console.log(`${LOG} Old key stays active until credentials are re-encrypted`);
	stagedRotation = { oldKey: storedKey, newKey: envKey };
	return storedKey;
}

// ── Key Resolution ───────────────────────────────────────────────────────

/** Resolve, cache, and return the active encryption key. Throws if the key file is unreadable. */
export function getEncryptionKey(): Buffer {
	if (resolvedKey) return resolvedKey;

	const filePath = join(STORAGE_DIR, KEY_FILENAME);
	const hasFile = existsSync(filePath);
	const envKey = decodeEnvKey();

	if (hasFile) {
		const storedKey = loadStoredKey(filePath);

		if (envKey) {
			resolvedKey = reconcileKeys(storedKey, envKey, filePath);
		} else {
			console.log(`${LOG} Using key from ${filePath}`);
			resolvedKey = storedKey;
		}
	} else if (envKey) {
		console.log(`${LOG} Using ENCRYPTION_KEY from environment`);
		resolvedKey = envKey;
	} else {
		resolvedKey = createNewKey(filePath);
	}

	return resolvedKey;
}

// ── Encrypt / Decrypt ────────────────────────────────────────────────────

/** Encrypt with the resolved key. Blank and already-encrypted values pass through. */
export function encrypt(input: string | null | undefined): string | null {
	return CryptoUtils.encrypt(input, getEncryptionKey());
}

/** Decrypt with the resolved key. Non-prefixed values pass through unchanged. */
export function decrypt(input: string | null | undefined): string | null {
	return CryptoUtils.decrypt(input, getEncryptionKey());
}

/** True when the value carries the `enc:v1:` prefix. */
export const isEncrypted = CryptoUtils.isEncrypted;

// ── Rotation ─────────────────────────────────────────────────────────────

/** Return staged rotation info, or `null` if no rotation is pending. Ensures the key is resolved first. */
export function checkKeyRotation(): { oldKey: Buffer; newKey: Buffer; keyPath: string } | null {
	getEncryptionKey();

	if (!stagedRotation) return null;

	const keyPath = join(STORAGE_DIR, KEY_FILENAME);
	console.log(`${LOG} Rotation pending — old key file: ${keyPath}`);
	return { oldKey: stagedRotation.oldKey, newKey: stagedRotation.newKey, keyPath };
}

/** Commit the new key as active and clear the staged rotation. */
export function finalizeKeyRotation(newKey: Buffer): void {
	resolvedKey = newKey;
	stagedRotation = null;
	console.log(`${LOG} Rotation complete — new key is now active`);
}
