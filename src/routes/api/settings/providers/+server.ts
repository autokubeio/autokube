/** Provider token management — store/retrieve encrypted cloud provider API tokens. */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting } from '$lib/server/queries/settings';
import { authorize } from '$lib/server/services/authorize';
import { encrypt, decrypt } from '$lib/server/helpers/encryption';

const SUPPORTED_PROVIDERS = ['hetzner'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

function tokenKey(provider: Provider) {
	return `provider_token_${provider}`;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const tokens: Record<string, boolean> = {};
	for (const p of SUPPORTED_PROVIDERS) {
		const raw = (await getSetting(tokenKey(p))) as string | null;
		tokens[p] = !!(raw && decrypt(raw));
	}
	return json({ tokens });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const { provider, token } = await request.json();
		if (!SUPPORTED_PROVIDERS.includes(provider)) {
			return json({ error: 'Unsupported provider' }, { status: 400 });
		}
		if (!token || typeof token !== 'string') {
			return json({ error: 'Token is required' }, { status: 400 });
		}
		await setSetting(tokenKey(provider as Provider), encrypt(token));
		return json({ success: true });
	} catch (err) {
		console.error('[API/settings/providers] Failed to save token:', err);
		return json({ error: 'Failed to save token' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const { provider } = await request.json();
		if (!SUPPORTED_PROVIDERS.includes(provider)) {
			return json({ error: 'Unsupported provider' }, { status: 400 });
		}
		await setSetting(tokenKey(provider as Provider), null);
		return json({ success: true });
	} catch (err) {
		console.error('[API/settings/providers] Failed to delete token:', err);
		return json({ error: 'Failed to delete token' }, { status: 500 });
	}
};
