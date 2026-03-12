import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRoles, insertRole } from '$lib/server/queries/roles';
import { db } from '$lib/server/db';
import { userRoles } from '$lib/server/db/schema';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

async function getRolesWithUserCount() {
	const allRoles = await listRoles();

	// Get user counts per role in one query
	const counts = await db.select({ roleId: userRoles.roleId }).from(userRoles);

	const countMap: Record<number, number> = {};
	for (const { roleId } of counts) {
		countMap[roleId] = (countMap[roleId] ?? 0) + 1;
	}

	return allRoles.map((r) => ({ ...r, userCount: countMap[r.id] ?? 0 }));
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const result = await getRolesWithUserCount();
		return json({ roles: result, total: result.length });
	} catch (error) {
		console.error('[API] Failed to list roles:', error);
		return json({ error: 'Failed to list roles' }, { status: 500 });
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

		const role = await insertRole({
			name: body.name,
			description: body.description,
			permissions: body.permissions ?? {},
			clusterIds: body.clusterIds ?? null
		});

		await logAuditEvent({
			username: 'system',
			action: 'create',
			entityType: 'settings',
			entityId: String(role.id),
			entityName: role.name,
			description: `Created role "${role.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ ...role, userCount: 0 }, { status: 201 });
	} catch (error) {
		console.error('[API] Failed to create role:', error);
		const msg = error instanceof Error ? error.message : '';
		if (msg.includes('UNIQUE')) {
			return json({ error: 'Role name already exists' }, { status: 409 });
		}
		return json({ error: 'Failed to create role' }, { status: 500 });
	}
};
