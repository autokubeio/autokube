import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	findOidcProvider,
	patchOidcProvider,
	destroyOidcProvider,
	type ResolvedOidc
} from '$lib/server/queries/oidc';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function safeOidc(p: ResolvedOidc) {
	return { ...p, clientSecret: p.clientSecret ? '••••••••' : '' };
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const provider = await findOidcProvider(Number(params.id));
	if (!provider) return json({ error: 'Not found' }, { status: 404 });
	return json(safeOidc(provider));
};

export const PATCH: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		if (body.clientSecret === '••••••••') delete body.clientSecret;

		const updated = await patchOidcProvider(Number(params.id), body);
		if (!updated) return json({ error: 'Not found' }, { status: 404 });

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'oidc_provider',
			entityId: params.id,
			entityName: updated.name,
			description: `Updated OIDC provider "${updated.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(safeOidc(updated));
	} catch (err) {
		console.error('[API] Failed to update OIDC provider:', err);
		return json({ error: 'Failed to update OIDC provider' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, cookies, getClientAddress, request }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const provider = await findOidcProvider(Number(params.id));
		if (!provider) return json({ error: 'Not found' }, { status: 404 });

		await destroyOidcProvider(Number(params.id));

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'oidc_provider',
			entityId: params.id,
			entityName: provider.name,
			description: `Deleted OIDC provider "${provider.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete OIDC provider:', err);
		return json({ error: 'Failed to delete OIDC provider' }, { status: 500 });
	}
};
