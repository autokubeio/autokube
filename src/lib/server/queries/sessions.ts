/** Session CRUD — create, lookup, and cleanup operations for user sessions. */

import { db, eq, sql, sessions, type Session } from '../db';

// ── Queries ────────────────────────────────────────────────────────────────

/** Fetch a session by ID, or `null` if it doesn't exist. */
export async function getSession(id: string): Promise<Session | null> {
	const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
	return row ?? null;
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Insert a new session and return the full row. */
export async function createSession(
	id: string,
	userId: number,
	provider: string,
	expiresAt: string
): Promise<Session> {
	await db.insert(sessions).values({ id, userId, provider, expiresAt });
	const created = await getSession(id);
	if (!created) throw new Error(`[Sessions] Failed to read back session ${id} after insert`);
	return created;
}

/** Remove a single session. Returns `true` when the delete statement executes. */
export async function deleteSession(id: string): Promise<boolean> {
	await db.delete(sessions).where(eq(sessions.id, id));
	return true;
}

/** Purge all sessions whose `expiresAt` is in the past. Returns the number of rows removed. */
export async function deleteExpiredSessions(): Promise<number> {
	const now = new Date().toISOString();
	const result = await db
		.delete(sessions)
		.where(sql`expires_at < ${now}`)
		.returning();
	return result.length;
}
