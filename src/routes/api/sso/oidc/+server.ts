import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listOidcProviders, insertOidcProvider, type ResolvedOidc } from '$lib/server/queries/oidc';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function safeOidc(p: ResolvedOidc) {
	return { ...p, clientSecret: p.clientSecret ? '••••••••' : '' };
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		return json((await listOidcProviders()).map(safeOidc));
	} catch (err) {
		console.error('[API] Failed to list OIDC providers:', err);
		return json({ error: 'Failed to load OIDC providers' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as Omit<ResolvedOidc, 'id' | 'createdAt' | 'updatedAt'>;
		const provider = await insertOidcProvider(body);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'oidc_provider',
			entityId: String(provider.id),
			entityName: provider.name,
			description: `Created OIDC provider "${provider.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(safeOidc(provider));
	} catch (err) {
		console.error('[API] Failed to create OIDC provider:', err);
		return json({ error: 'Failed to create OIDC provider' }, { status: 500 });
	}
};
