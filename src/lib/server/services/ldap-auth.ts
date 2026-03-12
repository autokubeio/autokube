/**
 * LDAP authentication service.
 * Supports bind-based user authentication against any LDAP-compatible directory
 * (Active Directory, OpenLDAP, FreeIPA, etc.).
 */

import { Client, Attribute } from 'ldapts';
import type { ResolvedLdap, LdapRoleMapping } from '$lib/server/queries/ldap';

export interface LdapAuthResult {
	success: boolean;
	error?: string;
	user?: {
		username: string;
		email?: string;
		displayName?: string;
		groups: string[];
		/** Raw DN of the authenticated entry */
		dn: string;
		/** Role IDs mapped from LDAP groups, if any */
		roleIds: number[];
	};
}

export interface LdapTestResult {
	success: boolean;
	message: string;
	userCount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildClient(cfg: ResolvedLdap): Client {
	const url = new URL(cfg.serverUrl);
	return new Client({
		url: cfg.serverUrl,
		tlsOptions: cfg.tlsEnabled
			? {
					ca: cfg.tlsCa ? [Buffer.from(cfg.tlsCa)] : undefined,
					rejectUnauthorized: true
				}
			: undefined,
		timeout: 8000,
		connectTimeout: 6000
	});
}

/** Resolve the actual user DN from a userFilter search, if bindDn is configured. */
async function findUserDn(
	client: Client,
	cfg: ResolvedLdap,
	username: string
): Promise<string | null> {
	// Support both {username} (UI placeholder) and {{username}} (legacy) as substitution tokens
	const rawFilter = cfg.userFilter ?? '(uid={username})';
	const filter = rawFilter.replace(/\{\{username\}\}/g, username).replace(/\{username\}/g, username);
	const { searchEntries } = await client.search(cfg.baseDn, {
		scope: 'sub',
		filter,
		attributes: ['dn'],
		sizeLimit: 1
	});
	return searchEntries[0]?.dn ?? null;
}

/** Fetch user attributes + group memberships after a successful bind. */
async function fetchUserAttributes(
	client: Client,
	cfg: ResolvedLdap,
	userDn: string,
	username: string
): Promise<{
	email?: string;
	displayName?: string;
	groups: string[];
}> {
	const attrs = [
		cfg.emailAttribute ?? 'mail',
		cfg.displayNameAttribute ?? 'cn',
		'memberOf',
		'isMemberOf'
	];
	const { searchEntries } = await client.search(cfg.baseDn, {
		scope: 'sub',
		filter: `(${cfg.usernameAttribute ?? 'uid'}=${username})`,
		attributes: attrs,
		sizeLimit: 1
	});

	const entry = searchEntries[0];
	if (!entry) return { groups: [] };

	const str = (v: unknown) => (Array.isArray(v) ? String(v[0]) : String(v ?? '')) || undefined;
	const arr = (v: unknown): string[] =>
		Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];

	return {
		email: str(entry[cfg.emailAttribute ?? 'mail']),
		displayName: str(entry[cfg.displayNameAttribute ?? 'cn']),
		groups: [...arr(entry['memberOf']), ...arr(entry['isMemberOf'])]
	};
}

/** Map LDAP group DNs to app role IDs via the roleMappings config. */
function mapGroupsToRoles(groups: string[], mappings: LdapRoleMapping[] | null | undefined): number[] {
	if (!mappings?.length) return [];
	const groupSet = new Set(groups.map((g) => g.toLowerCase()));
	return mappings
		.filter((m) => groupSet.has(m.groupDn.toLowerCase()))
		.map((m) => m.roleId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Authenticate a user against an LDAP directory.
 *
 * Strategy (works for both AD and POSIX directories):
 * 1. If bindDn+bindPassword are configured → admin bind, search for userDn, then user bind.
 * 2. Otherwise → try direct bind using `uid=username,baseDn` pattern.
 */
export async function authenticateLdapUser(
	cfg: ResolvedLdap,
	username: string,
	password: string
): Promise<LdapAuthResult> {
	const client = buildClient(cfg);

	try {
		let userDn: string;

		if (cfg.bindDn && cfg.bindPassword) {
			// Admin bind → search for user DN
			try {
				await client.bind(cfg.bindDn, cfg.bindPassword);
			} catch {
				return { success: false, error: 'LDAP admin bind failed — check bind DN and password' };
			}
			const found = await findUserDn(client, cfg, username);
			if (!found) {
				return { success: false, error: 'User not found in directory' };
			}
			userDn = found;
		} else {
			// Direct bind — construct DN from username + baseDn
			const usernameAttr = cfg.usernameAttribute ?? 'uid';
			userDn = `${usernameAttr}=${username},${cfg.baseDn}`;
		}

		// Attempt user bind with the supplied password
		try {
			await client.bind(userDn, password);
		} catch {
			return { success: false, error: 'Invalid username or password' };
		}

		// Rebind as admin before fetching attributes so ACLs don't block the search
		if (cfg.bindDn && cfg.bindPassword) {
			await client.bind(cfg.bindDn, cfg.bindPassword).catch(() => {});
		}

		// Fetch user attributes
		const { email, displayName, groups } = await fetchUserAttributes(client, cfg, userDn, username);
		const roleIds = mapGroupsToRoles(groups, cfg.roleMappings);

		// Check adminGroup membership
		if (cfg.adminGroup) {
			const adminDn = cfg.adminGroup.toLowerCase();
			const isAdmin = groups.some((g) => g.toLowerCase() === adminDn || g.toLowerCase().startsWith(`cn=${adminDn.split(',')[0]}`));
			if (isAdmin && !roleIds.includes(1)) roleIds.unshift(1);
		}

		return {
			success: true,
			user: { username, email, displayName, groups, dn: userDn, roleIds }
		};
	} catch (err) {
		console.error('[LDAP] Authentication error:', err);
		return {
			success: false,
			error: err instanceof Error ? err.message : 'LDAP connection failed'
		};
	} finally {
		await client.unbind().catch(() => {});
	}
}

/**
 * Test LDAP server connectivity and admin bind (if configured).
 * Does NOT verify user credentials.
 */
export async function testLdapConnection(cfg: ResolvedLdap): Promise<LdapTestResult> {
	const client = buildClient(cfg);
	try {
		if (cfg.bindDn && cfg.bindPassword) {
			await client.bind(cfg.bindDn, cfg.bindPassword);
			// Try a quick search to verify baseDn — strip username placeholder to make a valid wildcard filter
			const rawFilter = cfg.userFilter ?? '(uid={username})';
			const testFilter = rawFilter
				.replace(/\{\{username\}\}/g, '*')
				.replace(/\{username\}/g, '*');
			const { searchEntries } = await client.search(cfg.baseDn, {
				scope: 'sub',
				filter: testFilter,
				attributes: ['dn'],
				sizeLimit: 5
			});
			return {
				success: true,
				message: 'Connection successful — admin bind OK',
				userCount: searchEntries.length
			};
		}

		return { success: true, message: 'Connection successful (anonymous bind)' };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { success: false, message: `Connection failed: ${msg}` };
	} finally {
		await client.unbind().catch(() => {});
	}
}
