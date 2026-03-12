import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scryptSync, timingSafeEqual, randomUUID, randomBytes } from 'crypto';
import { findUserByUsername, insertUser } from '$lib/server/queries/users';
import { createSession } from '$lib/server/queries/sessions';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { listLdapProviders } from '$lib/server/queries/ldap';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authenticateLdapUser } from '$lib/server/services/ldap-auth';

function verifyPassword(plain: string, stored: string): boolean {
	// SSO-only accounts cannot login via password
	if (stored.startsWith('sso:')) return false;
	const parts = stored.split(':');
	if (parts.length !== 2) return false;
	const [salt, storedHash] = parts;
	try {
		const hash = scryptSync(plain, salt, 32).toString('hex');
		return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
	} catch {
		return false;
	}
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const config = await loadAuthConfig();
		if (!config.authEnabled) {
			return json({ error: 'Authentication is not enabled' }, { status: 400 });
		}

		const body = await request.json();
		const { username, password, provider: providerHint } = body as {
			username?: string;
			password?: string;
			/** Optional: 'local' | 'ldap' | number (ldap provider id) */
			provider?: string | number;
		};

		if (!username || !password) {
			return json({ error: 'Username and password are required' }, { status: 400 });
		}

		// ── LDAP login ──────────────────────────────────────────────────────
		const isLdapHint =
			providerHint === 'ldap' || typeof providerHint === 'number';

		if (isLdapHint || config.defaultProvider === 'ldap') {
			const ldapProviders = await listLdapProviders();
			// Use specified provider id, or first enabled LDAP provider
			const ldap =
				typeof providerHint === 'number'
					? ldapProviders.find((p) => p.id === providerHint && p.enabled)
					: ldapProviders.find((p) => p.enabled);

			if (ldap) {
				const result = await authenticateLdapUser(ldap, username, String(password));
				if (!result.success) {
					await logAuditEvent({
						username,
						action: 'login',
						entityType: 'user',
						description: `Failed LDAP login attempt for "${username}"`,
						ipAddress: getClientAddress(),
						userAgent: request.headers.get('user-agent') ?? null
					});
					return json({ error: result.error ?? 'Invalid username or password' }, { status: 401 });
				}

				// Auto-provision the local user on first LDAP login
				let localUser = await findUserByUsername(username);
				if (!localUser) {
					await insertUser({
						username,
						email: result.user?.email,
						displayName: result.user?.displayName ?? username,
						passwordHash: `sso:${randomBytes(16).toString('hex')}`,
						authProvider: 'ldap'
					});
					localUser = await findUserByUsername(username);
				}

				if (!localUser?.isActive) {
					return json({ error: 'Account is inactive' }, { status: 401 });
				}

				const sessionId = randomUUID();
				const timeout = config.sessionTimeout ?? 86400;
				const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();
				await createSession(sessionId, localUser.id, 'ldap', expiresAt);

				await logAuditEvent({
					username: localUser.username,
					action: 'login',
					entityType: 'user',
					entityId: String(localUser.id),
					entityName: localUser.username,
					description: `User "${localUser.username}" logged in via LDAP (${ldap.name})`,
					ipAddress: getClientAddress(),
					userAgent: request.headers.get('user-agent') ?? null
				});

				cookies.set('session_id', sessionId, {
					httpOnly: true,
					sameSite: 'lax',
					path: '/',
					expires: new Date(expiresAt)
				});

				return json({
					user: {
						id: localUser.id,
						username: localUser.username,
						displayName: localUser.displayName,
						email: localUser.email
					}
				});
			}
		}

		// ── Local login ─────────────────────────────────────────────────────
		const user = await findUserByUsername(username);
		if (!user || !user.isActive) {
			// Constant-time response to prevent user enumeration
			return json({ error: 'Invalid username or password' }, { status: 401 });
		}

		if (!verifyPassword(password, user.passwordHash)) {
			await logAuditEvent({
				username: user.username,
				action: 'login',
				entityType: 'user',
				entityId: String(user.id),
				entityName: user.username,
				description: `Failed login attempt for "${user.username}"`,
				ipAddress: getClientAddress(),
				userAgent: request.headers.get('user-agent') ?? null
			});
			return json({ error: 'Invalid username or password' }, { status: 401 });
		}

		// Create session
		const sessionId = randomUUID();
		const timeout = config.sessionTimeout ?? 86400;
		const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();

		await createSession(sessionId, user.id, 'local', expiresAt);

		await logAuditEvent({
			username: user.username,
			action: 'login',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `User "${user.username}" logged in`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		cookies.set('session_id', sessionId, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(expiresAt)
		});

		return json({
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				email: user.email
			}
		});
	} catch (error) {
		console.error('[API] Login error:', error);
		return json({ error: 'Login failed' }, { status: 500 });
	}
};
