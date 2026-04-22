import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	findLdapProvider,
	patchLdapProvider,
	destroyLdapProvider
} from '$lib/server/queries/ldap';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';
import { isEnterpriseEnabled } from '$lib/server/services/license';

const licenseRequired = () =>
	json({ error: 'Business License required', upgrade: 'https://autokube.io/pricing' }, { status: 402 });

export const GET: RequestHandler = async ({ params, cookies }) => {
	if (!(await isEnterpriseEnabled())) return licenseRequired();
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const provider = await findLdapProvider(Number(params.id));
	if (!provider) return json({ error: 'Not found' }, { status: 404 });
	return json({ ...provider, bindPassword: provider.bindPassword ? '••••••••' : null });
};

export const PATCH: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	if (!(await isEnterpriseEnabled())) return licenseRequired();
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		// If password is the masked placeholder, remove from patch so we don't overwrite
		if (body.bindPassword === '••••••••') delete body.bindPassword;

		const updated = await patchLdapProvider(Number(params.id), body);
		if (!updated) return json({ error: 'Not found' }, { status: 404 });

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'ldap_config',
			entityId: params.id,
			entityName: updated.name,
			description: `Updated LDAP provider "${updated.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ ...updated, bindPassword: updated.bindPassword ? '••••••••' : null });
	} catch (err) {
		console.error('[API] Failed to update LDAP provider:', err);
		return json({ error: 'Failed to update LDAP provider' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, cookies, getClientAddress, request }) => {
	if (!(await isEnterpriseEnabled())) return licenseRequired();
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const provider = await findLdapProvider(Number(params.id));
		if (!provider) return json({ error: 'Not found' }, { status: 404 });

		await destroyLdapProvider(Number(params.id));

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'ldap_config',
			entityId: params.id,
			entityName: provider.name,
			description: `Deleted LDAP provider "${provider.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete LDAP provider:', err);
		return json({ error: 'Failed to delete LDAP provider' }, { status: 500 });
	}
};
