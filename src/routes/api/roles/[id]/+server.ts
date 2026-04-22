import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findRole, patchRole, destroyRole } from '$lib/server/queries/roles';
import { db, eq } from '$lib/server/db';
import { userRoles } from '$lib/server/db/schema';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';
import { isPaidLicenseEnabled } from '$lib/server/services/license';

const licenseRequired = () =>
	json({ error: 'Business License required', upgrade: 'https://autokube.io/pricing' }, { status: 402 });

export const PATCH: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	if (!(await isPaidLicenseEnabled())) return licenseRequired();
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const roleId = Number(params.id);
		const body = await request.json();

		const existing = await findRole(roleId);
		if (!existing) {
			return json({ error: 'Role not found' }, { status: 404 });
		}
		if (existing.isSystem) {
			return json({ error: 'Cannot modify system roles' }, { status: 403 });
		}

		const updated = await patchRole(roleId, body);
		if (!updated) {
			return json({ error: 'Failed to update role' }, { status: 500 });
		}

		const countRows = await db
			.select({ roleId: userRoles.roleId })
			.from(userRoles)
			.where(eq(userRoles.roleId, roleId));

		await logAuditEvent({
			username: 'system',
			action: 'update',
			entityType: 'settings',
			entityId: params.id,
			entityName: existing.name,
			description: `Updated role "${existing.name}"`,
			details: body,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ ...updated, userCount: countRows.length });
	} catch (error) {
		console.error('[API] Failed to update role:', error);
		return json({ error: 'Failed to update role' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	if (!(await isPaidLicenseEnabled())) return licenseRequired();
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const roleId = Number(params.id);

		const existing = await findRole(roleId);
		if (!existing) {
			return json({ error: 'Role not found' }, { status: 404 });
		}

		const deleted = await destroyRole(roleId);
		if (!deleted) {
			return json({ error: 'Cannot delete system role' }, { status: 403 });
		}

		await logAuditEvent({
			username: 'system',
			action: 'delete',
			entityType: 'settings',
			entityId: params.id,
			entityName: existing.name,
			description: `Deleted role "${existing.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ message: `Role ${params.id} deleted` });
	} catch (error) {
		console.error('[API] Failed to delete role:', error);
		return json({ error: 'Failed to delete role' }, { status: 500 });
	}
};
