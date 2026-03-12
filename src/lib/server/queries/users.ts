/** User CRUD — accounts, admin checks, and session cleanup. */

import { db, eq, asc, users, roles, userRoles, sessions, type User } from '../db';

// ── Queries ─────────────────────────────────────────────────────────────────

/** Fetch all users ordered by username. */
export async function listUsers(): Promise<User[]> {
	return db.select().from(users).orderBy(asc(users.username));
}

/** Fetch a single user by id. */
export async function findUser(id: number): Promise<User | null> {
	const [row] = await db.select().from(users).where(eq(users.id, id));
	return row ?? null;
}

/** Fetch a single user by exact username. */
export async function findUserByUsername(handle: string): Promise<User | null> {
	const [row] = await db.select().from(users).where(eq(users.username, handle));
	return row ?? null;
}

/** True when at least one user holds the "Admin" role (single-join query). */
export async function adminExists(): Promise<boolean> {
	const [hit] = await db
		.select({ id: userRoles.id })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(roles.name, 'Admin'))
		.limit(1);

	return !!hit;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Insert a new user and return the hydrated row. Throws on read-back failure. */
export async function insertUser(input: {
	username: string;
	email?: string;
	passwordHash: string;
	displayName?: string;
	authProvider?: string;
}): Promise<User> {
	const [inserted] = await db
		.insert(users)
		.values({
			username: input.username,
			email: input.email ?? null,
			passwordHash: input.passwordHash,
			displayName: input.displayName ?? null,
			authProvider: input.authProvider ?? 'local'
		})
		.returning();

	const hydrated = await findUser(inserted.id);
	if (!hydrated) throw new Error(`Failed to read back user ${inserted.id}`);
	return hydrated;
}

/** Patch user fields. Only supplied keys are written; timestamps update automatically. */
export async function patchUser(id: number, patch: Partial<User>): Promise<User | null> {
	const allowed: (keyof User)[] = [
		'username',
		'email',
		'passwordHash',
		'displayName',
		'avatar',
		'authProvider',
		'mfaEnabled',
		'mfaSecret',
		'isActive',
		'lastLogin'
	];

	const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	for (const key of allowed) {
		if (patch[key] !== undefined) {
			fields[key] = patch[key] ?? null;
		}
	}

	await db.update(users).set(fields).where(eq(users.id, id));
	return findUser(id);
}

/** Remove a user by id. */
export async function destroyUser(id: number): Promise<void> {
	await db.delete(users).where(eq(users.id, id));
}

/** Purge all sessions belonging to a user. Returns the number of deleted rows. */
export async function purgeUserSessions(userId: number): Promise<number> {
	const deleted = await db.delete(sessions).where(eq(sessions.userId, userId)).returning();
	return deleted.length;
}
