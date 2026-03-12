import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listLdapProviders,
	insertLdapProvider,
	type ResolvedLdap
} from '$lib/server/queries/ldap';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const providers = await listLdapProviders();
		// Strip bind passwords before sending to client
		return json(
			providers.map((p) => ({
				...p,
				bindPassword: p.bindPassword ? '••••••••' : null
			}))
		);
	} catch (err) {
		console.error('[API] Failed to list LDAP providers:', err);
		return json({ error: 'Failed to load LDAP providers' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as Omit<ResolvedLdap, 'id' | 'createdAt' | 'updatedAt'>;
		const provider = await insertLdapProvider(body);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'ldap_config',
			entityId: String(provider.id),
			entityName: provider.name,
			description: `Created LDAP provider "${provider.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ ...provider, bindPassword: provider.bindPassword ? '••••••••' : null });
	} catch (err) {
		console.error('[API] Failed to create LDAP provider:', err);
		return json({ error: 'Failed to create LDAP provider' }, { status: 500 });
	}
};
