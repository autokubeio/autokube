import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateKeyPairSync, createHash, createPrivateKey, randomBytes } from 'node:crypto';
import { authorize } from '$lib/server/services/authorize';

// ── OpenSSH binary key format helpers ───────────────────────────────────────

function uint32BE(n: number): Buffer {
	const b = Buffer.allocUnsafe(4);
	b.writeUInt32BE(n, 0);
	return b;
}

/** Encode a string or Buffer as an SSH "string" (uint32 length + bytes). */
function sshString(data: string | Buffer): Buffer {
	const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
	return Buffer.concat([uint32BE(buf.length), buf]);
}

/** Encode a base64url big integer as an SSH mpint (always positive). */
function sshMpint(b64url: string): Buffer {
	const raw = Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	let start = 0;
	while (start < raw.length - 1 && raw[start] === 0) start++;
	const bytes = raw.subarray(start);
	const data = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
	return Buffer.concat([uint32BE(data.length), data]);
}

/** Decode a PEM envelope to raw DER bytes. */
function pemToDer(pem: string): Buffer {
	return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

/**
 * Wrap key-type-specific public+private blobs into the standard
 * "openssh-key-v1" PEM envelope (no passphrase, no KDF).
 */
function buildOpensshPrivateKey(pubBlob: Buffer, privBlob: Buffer): string {
	const checkInt = randomBytes(4);
	const privPayload = Buffer.concat([
		checkInt,
		checkInt,
		privBlob,
		sshString(Buffer.alloc(0)) // empty comment
	]);
	// Pad to 8-byte block boundary
	const padLen = (8 - (privPayload.length % 8)) % 8;
	const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1));
	const privSection = Buffer.concat([privPayload, padding]);

	const body = Buffer.concat([
		Buffer.from('openssh-key-v1\0'), // magic
		sshString('none'),               // cipher
		sshString('none'),               // kdf
		uint32BE(0),                     // kdf options length (empty)
		uint32BE(1),                     // number of keys
		sshString(pubBlob),              // public key blob
		sshString(privSection)           // private key section
	]);

	const b64 = body.toString('base64').match(/.{1,70}/g)!.join('\n');
	return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

// ── Key generators ───────────────────────────────────────────────────────────

function generateEd25519(): { publicKey: string; privateKey: string } {
	const { publicKey: pubPem, privateKey: privPem } = generateKeyPairSync('ed25519', {
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});

	const privDer = pemToDer(privPem);
	const pubDer = pemToDer(pubPem);

	// ed25519 PKCS#8 DER is always 48 bytes; private seed is at bytes 16–47
	const privSeed = privDer.subarray(16, 48);
	// ed25519 SPKI DER is always 44 bytes; public key is at bytes 12–43
	const pubBytes = pubDer.subarray(12, 44);

	// SSH public key blob: string("ssh-ed25519") + string(pubkey)
	const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pubBytes)]);

	// OpenSSH private key blob: string("ssh-ed25519") + string(pubkey) + string(seed || pubkey)
	// The public key MUST appear inside the private section — OpenSSH rejects keys without it.
	const privBlob = Buffer.concat([
		sshString('ssh-ed25519'),
		sshString(pubBytes),                          // 32-byte public key
		sshString(Buffer.concat([privSeed, pubBytes])) // 64-byte NaCl secret key
	]);

	return {
		publicKey: `ssh-ed25519 ${pubBlob.toString('base64')}`,
		privateKey: buildOpensshPrivateKey(pubBlob, privBlob)
	};
}

function generateRsa4096(): { publicKey: string; privateKey: string } {
	const { privateKey: privPem } = generateKeyPairSync('rsa', {
		modulusLength: 4096,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});

	// JWK gives us easy access to all RSA bignum components as base64url
	const jwk = createPrivateKey(privPem).export({ format: 'jwk' }) as {
		n: string; e: string; d: string; p: string; q: string; qi: string;
	};

	// SSH RSA public key blob: string("ssh-rsa") + mpint(e) + mpint(n)
	const pubBlob = Buffer.concat([sshString('ssh-rsa'), sshMpint(jwk.e), sshMpint(jwk.n)]);

	// OpenSSH RSA private blob: string("ssh-rsa") + n + e + d + iqmp + p + q
	const privBlob = Buffer.concat([
		sshString('ssh-rsa'),
		sshMpint(jwk.n),
		sshMpint(jwk.e),
		sshMpint(jwk.d),
		sshMpint(jwk.qi), // iqmp = q^(-1) mod p
		sshMpint(jwk.p),
		sshMpint(jwk.q)
	]);

	return {
		publicKey: `ssh-rsa ${pubBlob.toString('base64')}`,
		privateKey: buildOpensshPrivateKey(pubBlob, privBlob)
	};
}

// ── Request handler ──────────────────────────────────────────────────────────

/**
 * POST /api/ssh-keys/generate
 * Generate a real SSH key pair in OpenSSH format.
 * Returns { publicKey, privateKey, fingerprint, keyType }.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const keyType: 'ed25519' | 'rsa' = body.keyType === 'rsa' ? 'rsa' : 'ed25519';

		const { publicKey, privateKey } =
			keyType === 'ed25519' ? generateEd25519() : generateRsa4096();

		// SHA-256 fingerprint of the public key string (for display)
		const hash = createHash('sha256').update(publicKey).digest('base64');
		const fingerprint = `SHA256:${hash}`;

		return json({ publicKey, privateKey, fingerprint, keyType });
	} catch (err) {
		console.error('[API] Failed to generate SSH key:', err);
		return json({ error: 'Failed to generate SSH key pair' }, { status: 500 });
	}
};
