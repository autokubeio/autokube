import type { LayoutServerLoad } from './$types';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { getSession } from '$lib/server/queries/sessions';
import { findUser } from '$lib/server/queries/users';

export const load: LayoutServerLoad = async ({ cookies }) => {
	try {
		// Load auth configuration
		const authConfig = await loadAuthConfig();
		const authEnabled = authConfig?.authEnabled ?? false;

		// If auth is disabled, return no user data
		if (!authEnabled) {
			return {
				authEnabled: false,
				user: null
			};
		}

		// Check for session
		const sessionId = cookies.get('session_id');
		if (!sessionId) {
			return {
				authEnabled: true,
				user: null
			};
		}

		// Validate session
		const session = await getSession(sessionId);
		if (!session || new Date(session.expiresAt) < new Date()) {
			return {
				authEnabled: true,
				user: null
			};
		}

		// Load user data
		const user = await findUser(session.userId);
		if (!user || !user.isActive) {
			return {
				authEnabled: true,
				user: null
			};
		}

		// Return safe user data (without password)
		return {
			authEnabled: true,
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				email: user.email,
				isActive: user.isActive
			}
		};
	} catch (error) {
		console.error('[Layout] Failed to load user session:', error);
		return {
			authEnabled: false,
			user: null
		};
	}
};
