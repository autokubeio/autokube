/** Auth settings — single-row config for global authentication behaviour. */

import { db, eq, authSettings, type AuthSetting } from '../db';

// ── Types ───────────────────────────────────────────────────────────────────

/** Allowed identity providers. */
export type AuthProvider = 'local' | 'ldap' | 'oidc';

/** Patchable fields (excludes id / timestamps). */
export interface AuthPatch {
	authEnabled?: boolean;
	defaultProvider?: AuthProvider;
	sessionTimeout?: number;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** Read the singleton auth-settings row, creating defaults if missing. */
export async function loadAuthConfig(): Promise<AuthSetting> {
	const [row] = await db.select().from(authSettings).limit(1);
	if (row) return row;

	// Auto-seed the default row if it doesn't exist yet
	await db.insert(authSettings).values({
		authEnabled: false,
		defaultProvider: 'local',
		sessionTimeout: 86400
	});
	const [seeded] = await db.select().from(authSettings).limit(1);
	if (!seeded) throw new Error('Failed to seed auth_settings');
	return seeded;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Patch the singleton auth-settings row and return the updated snapshot. */
export async function patchAuthConfig(patch: AuthPatch): Promise<AuthSetting> {
	const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	if (patch.authEnabled !== undefined) fields.authEnabled = patch.authEnabled;
	if (patch.defaultProvider !== undefined) fields.defaultProvider = patch.defaultProvider;
	if (patch.sessionTimeout !== undefined) fields.sessionTimeout = patch.sessionTimeout;

	const [existing] = await db.select({ id: authSettings.id }).from(authSettings).limit(1);
	if (existing) {
		await db.update(authSettings).set(fields).where(eq(authSettings.id, existing.id));
	}

	return loadAuthConfig();
}
