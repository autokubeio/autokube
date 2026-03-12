import type { Cookies } from '@sveltejs/kit';
import {
	isAdmin as checkIsAdmin,
	canAccessCluster as checkCanAccessCluster,
	reachableClusters,
	listAssignments,
	type PermissionMap,
	getSession,
	findUser,
	loadAuthConfig,
	getSetting
} from '../queries';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
	id: number;
	username: string;
	email: string | null;
	displayName: string | null;
	avatar: string | null;
	authProvider: string | null;
	isAdmin: boolean;
}

export interface AuthorizationContext {
	/** Whether authentication is enabled globally */
	authEnabled: boolean;

	/** Whether the request is authenticated (has valid session) */
	isAuthenticated: boolean;

	/** The authenticated user, if any */
	user: AuthenticatedUser | null;

	/** Whether the user has admin privileges */
	isAdmin: boolean;

	/** Whether an enterprise license is active */
	isEnterprise: boolean;

	/**
	 * Check if the user has a specific permission.
	 * In free edition: all authenticated users have full access.
	 * In enterprise edition: checks RBAC permissions from user roles.
	 */
	can: (resource: string, action: string, clusterId?: number) => Promise<boolean>;

	/**
	 * Check if user can access a specific cluster.
	 * In free edition: all authenticated users have full access.
	 * In enterprise edition: checks cluster-scoped RBAC permissions.
	 */
	canAccessCluster: (clusterId: number) => Promise<boolean>;

	/**
	 * Get list of cluster IDs the user can access.
	 * Returns null if user has access to ALL clusters.
	 * Returns empty array if user has no access.
	 */
	getAccessibleClusterIds: () => Promise<number[] | null>;

	/**
	 * Check if user can manage other users.
	 * Returns true if:
	 * - Auth is disabled (initial setup)
	 * - User is admin
	 * - Free edition (all users have full access)
	 */
	canManageUsers: () => Promise<boolean>;

	/**
	 * Check if user can manage settings.
	 * Returns true if:
	 * - Auth is disabled (initial setup)
	 * - User is authenticated (free edition gives full access)
	 */
	canManageSettings: () => Promise<boolean>;

	/**
	 * Check if user can view audit logs.
	 * Available in all editions (can be restricted to enterprise in future).
	 * In free edition: all authenticated users can view.
	 * In enterprise edition: checks RBAC audit_logs permission.
	 */
	canViewAuditLog: () => Promise<boolean>;
}

// ── Session Management ──────────────────────────────────────────────────────

const SESSION_COOKIE_NAME = 'session_id';

/**
 * Extract session ID from request cookies.
 */
function getSessionId(cookies: Cookies): string | null {
	return cookies.get(SESSION_COOKIE_NAME) ?? null;
}

/**
 * Validate session and return user data.
 */
async function validateSession(cookies: Cookies): Promise<AuthenticatedUser | null> {
	const sessionId = getSessionId(cookies);
	if (!sessionId) return null;

	const session = await getSession(sessionId);
	if (!session) return null;

	// Check if session is expired
	const now = new Date();
	const expiresAt = new Date(session.expiresAt);
	if (expiresAt < now) return null;

	// Fetch user data
	const user = await findUser(session.userId);
	if (!user || !user.isActive) return null;

	// Check if user has Admin role
	const isAdmin = await checkIsAdmin(user.id);

	return {
		id: user.id,
		username: user.username,
		email: user.email,
		displayName: user.displayName,
		avatar: user.avatar,
		authProvider: user.authProvider,
		isAdmin
	};
}

// ── Configuration Checks ────────────────────────────────────────────────────

/**
 * Check if authentication is enabled.
 * Reads from the auth_settings table.
 */
async function isAuthEnabled(): Promise<boolean> {
	try {
		const config = await loadAuthConfig();
		return config.authEnabled ?? false;
	} catch {
		// If auth_settings is not initialized, default to false
		return false;
	}
}

/**
 * Check if enterprise license is active.
 * Reads 'enterprise_license_active' setting from database.
 * Future enhancement: Add license expiry date validation.
 */
async function isEnterprise(): Promise<boolean> {
	try {
		const licenseActive = await getSetting('enterprise_license_active');
		return licenseActive === true || licenseActive === 'true';
	} catch {
		return false;
	}
}

// ── Permission Checking ─────────────────────────────────────────────────────

/**
 * Check if a role applies to a specific cluster.
 */
function roleAppliesToCluster(roleClusterIds: number[] | null, clusterId: number): boolean {
	return roleClusterIds === null || roleClusterIds.includes(clusterId);
}

/**
 * Check if a user has a specific permission.
 * Checks all roles assigned to the user and returns true if any role grants the permission.
 * If clusterId is provided, only checks roles that apply to that cluster.
 */
async function checkPermission(
	userId: number,
	resource: keyof PermissionMap,
	action: string,
	clusterId?: number
): Promise<boolean> {
	const assignments = await listAssignments(userId);

	for (const assignment of assignments) {
		if (!assignment.role) continue;

		// Check cluster scope if specified
		if (clusterId !== undefined && !roleAppliesToCluster(assignment.role.clusterIds, clusterId)) {
			continue;
		}

		// Check if role has the required permission
		const permissions = assignment.role.permissions[resource];
		if (permissions?.includes(action)) {
			return true;
		}
	}

	return false;
}

/**
 * Helper to check if user has full access (bypass RBAC).
 * Returns true if: auth disabled, user is admin, or free edition.
 */
function hasBypassAccess(authEnabled: boolean, isAdmin: boolean, isEnterprise: boolean): boolean {
	if (!authEnabled) return true;
	if (isAdmin) return true;
	if (!isEnterprise) return true;
	return false;
}

/**
 * Helper to check basic authentication requirements.
 * Returns error if not authenticated, null if authenticated.
 */
function checkAuthentication(
	authEnabled: boolean,
	user: AuthenticatedUser | null
): 'unauthenticated' | null {
	if (!authEnabled) return null; // Auth disabled = allow all
	if (!user) return 'unauthenticated';
	return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create an authorization context for the current request.
 * This is the main entry point for authorization checks.
 */
export async function authorize(cookies: Cookies): Promise<AuthorizationContext> {
	const authEnabled = await isAuthEnabled();
	const enterprise = await isEnterprise();
	const user = authEnabled ? await validateSession(cookies) : null;

	// In free edition, all authenticated users have full access
	const isAdmin = user?.isAdmin ?? false;

	const ctx: AuthorizationContext = {
		authEnabled,
		isAuthenticated: !!user,
		user,
		isAdmin,
		isEnterprise: enterprise,

		async can(resource: string, action: string, clusterId?: number): Promise<boolean> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return false;

			// Check if user has bypass access (admin or free edition)
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return true;

			// Enterprise edition: check RBAC permissions
			return checkPermission(user!.id, resource as keyof PermissionMap, action, clusterId);
		},

		async canAccessCluster(clusterId: number): Promise<boolean> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return false;

			// Check if user has bypass access
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return true;

			// Enterprise edition: check cluster-level RBAC
			return checkCanAccessCluster(user!.id, clusterId);
		},

		async getAccessibleClusterIds(): Promise<number[] | null> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return [];

			// Bypass access means all clusters (null)
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return null;

			// Enterprise edition: get user's accessible clusters
			return reachableClusters(user!.id);
		},

		async canManageUsers(): Promise<boolean> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return false;

			// Check if user has bypass access
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return true;

			// Enterprise edition: check RBAC
			return checkPermission(user!.id, 'users', 'create');
		},

		async canManageSettings(): Promise<boolean> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return false;

			// Check if user has bypass access
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return true;

			// Enterprise edition: check RBAC
			return checkPermission(user!.id, 'settings', 'edit');
		},

		async canViewAuditLog(): Promise<boolean> {
			const authError = checkAuthentication(authEnabled, user);
			if (authError === 'unauthenticated') return false;

			// Check if user has bypass access
			if (hasBypassAccess(authEnabled, isAdmin, enterprise)) return true;

			// Enterprise edition: check RBAC
			return checkPermission(user!.id, 'audit_logs', 'view');
		}
	};

	return ctx;
}

// ── Response Helper ─────────────────────────────────────────────────────────

/**
 * Helper to create a standard 401 response data
 */
export function unauthorized() {
	return { error: 'Authentication required', status: 401 };
}

/**
 * Helper to create a standard 403 response data
 */
export function forbidden(reason: string = 'Permission denied') {
	return { error: reason, status: 403 };
}

/**
 * Helper to create enterprise required response data
 */
export function enterpriseRequired() {
	return { error: 'Enterprise license required', status: 403 };
}
