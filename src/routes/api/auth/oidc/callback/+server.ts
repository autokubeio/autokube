/**
 * GET /api/auth/oidc/callback
 * Handles the redirect back from the OIDC provider.
 * Validates state, exchanges code for tokens, upserts the user, creates session.
 */
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findOidcProvider } from '$lib/server/queries/oidc';
import { completeOidcFlow, parseOidcState } from '$lib/server/services/oidc-auth';
import { findUserByUsername, insertUser } from '$lib/server/queries/users';
import { createSession } from '$lib/server/queries/sessions';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { logAuditEvent } from '$lib/server/queries/audit';
import { randomUUID, randomBytes } from 'crypto';

export const GET: RequestHandler = async ({ url, cookies, getClientAddress, request }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');

	if (errorParam) {
		console.error('[OIDC Callback] Provider error:', errorParam, url.searchParams.get('error_description'));
		throw redirect(302, `/login?error=${encodeURIComponent(errorParam)}`);
	}

	if (!code || !state) {
		throw redirect(302, '/login?error=missing_params');
	}

	// Validate CSRF state
	const savedState = cookies.get('oidc_state');
	if (!savedState || savedState !== state) {
		console.error('[OIDC Callback] State mismatch');
		throw redirect(302, '/login?error=state_mismatch');
	}
	cookies.delete('oidc_state', { path: '/' });

	const { providerId, valid } = parseOidcState(state);
	if (!valid) {
		throw redirect(302, '/login?error=invalid_state');
	}

	const provider = await findOidcProvider(providerId);
	if (!provider || !provider.enabled) {
		throw redirect(302, '/login?error=provider_not_found');
	}

	// Mirror the same redirect_uri fallback used in the initiation route
	const effectiveProvider = provider.redirectUri
		? provider
		: { ...provider, redirectUri: `${url.origin}/api/auth/oidc/callback` };

	const result = await completeOidcFlow(effectiveProvider, code);
	if (!result.success || !result.user) {
		console.error('[OIDC Callback] Flow failed:', result.error);
		throw redirect(302, `/login?error=${encodeURIComponent(result.error ?? 'oidc_failed')}`);
	}

	const { user: oidcUser } = result;

	// Find or auto-provision the local user record
	let localUser = await findUserByUsername(oidcUser.username);
	if (!localUser) {
		// Auto-provision user on first SSO login
		await insertUser({
			username: oidcUser.username,
			email: oidcUser.email ?? undefined,
			displayName: oidcUser.displayName ?? oidcUser.username,
			// Unusable password for SSO-only users
			passwordHash: `sso:${randomBytes(16).toString('hex')}`,
			authProvider: 'oidc'
		});
		localUser = await findUserByUsername(oidcUser.username);
	}

	if (!localUser?.isActive) {
		throw redirect(302, '/login?error=account_inactive');
	}

	// Create session
	const config = await loadAuthConfig();
	const sessionId = randomUUID();
	const timeout = config.sessionTimeout ?? 86400;
	const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();

	await createSession(sessionId, localUser.id, 'oidc', expiresAt);

	await logAuditEvent({
		username: localUser.username,
		action: 'login',
		entityType: 'user',
		entityId: String(localUser.id),
		entityName: localUser.username,
		description: `User "${localUser.username}" logged in via OIDC (${provider.name})`,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent') ?? null
	});

	cookies.set('session_id', sessionId, {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		expires: new Date(expiresAt)
	});

	throw redirect(302, '/');
};
