import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { authorize } from '$lib/server/services/authorize';

/**
 * POST /api/ssh-keys/generate
 * Generate a real SSH key pair (ed25519 or rsa).
 * Returns { publicKey, privateKey, fingerprint, keyType }.
 */
export const POST: RequestHandler = async ({ request, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'create')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const keyType: 'ed25519' | 'rsa' = body.keyType === 'rsa' ? 'rsa' : 'ed25519';

		let publicKey: string;
		let privateKey: string;

		if (keyType === 'ed25519') {
			const pair = generateKeyPairSync('ed25519', {
				publicKeyEncoding: { type: 'spki', format: 'pem' },
				privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
			});
			publicKey = pair.publicKey;
			privateKey = pair.privateKey;
		} else {
			const pair = generateKeyPairSync('rsa', {
				modulusLength: 4096,
				publicKeyEncoding: { type: 'spki', format: 'pem' },
				privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
			});
			publicKey = pair.publicKey;
			privateKey = pair.privateKey;
		}

		// Compute SHA-256 fingerprint of the public key
		const hash = createHash('sha256').update(publicKey).digest('base64');
		const fingerprint = `SHA256:${hash}`;

		return json({ publicKey, privateKey, fingerprint, keyType });
	} catch (err) {
		console.error('[API] Failed to generate SSH key:', err);
		return json({ error: 'Failed to generate SSH key pair' }, { status: 500 });
	}
};
