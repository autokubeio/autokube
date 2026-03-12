import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scryptSync, randomBytes } from 'crypto';
import { findUser, patchUser, destroyUser } from '$lib/server/queries/users';
import { grantRole, revokeRole, listAssignments } from '$lib/server/queries/roles';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function hashPassword(plain: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(plain, salt, 32).toString('hex');
	return `${salt}:${hash}`;
}

export const PATCH: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('users', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const userId = Number(params.id);
		const body = await request.json();

		const existing = await findUser(userId);
		if (!existing) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		const patch: Record<string, unknown> = {};
		if (body.username !== undefined) patch.username = body.username;
		if (body.email !== undefined) patch.email = body.email;
		if (body.displayName !== undefined) patch.displayName = body.displayName;
		if (body.isActive !== undefined) patch.isActive = body.isActive;
		if (body.password) patch.passwordHash = hashPassword(body.password);

		const updated = await patchUser(userId, patch);

		// Handle role change
		if (body.roleId !== undefined) {
			const assignments = await listAssignments(userId);
			// Revoke all existing global (non-cluster) roles
			for (const a of assignments) {
				if (!a.clusterId) {
					await revokeRole(userId, a.roleId);
				}
			}
			// Grant new role if provided
			if (body.roleId !== null) {
				await grantRole(userId, Number(body.roleId));
			}
		}

		await logAuditEvent({
			username: 'system',
			action: 'update',
			entityType: 'user',
			entityId: params.id,
			entityName: existing.username,
			description: `Updated user "${existing.username}"`,
			details: { ...body, password: undefined },
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(updated);
	} catch (error) {
		console.error('[API] Failed to update user:', error);
		return json({ error: 'Failed to update user' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('users', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const userId = Number(params.id);

		const existing = await findUser(userId);
		if (!existing) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		await destroyUser(userId);

		await logAuditEvent({
			username: 'system',
			action: 'delete',
			entityType: 'user',
			entityId: params.id,
			entityName: existing.username,
			description: `Deleted user "${existing.username}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ message: `User ${params.id} deleted` });
	} catch (error) {
		console.error('[API] Failed to delete user:', error);
		return json({ error: 'Failed to delete user' }, { status: 500 });
	}
};
