/** RBAC — role CRUD, user–role assignments, and cluster-scoped access checks. */

import { db, eq, and, asc, isNull, roles, userRoles, type Role } from '../db';

// ── Types ───────────────────────────────────────────────────────────────────

/** Per-resource permission lists stored as JSON in the `roles.permissions` column. */
export interface PermissionMap {
	/* ── System ─────────────────────────────── */
	settings: string[];
	users: string[];
	clusters: string[];
	audit_logs: string[];
	notifications: string[];
	license: string[];
	activity: string[];

	/* ── Cluster / Kubernetes ───────────────── */
	pods: string[];
	deployments: string[];
	jobs: string[];
	services: string[];
	ingress: string[];
	config: string[];
	volumes: string[];
	nodes: string[];
	namespaces: string[];
	events: string[];
	access_control: string[];
	custom_resources: string[];
	image_scans: string[];

	/** Index signature for forward-compat with future resources. */
	[resource: string]: string[];
}

/** A role row with its JSON columns already deserialised. */
export interface ResolvedRole {
	id: number;
	name: string;
	description?: string | null;
	isSystem: boolean;
	permissions: PermissionMap;
	clusterIds: number[] | null;
	createdAt: string;
	updatedAt: string;
}

/** A user↔role link, optionally carrying the resolved role. */
export interface RoleAssignment {
	id: number;
	userId: number;
	roleId: number;
	clusterId?: number | null;
	createdAt: string;
	role?: ResolvedRole;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/** Deserialise a raw `roles` row into a `ResolvedRole`. */
function mapRoleRow(raw: Role): ResolvedRole {
	return {
		...raw,
		isSystem: raw.isSystem ?? false,
		createdAt: raw.createdAt ?? '',
		updatedAt: raw.updatedAt ?? '',
		permissions: JSON.parse(raw.permissions) as PermissionMap,
		clusterIds: raw.clusterIds ? (JSON.parse(raw.clusterIds) as number[]) : null
	};
}

/** Safely parse a JSON `clusterIds` string → `number[]`. Returns `null` on failure (= "all clusters"). */
function parseScopes(raw: string | null): number[] | null {
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as number[];
	} catch {
		return null;
	}
}

/** Check whether a parsed scope list grants access to `targetId`. */
function scopeCovers(scopes: number[] | null, targetId: number): boolean {
	return scopes === null || scopes.includes(targetId);
}

/** Standard join-projection reused by `listAssignments` and `listAssignmentsForCluster`. */
const ASSIGNMENT_COLS = {
	id: userRoles.id,
	userId: userRoles.userId,
	roleId: userRoles.roleId,
	clusterId: userRoles.clusterId,
	createdAt: userRoles.createdAt,
	roleName: roles.name,
	roleDesc: roles.description,
	roleSystem: roles.isSystem,
	rolePerms: roles.permissions,
	roleScopes: roles.clusterIds
} as const;

/** Map a joined row into a `RoleAssignment` with an embedded `ResolvedRole`. */
function toAssignment(row: Record<string, unknown>): RoleAssignment {
	const r = row as { [K in keyof typeof ASSIGNMENT_COLS]: string | number | boolean | null };
	return {
		id: r.id as number,
		userId: r.userId as number,
		roleId: r.roleId as number,
		clusterId: r.clusterId as number | null,
		createdAt: r.createdAt as string,
		role: {
			id: r.roleId as number,
			name: r.roleName as string,
			description: r.roleDesc as string | null,
			isSystem: r.roleSystem as boolean,
			permissions: JSON.parse(r.rolePerms as string) as PermissionMap,
			clusterIds: parseScopes(r.roleScopes as string | null),
			createdAt: r.createdAt as string,
			updatedAt: r.createdAt as string
		}
	};
}

// ── Role CRUD ───────────────────────────────────────────────────────────────

/** Fetch all roles ordered by name. */
export async function listRoles(): Promise<ResolvedRole[]> {
	const rows = await db.select().from(roles).orderBy(asc(roles.name));
	return rows.map(mapRoleRow);
}

/** Fetch a single role by id. */
export async function findRole(id: number): Promise<ResolvedRole | null> {
	const [row] = await db.select().from(roles).where(eq(roles.id, id));
	return row ? mapRoleRow(row) : null;
}

/** Fetch a single role by exact name. */
export async function findRoleByName(name: string): Promise<ResolvedRole | null> {
	const [row] = await db.select().from(roles).where(eq(roles.name, name));
	return row ? mapRoleRow(row) : null;
}

/** Insert a new custom role and return the hydrated result. */
export async function insertRole(input: {
	name: string;
	description?: string;
	permissions: PermissionMap;
	clusterIds?: number[] | null;
}): Promise<ResolvedRole> {
	const [inserted] = await db
		.insert(roles)
		.values({
			name: input.name,
			description: input.description ?? null,
			isSystem: false,
			permissions: JSON.stringify(input.permissions),
			clusterIds: input.clusterIds ? JSON.stringify(input.clusterIds) : null
		})
		.returning();

	const hydrated = await findRole(inserted.id);
	if (!hydrated) throw new Error(`Failed to read back role ${inserted.id}`);
	return hydrated;
}

/** Patch a non-system role. Returns `null` if the role is missing or system-protected. */
export async function patchRole(
	id: number,
	patch: Partial<ResolvedRole>
): Promise<ResolvedRole | null> {
	const existing = await findRole(id);
	if (!existing || existing.isSystem) return null;

	const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	if (patch.name !== undefined) fields.name = patch.name;
	if (patch.description !== undefined) fields.description = patch.description ?? null;
	if (patch.permissions !== undefined) fields.permissions = JSON.stringify(patch.permissions);
	if (patch.clusterIds !== undefined)
		fields.clusterIds = patch.clusterIds ? JSON.stringify(patch.clusterIds) : null;

	await db.update(roles).set(fields).where(eq(roles.id, id));
	return findRole(id);
}

/** Delete a non-system role. Returns `false` when blocked or missing. */
export async function destroyRole(id: number): Promise<boolean> {
	const existing = await findRole(id);
	if (!existing || existing.isSystem) return false;

	await db.delete(roles).where(and(eq(roles.id, id), eq(roles.isSystem, false)));
	return true;
}

// ── User–Role Assignments ───────────────────────────────────────────────────

/** List every role assigned to a user (with embedded role details). */
export async function listAssignments(userId: number): Promise<RoleAssignment[]> {
	const rows = await db
		.select(ASSIGNMENT_COLS)
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(userRoles.userId, userId));

	return rows.map(toAssignment);
}

/** Assign a role to a user, optionally scoped to a cluster. Idempotent (conflicts are ignored). */
export async function grantRole(
	userId: number,
	roleId: number,
	clusterId?: number
): Promise<RoleAssignment> {
	await db
		.insert(userRoles)
		.values({ userId, roleId, clusterId: clusterId ?? null })
		.onConflictDoNothing();

	const [row] = await db
		.select()
		.from(userRoles)
		.where(
			and(
				eq(userRoles.userId, userId),
				eq(userRoles.roleId, roleId),
				clusterId ? eq(userRoles.clusterId, clusterId) : isNull(userRoles.clusterId)
			)
		);

	return row as RoleAssignment;
}

/** Revoke a role from a user. */
export async function revokeRole(
	userId: number,
	roleId: number,
	clusterId?: number
): Promise<void> {
	await db
		.delete(userRoles)
		.where(
			and(
				eq(userRoles.userId, userId),
				eq(userRoles.roleId, roleId),
				clusterId ? eq(userRoles.clusterId, clusterId) : isNull(userRoles.clusterId)
			)
		);
}

// ── Access Checks ───────────────────────────────────────────────────────────

/** Authoritative admin check — true when the user holds the "Admin" role. */
export async function isAdmin(userId: number): Promise<boolean> {
	const [hit] = await db
		.select({ id: roles.id })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(and(eq(userRoles.userId, userId), eq(roles.name, 'Admin')))
		.limit(1);

	return !!hit;
}

/**
 * Collect all cluster IDs a user may access.
 * Returns `null` when **any** role grants unrestricted (all-cluster) access.
 * Returns a de-duplicated `number[]` otherwise (may be empty).
 */
export async function reachableClusters(userId: number): Promise<number[] | null> {
	const rows = await db
		.select({ scopes: roles.clusterIds })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(userRoles.userId, userId));

	const merged: number[] = [];

	for (const { scopes } of rows) {
		const parsed = parseScopes(scopes);
		if (parsed === null) return null;
		merged.push(...parsed);
	}

	return [...new Set(merged)];
}

/**
 * List roles assigned to a user that apply to a given cluster.
 * A role applies when its `clusterIds` is `null` (global) or includes `clusterId`.
 */
export async function listAssignmentsForCluster(
	userId: number,
	clusterId: number
): Promise<RoleAssignment[]> {
	const rows = await db
		.select(ASSIGNMENT_COLS)
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(userRoles.userId, userId));

	return rows.filter((r) => scopeCovers(parseScopes(r.roleScopes), clusterId)).map(toAssignment);
}

/** Quick boolean — does the user hold **any** role that covers `clusterId`? */
export async function canAccessCluster(userId: number, clusterId: number): Promise<boolean> {
	const rows = await db
		.select({ scopes: roles.clusterIds })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(userRoles.userId, userId));

	return rows.some(({ scopes }) => scopeCovers(parseScopes(scopes), clusterId));
}
