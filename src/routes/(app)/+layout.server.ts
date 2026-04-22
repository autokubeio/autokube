import type { LayoutServerLoad } from './$types';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { getSession } from '$lib/server/queries/sessions';
import { findUser } from '$lib/server/queries/users';
import { authorize } from '$lib/server/services/authorize';

export const load: LayoutServerLoad = async ({ cookies }) => {
	try {
		// Load auth configuration
		const authConfig = await loadAuthConfig();
		const authEnabled = authConfig?.authEnabled ?? false;

		// If auth is disabled, return no user data — all access is open
		if (!authEnabled) {
			return {
				authEnabled: false,
				user: null,
				permissions: null
			};
		}

		// Check for session
		const sessionId = cookies.get('session_id');
		if (!sessionId) {
			return { authEnabled: true, user: null, permissions: null };
		}

		// Validate session
		const session = await getSession(sessionId);
		if (!session || new Date(session.expiresAt) < new Date()) {
			return { authEnabled: true, user: null, permissions: null };
		}

		// Load user data
		const user = await findUser(session.userId);
		if (!user || !user.isActive) {
			return { authEnabled: true, user: null, permissions: null };
		}

		// Check all page-level permissions in parallel
		const auth = await authorize(cookies);
		const resources = [
			'clusters', 'audit_logs', 'activity', 'image_scans',
			'pods', 'deployments', 'jobs', 'services', 'ingress',
			'config', 'volumes', 'nodes', 'namespaces', 'events',
			'access_control', 'custom_resources',
			'settings', 'notifications', 'license'
		] as const;

		const results = await Promise.all(resources.map((r) => auth.can(r, 'read')));
		const permissions = Object.fromEntries(resources.map((r, i) => [r, results[i]])) as Record<string, boolean>;

		return {
			authEnabled: true,
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				email: user.email,
				isActive: user.isActive
			},
			permissions
		};
	} catch (error) {
		console.error('[Layout] Failed to load user session:', error);
		return { authEnabled: false, user: null, permissions: null };
	}
};
