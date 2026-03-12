import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scryptSync, randomBytes } from 'crypto';
import { insertUser } from '$lib/server/queries/users';
import { grantRole, listRoles } from '$lib/server/queries/roles';
import { db, eq, asc } from '$lib/server/db';
import { users, userRoles, roles } from '$lib/server/db/schema';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function hashPassword(plain: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(plain, salt, 32).toString('hex');
	return `${salt}:${hash}`;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('users', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		// Fetch all users with their primary role in a single join
		const rows = await db
			.select({
				id: users.id,
				username: users.username,
				email: users.email,
				displayName: users.displayName,
				isActive: users.isActive,
				authProvider: users.authProvider,
				lastLogin: users.lastLogin,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
				roleId: userRoles.roleId,
				roleName: roles.name
			})
			.from(users)
			.leftJoin(userRoles, eq(users.id, userRoles.userId))
			.leftJoin(roles, eq(userRoles.roleId, roles.id))
			.orderBy(asc(users.username));

		// Deduplicate: keep first role per user
		const seen = new Set<number>();
		const result = [];
		for (const row of rows) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			result.push(row);
		}

		return json({ users: result, total: result.length });
	} catch (error) {
		console.error('[API] Failed to list users:', error);
		return json({ error: 'Failed to list users' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('users', 'create')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();

		if (!body.username) {
			return json({ error: 'Username is required' }, { status: 400 });
		}
		if (!body.password) {
			return json({ error: 'Password is required' }, { status: 400 });
		}

		const passwordHash = hashPassword(body.password);

		const user = await insertUser({
			username: body.username,
			email: body.email ?? undefined,
			passwordHash,
			displayName: body.displayName ?? body.username,
			authProvider: 'local'
		});

		// Assign role if provided
		let roleId: number | null = null;
		let roleName: string | null = null;
		if (body.roleId) {
			await grantRole(user.id, Number(body.roleId));
			const allRoles = await listRoles();
			const role = allRoles.find((r) => r.id === Number(body.roleId));
			roleId = role?.id ?? null;
			roleName = role?.name ?? null;
		}

		await logAuditEvent({
			username: 'system',
			action: 'create',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `Created user "${user.username}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ ...user, roleId, roleName }, { status: 201 });
	} catch (error) {
		console.error('[API] Failed to create user:', error);
		const msg = error instanceof Error ? error.message : 'Failed to create user';
		if (msg.includes('UNIQUE')) {
			return json({ error: 'Username already exists' }, { status: 409 });
		}
		return json({ error: 'Failed to create user' }, { status: 500 });
	}
};
