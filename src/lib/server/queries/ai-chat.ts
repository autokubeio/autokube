/**
 * AI Chat Session & Message Queries
 * Only user/assistant text is persisted — tool_call/tool_result pairs are ephemeral.
 */

import {
	db,
	eq,
	desc,
	asc,
	aiChatSessions,
	aiChatMessages,
	type AiChatSession,
	type AiChatMessage
} from '../db';

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createChatSession(
	clusterId: number,
	title = 'New conversation'
): Promise<AiChatSession> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await db.insert(aiChatSessions).values({ id, clusterId, title });
	// Return a constructed object — DB defaults (CURRENT_TIMESTAMP) match close enough
	return { id, clusterId, title, createdAt: now, updatedAt: now };
}

export async function listChatSessions(
	clusterId: number,
	limit = 30
): Promise<AiChatSession[]> {
	return db
		.select()
		.from(aiChatSessions)
		.where(eq(aiChatSessions.clusterId, clusterId))
		.orderBy(desc(aiChatSessions.updatedAt))
		.limit(limit);
}

export async function getChatSession(id: string): Promise<AiChatSession | null> {
	const rows = await db
		.select()
		.from(aiChatSessions)
		.where(eq(aiChatSessions.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function touchSession(id: string): Promise<void> {
	await db
		.update(aiChatSessions)
		.set({ updatedAt: new Date().toISOString() })
		.where(eq(aiChatSessions.id, id));
}

export async function deleteChatSession(id: string): Promise<void> {
	await db.delete(aiChatSessions).where(eq(aiChatSessions.id, id));
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function addChatMessage(
	sessionId: string,
	role: string,
	content: string
): Promise<void> {
	await db.insert(aiChatMessages).values({ sessionId, role, content });
}

/**
 * Load the last N user+assistant messages for a session (ordered oldest-first).
 * Tool results are NOT stored here — they were ephemeral during the AI call.
 */
export async function getChatMessages(sessionId: string, limit = 20): Promise<AiChatMessage[]> {
	// Fetch last `limit` rows ordered by id DESC, then reverse for chronological display
	const rows = await db
		.select()
		.from(aiChatMessages)
		.where(eq(aiChatMessages.sessionId, sessionId))
		.orderBy(desc(aiChatMessages.id))
		.limit(limit);
	return rows.reverse();
}
