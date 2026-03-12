/** OIDC provider CRUD — OpenID Connect config with encrypted client secrets. */

import { db, eq, asc, oidcConfig } from '../db';
import { encrypt, decrypt } from '../helpers';

// ── Types ───────────────────────────────────────────────────────────────────

/** Single claim-value → app-role mapping. */
export interface OidcRoleMapping {
	claimValue: string;
	roleId: number;
}

/** Hydrated OIDC row with decrypted secrets and parsed JSON. */
export interface ResolvedOidc {
	id: number;
	name: string;
	enabled: boolean;
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes: string;
	usernameClaim: string;
	emailClaim: string;
	displayNameClaim: string;
	adminClaim?: string | null;
	adminValue?: string | null;
	roleMappingsClaim?: string | null;
	roleMappings?: OidcRoleMapping[] | null;
	createdAt: string;
	updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Decrypt secrets and deserialise JSON on a raw row. */
function mapOidcRow(raw: typeof oidcConfig.$inferSelect): ResolvedOidc {
	return {
		...raw,
		clientSecret: decrypt(raw.clientSecret) ?? '',
		roleMappings: raw.roleMappings ? (JSON.parse(raw.roleMappings) as OidcRoleMapping[]) : null
	} as ResolvedOidc;
}

/** Keys that accept `null` when the caller passes an empty/undefined value. */
const NULLABLE: ReadonlySet<string> = new Set(['adminClaim', 'adminValue']);

// ── Queries ─────────────────────────────────────────────────────────────────

/** List every OIDC provider, sorted by name. */
export async function listOidcProviders(): Promise<ResolvedOidc[]> {
	const rows = await db.select().from(oidcConfig).orderBy(asc(oidcConfig.name));
	return rows.map(mapOidcRow);
}

/** Fetch a single OIDC provider by id. */
export async function findOidcProvider(id: number): Promise<ResolvedOidc | null> {
	const [row] = await db.select().from(oidcConfig).where(eq(oidcConfig.id, id));
	return row ? mapOidcRow(row) : null;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Insert a new OIDC provider. Throws on read-back failure. */
export async function insertOidcProvider(
	input: Omit<ResolvedOidc, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ResolvedOidc> {
	const [inserted] = await db
		.insert(oidcConfig)
		.values({
			name: input.name,
			enabled: input.enabled,
			issuerUrl: input.issuerUrl,
			clientId: input.clientId,
			clientSecret: encrypt(input.clientSecret) ?? '',
			redirectUri: input.redirectUri,
			scopes: input.scopes,
			usernameClaim: input.usernameClaim,
			emailClaim: input.emailClaim,
			displayNameClaim: input.displayNameClaim,
			adminClaim: input.adminClaim ?? null,
			adminValue: input.adminValue ?? null,
			roleMappingsClaim: input.roleMappingsClaim ?? 'groups',
			roleMappings: input.roleMappings ? JSON.stringify(input.roleMappings) : null
		})
		.returning();

	const created = await findOidcProvider(inserted.id);
	if (!created) throw new Error(`Failed to read back OIDC provider ${inserted.id}`);
	return created;
}

/** Patch an OIDC provider. Only supplied keys are written. */
export async function patchOidcProvider(
	id: number,
	patch: Partial<ResolvedOidc>
): Promise<ResolvedOidc | null> {
	const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	for (const [key, val] of Object.entries(patch)) {
		if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;

		if (key === 'clientSecret') {
			fields.clientSecret = encrypt(val as string);
		} else if (key === 'roleMappings') {
			fields.roleMappings = val ? JSON.stringify(val) : null;
		} else if (key === 'roleMappingsClaim') {
			fields.roleMappingsClaim = val || 'groups';
		} else if (NULLABLE.has(key)) {
			fields[key] = val || null;
		} else {
			fields[key] = val;
		}
	}

	await db.update(oidcConfig).set(fields).where(eq(oidcConfig.id, id));
	return findOidcProvider(id);
}

/** Remove an OIDC provider by id. */
export async function destroyOidcProvider(id: number): Promise<void> {
	await db.delete(oidcConfig).where(eq(oidcConfig.id, id));
}
