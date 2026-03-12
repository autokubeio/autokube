/**
 * Crypto Utilities
 *
 * Stateless AES-256-GCM helpers. Key is always caller-supplied;
 * no side-effects, no dependency on key management.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// ── Config ─────────────────────────────────────────────────────────────────

const CIPHER = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN = 16;
const ENC_PREFIX = 'enc:v1:';
const LOG = '[Encryption]';

// ── Internals ──────────────────────────────────────────────────────────────

/** True when the input is null, undefined, or empty string. */
function isBlank(v: string | null | undefined): v is null | undefined | '' {
	return v === null || v === undefined || v === '';
}

/** Split a base64 payload into nonce, auth tag, and ciphertext. Returns `null` if malformed. */
function unpackPayload(b64: string): { nonce: Buffer; tag: Buffer; data: Buffer } | null {
	let buf: Buffer;
	try {
		buf = Buffer.from(b64, 'base64');
	} catch {
		return null;
	}

	if (buf.length < NONCE_LEN + TAG_LEN + 1) return null;

	return {
		nonce: buf.subarray(0, NONCE_LEN),
		tag: buf.subarray(NONCE_LEN, NONCE_LEN + TAG_LEN),
		data: buf.subarray(NONCE_LEN + TAG_LEN)
	};
}

// ── Public API ─────────────────────────────────────────────────────────────

/** AES-256-GCM encrypt. Blank / already-encrypted values pass through. Output: `enc:v1:<base64(nonce+tag+ciphertext)>` */
export function encrypt(input: string | null | undefined, key: Buffer): string | null {
	if (isBlank(input)) return input as string | null;
	if (input.startsWith(ENC_PREFIX)) return input;

	const nonce = randomBytes(NONCE_LEN);
	const cipher = createCipheriv(CIPHER, key, nonce);
	const sealed = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
	const packed = Buffer.concat([nonce, cipher.getAuthTag(), sealed]);

	return ENC_PREFIX + packed.toString('base64');
}

/** AES-256-GCM decrypt. Non-prefixed values pass through. Returns original on failure to prevent data loss. */
export function decrypt(input: string | null | undefined, key: Buffer): string | null {
	if (isBlank(input)) return input as string | null;
	if (!input.startsWith(ENC_PREFIX)) return input;

	const parts = unpackPayload(input.substring(ENC_PREFIX.length));
	if (!parts) {
		console.error(`${LOG} Malformed encrypted payload — cannot decode`);
		return input;
	}

	try {
		const decipher = createDecipheriv(CIPHER, key, parts.nonce);
		decipher.setAuthTag(parts.tag);
		return Buffer.concat([decipher.update(parts.data), decipher.final()]).toString('utf8');
	} catch (err) {
		console.error(`${LOG} Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
		return input;
	}
}

/** True when the value carries the `enc:v1:` prefix. */
export function isEncrypted(value: string | null | undefined): boolean {
	return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}
