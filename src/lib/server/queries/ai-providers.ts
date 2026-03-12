/**
 * AI Provider Operations
 * Database operations for managing AI provider credentials
 */

import { db, eq, asc, aiProviders, type AiProvider, type NewAiProvider } from '../db';
import { encrypt, decrypt } from '../helpers';

// ── Types ────────────────────────────────────────────────────────────────────

export type SafeAiProvider = Omit<AiProvider, 'apiKey'> & { hasApiKey: boolean };

// ── Helpers ──────────────────────────────────────────────────────────────────

function toSafe(row: AiProvider): SafeAiProvider {
	const { apiKey, ...rest } = row;
	return { ...rest, hasApiKey: !!apiKey };
}

function decryptRow(row: AiProvider): AiProvider {
	return { ...row, apiKey: decrypt(row.apiKey) || '' };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listAiProviders(): Promise<SafeAiProvider[]> {
	const rows = await db.select().from(aiProviders).orderBy(asc(aiProviders.createdAt));
	return rows.map(toSafe);
}

export async function getAiProviderWithKey(id: number): Promise<AiProvider | undefined> {
	const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, id));
	return row ? decryptRow(row) : undefined;
}

export async function getDefaultProvider(): Promise<AiProvider | undefined> {
	const [row] = await db
		.select()
		.from(aiProviders)
		.where(eq(aiProviders.isDefault, true))
		.limit(1);
	if (row) return decryptRow(row);
	// Fall back to first enabled provider
	const [fallback] = await db
		.select()
		.from(aiProviders)
		.where(eq(aiProviders.enabled, true))
		.limit(1);
	return fallback ? decryptRow(fallback) : undefined;
}

export async function createAiProvider(input: {
	name: string;
	provider: string;
	model: string;
	apiKey: string;
	baseUrl?: string | null;
	enabled?: boolean;
	isDefault?: boolean;
}): Promise<SafeAiProvider> {
	const encryptedKey = encrypt(input.apiKey) || input.apiKey;

	if (input.isDefault) {
		await db.update(aiProviders).set({ isDefault: false });
	}

	const [row] = await db
		.insert(aiProviders)
		.values({
			name: input.name,
			provider: input.provider,
			model: input.model,
			apiKey: encryptedKey,
			baseUrl: input.baseUrl ?? null,
			enabled: input.enabled ?? true,
			isDefault: input.isDefault ?? false
		})
		.returning();

	return toSafe(row);
}

export async function updateAiProvider(
	id: number,
	patch: Partial<{
		name: string;
		provider: string;
		model: string;
		apiKey: string;
		baseUrl: string | null;
		enabled: boolean;
		isDefault: boolean;
	}>
): Promise<SafeAiProvider | undefined> {
	const updates: Partial<NewAiProvider> = {};

	if (patch.name !== undefined) updates.name = patch.name;
	if (patch.provider !== undefined) updates.provider = patch.provider;
	if (patch.model !== undefined) updates.model = patch.model;
	if (patch.baseUrl !== undefined) updates.baseUrl = patch.baseUrl;
	if (patch.enabled !== undefined) updates.enabled = patch.enabled;
	if (patch.apiKey !== undefined) updates.apiKey = encrypt(patch.apiKey) || patch.apiKey;
	if (patch.isDefault !== undefined) {
		updates.isDefault = patch.isDefault;
		if (patch.isDefault) {
			// Clear default from all others first
			await db.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.id, id));
		}
	}

	updates.updatedAt = new Date().toISOString();

	const [row] = await db
		.update(aiProviders)
		.set(updates)
		.where(eq(aiProviders.id, id))
		.returning();

	return row ? toSafe(row) : undefined;
}

export async function deleteAiProvider(id: number): Promise<void> {
	await db.delete(aiProviders).where(eq(aiProviders.id, id));
}
