/**
 * GET /api/auth/oidc/[id]
 * Redirects the browser to the OIDC provider's authorization endpoint.
 */
import { redirect, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findOidcProvider } from '$lib/server/queries/oidc';
import { buildAuthorizationUrl, generateOidcState } from '$lib/server/services/oidc-auth';

export const GET: RequestHandler = async ({ params, cookies, url: reqUrl }) => {
	const provider = await findOidcProvider(Number(params.id));
	if (!provider || !provider.enabled) {
		throw redirect(302, '/login?error=provider_not_found');
	}

	// Fall back to the canonical callback URL derived from the current origin
	// if the admin left redirectUri blank in the settings.
	const effectiveProvider = provider.redirectUri
		? provider
		: { ...provider, redirectUri: `${reqUrl.origin}/api/auth/oidc/callback` };

	const state = generateOidcState(provider.id);
	// Store state in a short-lived cookie for CSRF validation on callback
	cookies.set('oidc_state', state, {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: 600 // 10 minutes
	});

	try {
		const url = await buildAuthorizationUrl(effectiveProvider, { state });
		throw redirect(302, url);
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('[OIDC] Failed to build authorization URL:', err);
		throw redirect(302, '/login?error=oidc_error');
	}
};
