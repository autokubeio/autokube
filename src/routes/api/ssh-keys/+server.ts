import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash, createPublicKey, createPrivateKey } from 'node:crypto';
import { listSshKeys, insertSshKey } from '$lib/server/queries/ssh-keys';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

/** Compute a SHA-256 fingerprint from key material. */
function computeFingerprint(key: string): string {
	const hash = createHash('sha256').update(key).digest('base64');
	return `SHA256:${hash}`;
}

/** Detect key type from an OpenSSH public key string. */
function detectKeyType(publicKey: string): 'ed25519' | 'rsa' {
	const trimmed = publicKey.trim().toLowerCase();
	if (trimmed.startsWith('ssh-rsa')) return 'rsa';
	return 'ed25519';
}

function uint32BE(n: number): Buffer {
	const b = Buffer.allocUnsafe(4);
	b.writeUInt32BE(n, 0);
	return b;
}
function sshStr(s: string | Buffer): Buffer {
	const buf = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
	return Buffer.concat([uint32BE(buf.length), buf]);
}
function sshMpint(b64url: string): Buffer {
	const raw = Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	let start = 0;
	while (start < raw.length - 1 && raw[start] === 0) start++;
	const bytes = raw.subarray(start);
	const data = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
	return Buffer.concat([uint32BE(data.length), data]);
}

/**
 * Extract public key from an OpenSSH private key PEM by parsing the binary
 * format directly — reliable regardless of runtime crypto library support.
 * Format: magic(16) + ciphername + kdfname + kdfoptions + nkeys(4) + pubkey_blob + ...
 */
function extractPublicKeyFromOpenSSH(pem: string): string {
	const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
	const buf = Buffer.from(body, 'base64');

	const MAGIC = 'openssh-key-v1\0';
	if (buf.toString('ascii', 0, MAGIC.length) !== MAGIC) {
		throw new Error('Not an OpenSSH private key');
	}

	let pos = MAGIC.length;
	// Skip ciphername, kdfname, kdfoptions (each is uint32-length-prefixed string)
	for (let i = 0; i < 3; i++) {
		const len = buf.readUInt32BE(pos);
		pos += 4 + len;
	}
	// Skip nkeys (uint32)
	pos += 4;
	// Read the first public key blob (uint32-length-prefixed)
	const pubBlobLen = buf.readUInt32BE(pos);
	const pubBlob = buf.subarray(pos + 4, pos + 4 + pubBlobLen);

	// Read key type from blob
	const typeLen = pubBlob.readUInt32BE(0);
	const keyType = pubBlob.toString('utf8', 4, 4 + typeLen);

	if (keyType !== 'ssh-ed25519' && keyType !== 'ssh-rsa') {
		throw new Error(`Unsupported key type: ${keyType}`);
	}

	return `${keyType} ${pubBlob.toString('base64')}`;
}

/**
 * Derive the SSH public key (authorized_keys format) from any supported
 * private key format. Tries OpenSSH binary parsing first, then falls back
 * to Node crypto for PKCS#8/legacy PEM formats.
 */
function derivePublicKey(privateKeyPem: string): string {
	const trimmed = privateKeyPem.trim();

	// OpenSSH format — parse binary directly (works in all runtimes)
	if (trimmed.includes('BEGIN OPENSSH PRIVATE KEY')) {
		return extractPublicKeyFromOpenSSH(trimmed);
	}

	// PKCS#8 / legacy PEM — use Node crypto
	const keyObj = createPublicKey(createPrivateKey(trimmed));
	const type = keyObj.asymmetricKeyType;
	if (type === 'ed25519') {
		const der = keyObj.export({ type: 'spki', format: 'der' }) as Buffer;
		const pubBytes = der.subarray(der.length - 32);
		const blob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(pubBytes)]);
		return `ssh-ed25519 ${blob.toString('base64')}`;
	} else if (type === 'rsa') {
		const jwk = keyObj.export({ format: 'jwk' }) as { n: string; e: string };
		const blob = Buffer.concat([sshStr('ssh-rsa'), sshMpint(jwk.e), sshMpint(jwk.n)]);
		return `ssh-rsa ${blob.toString('base64')}`;
	}
	throw new Error(`Unsupported key type: ${type}`);
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const rows = await listSshKeys();

		// Strip private keys from list response; expose a boolean flag instead
		const safe = rows.map(({ privateKey, ...rest }) => ({ ...rest, hasPrivateKey: !!privateKey }));

		return json({ sshKeys: safe, total: safe.length });
	} catch (err) {
		console.error('[API] Failed to list SSH keys:', err);
		return json({ error: 'Failed to list SSH keys' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'create')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();

		if (!body.name) {
			return json({ error: 'Name is required' }, { status: 400 });
		}
		if (!body.publicKey && !body.privateKey) {
			return json({ error: 'Either publicKey or privateKey is required' }, { status: 400 });
		}

		// Determine key type: explicit > detected from public key > default
		let publicKey: string = body.publicKey ?? '';
		const privateKey: string = body.privateKey ?? '';

		// Derive public key from private key if not provided
		if (!publicKey && privateKey) {
			try {
				publicKey = derivePublicKey(privateKey);
			} catch (e) {
				return json({ error: 'Could not derive public key from the provided private key — ensure the key is a valid unencrypted PEM.' }, { status: 400 });
			}
		}

		const keyType = body.keyType ?? (publicKey ? detectKeyType(publicKey) : 'ed25519');

		// Compute fingerprint if not provided
		const fingerprint =
			body.fingerprint ||
			(publicKey
				? computeFingerprint(publicKey)
				: privateKey
					? computeFingerprint(privateKey)
					: '');

		const row = await insertSshKey({
			name: body.name,
			description: body.description,
			keyType,
			publicKey,
			privateKey,
			fingerprint
		});

		// Strip private key from response
		const { privateKey: _, ...safe } = row;

		await logAuditEvent({
			username: 'system',
			action: 'create',
			entityType: 'ssh_key',
			entityId: String(row.id),
			entityName: row.name,
			description: `Created SSH key "${row.name}" (${keyType})`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(safe, { status: 201 });
	} catch (err) {
		console.error('[API] Failed to create SSH key:', err);
		return json({ error: 'Failed to create SSH key' }, { status: 500 });
	}
};
