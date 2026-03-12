/** LDAP provider CRUD — directory config with encrypted bind credentials. */

import { db, eq, asc, ldapConfig } from '../db';
import { encrypt, decrypt } from '../helpers';

// ── Types ───────────────────────────────────────────────────────────────────

/** Single LDAP-group → app-role mapping. */
export interface LdapRoleMapping {
	groupDn: string;
	roleId: number;
}

/** Hydrated LDAP row with decrypted secrets and parsed JSON. */
export interface ResolvedLdap {
	id: number;
	name: string;
	enabled: boolean;
	serverUrl: string;
	bindDn?: string | null;
	bindPassword?: string | null;
	baseDn: string;
	userFilter: string;
	usernameAttribute: string;
	emailAttribute: string;
	displayNameAttribute: string;
	groupBaseDn?: string | null;
	groupFilter?: string | null;
	adminGroup?: string | null;
	roleMappings?: LdapRoleMapping[] | null;
	tlsEnabled: boolean;
	tlsCa?: string | null;
	createdAt: string;
	updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Decrypt secrets and deserialise JSON on a raw row. */
function mapLdapRow(raw: typeof ldapConfig.$inferSelect): ResolvedLdap {
	return {
		...raw,
		bindPassword: decrypt(raw.bindPassword),
		roleMappings: raw.roleMappings ? (JSON.parse(raw.roleMappings) as LdapRoleMapping[]) : null
	} as ResolvedLdap;
}

/** Keys that accept `null` when the caller passes an empty/undefined value. */
const NULLABLE: ReadonlySet<string> = new Set([
	'bindDn',
	'bindPassword',
	'groupBaseDn',
	'groupFilter',
	'adminGroup',
	'tlsCa'
]);

// ── Queries ─────────────────────────────────────────────────────────────────

/** List every LDAP provider, sorted by name. */
export async function listLdapProviders(): Promise<ResolvedLdap[]> {
	const rows = await db.select().from(ldapConfig).orderBy(asc(ldapConfig.name));
	return rows.map(mapLdapRow);
}

/** Fetch a single LDAP provider by id. */
export async function findLdapProvider(id: number): Promise<ResolvedLdap | null> {
	const [row] = await db.select().from(ldapConfig).where(eq(ldapConfig.id, id));
	return row ? mapLdapRow(row) : null;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Insert a new LDAP provider. Throws on read-back failure. */
export async function insertLdapProvider(
	input: Omit<ResolvedLdap, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ResolvedLdap> {
	const [inserted] = await db
		.insert(ldapConfig)
		.values({
			name: input.name,
			enabled: input.enabled,
			serverUrl: input.serverUrl,
			bindDn: input.bindDn ?? null,
			bindPassword: encrypt(input.bindPassword) ?? null,
			baseDn: input.baseDn,
			userFilter: input.userFilter,
			usernameAttribute: input.usernameAttribute,
			emailAttribute: input.emailAttribute,
			displayNameAttribute: input.displayNameAttribute,
			groupBaseDn: input.groupBaseDn ?? null,
			groupFilter: input.groupFilter ?? null,
			adminGroup: input.adminGroup ?? null,
			roleMappings: input.roleMappings ? JSON.stringify(input.roleMappings) : null,
			tlsEnabled: input.tlsEnabled,
			tlsCa: input.tlsCa ?? null
		})
		.returning();

	const created = await findLdapProvider(inserted.id);
	if (!created) throw new Error(`Failed to read back LDAP provider ${inserted.id}`);
	return created;
}

/** Patch an LDAP provider. Only supplied keys are written. */
export async function patchLdapProvider(
	id: number,
	patch: Partial<ResolvedLdap>
): Promise<ResolvedLdap | null> {
	const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	for (const [key, val] of Object.entries(patch)) {
		if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;

		if (key === 'bindPassword') {
			fields.bindPassword = encrypt(val as string | null | undefined) ?? null;
		} else if (key === 'roleMappings') {
			fields.roleMappings = val ? JSON.stringify(val) : null;
		} else if (NULLABLE.has(key)) {
			fields[key] = val || null;
		} else {
			fields[key] = val;
		}
	}

	await db.update(ldapConfig).set(fields).where(eq(ldapConfig.id, id));
	return findLdapProvider(id);
}

/** Remove an LDAP provider by id. */
export async function destroyLdapProvider(id: number): Promise<void> {
	await db.delete(ldapConfig).where(eq(ldapConfig.id, id));
}
