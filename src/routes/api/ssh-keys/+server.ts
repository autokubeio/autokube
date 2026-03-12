import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash } from 'node:crypto';
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

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const rows = await listSshKeys();

		// Strip private keys from list response
		const safe = rows.map(({ privateKey: _, ...rest }) => rest);

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
		const publicKey: string = body.publicKey ?? '';
		const privateKey: string = body.privateKey ?? '';
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
