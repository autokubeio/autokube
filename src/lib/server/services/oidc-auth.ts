/**
 * OIDC authentication service — implements Authorization Code Flow.
 * Uses only fetch() so no extra runtime dependencies are needed.
 */

import type { ResolvedOidc, OidcRoleMapping } from '$lib/server/queries/oidc';
import { randomBytes } from 'crypto';

export interface OidcDiscovery {
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
	jwks_uri: string;
	issuer: string;
}

export interface OidcTokenSet {
	access_token: string;
	id_token?: string;
	token_type: string;
	expires_in?: number;
}

export interface OidcUserInfo {
	sub: string;
	email?: string;
	name?: string;
	preferred_username?: string;
	[claim: string]: unknown;
}

export interface OidcAuthResult {
	success: boolean;
	error?: string;
	user?: {
		sub: string;
		username: string;
		email?: string;
		displayName?: string;
		isAdmin: boolean;
		roleIds: number[];
		/** Provider name for session metadata */
		provider: string;
	};
}

// ── Discovery ─────────────────────────────────────────────────────────────────

const discoveryCache = new Map<string, { doc: OidcDiscovery; fetchedAt: number }>();

export async function fetchDiscovery(issuerUrl: string): Promise<OidcDiscovery> {
	const cached = discoveryCache.get(issuerUrl);
	if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached.doc;

	const url = issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
	const res = await fetch(url);
	if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
	const doc = (await res.json()) as OidcDiscovery;
	discoveryCache.set(issuerUrl, { doc, fetchedAt: Date.now() });
	return doc;
}

// ── Authorization URL ─────────────────────────────────────────────────────────

export interface OidcAuthUrlOptions {
	state: string;
	nonce?: string;
}

export async function buildAuthorizationUrl(
	cfg: ResolvedOidc,
	opts: OidcAuthUrlOptions
): Promise<string> {
	const discovery = await fetchDiscovery(cfg.issuerUrl);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: cfg.clientId,
		redirect_uri: cfg.redirectUri,
		scope: cfg.scopes ?? 'openid profile email',
		state: opts.state
	});
	if (opts.nonce) params.set('nonce', opts.nonce);
	return `${discovery.authorization_endpoint}?${params.toString()}`;
}

// ── Token Exchange ─────────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(
	cfg: ResolvedOidc,
	code: string
): Promise<OidcTokenSet> {
	const discovery = await fetchDiscovery(cfg.issuerUrl);
	const res = await fetch(discovery.token_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: cfg.redirectUri,
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret
		}).toString()
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token exchange failed: ${res.status} ${text}`);
	}
	return (await res.json()) as OidcTokenSet;
}

// ── UserInfo ──────────────────────────────────────────────────────────────────

export async function fetchUserInfo(
	cfg: ResolvedOidc,
	accessToken: string
): Promise<OidcUserInfo> {
	const discovery = await fetchDiscovery(cfg.issuerUrl);
	if (!discovery.userinfo_endpoint) {
		throw new Error('Provider does not expose a userinfo endpoint');
	}
	const res = await fetch(discovery.userinfo_endpoint, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok) throw new Error(`UserInfo fetch failed: ${res.status}`);
	return (await res.json()) as OidcUserInfo;
}

/** Decode the payload of a JWT without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> {
	try {
		const [, payload] = token.split('.');
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return {};
	}
}

// ── Role Mapping ──────────────────────────────────────────────────────────────

function mapClaimsToRoles(
	claims: Record<string, unknown>,
	cfg: ResolvedOidc
): { isAdmin: boolean; roleIds: number[] } {
	const mappings: OidcRoleMapping[] = cfg.roleMappings ?? [];
	const claimKey = cfg.roleMappingsClaim ?? 'groups';
	const raw = claims[claimKey];
	const claimValues: string[] = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];

	const roleIds = mappings
		.filter((m) => claimValues.includes(m.claimValue))
		.map((m) => m.roleId);

	let isAdmin = false;
	if (cfg.adminClaim && cfg.adminValue) {
		const adminRaw = claims[cfg.adminClaim];
		const adminValues = Array.isArray(adminRaw) ? adminRaw.map(String) : adminRaw ? [String(adminRaw)] : [];
		isAdmin = adminValues.includes(cfg.adminValue);
	}

	return { isAdmin, roleIds };
}

// ── Main Callback Handler ─────────────────────────────────────────────────────

/**
 * Complete the OIDC flow after the provider redirects back with a code.
 * Returns resolved user info and mapped roles.
 */
export async function completeOidcFlow(
	cfg: ResolvedOidc,
	code: string
): Promise<OidcAuthResult> {
	try {
		const tokens = await exchangeCodeForTokens(cfg, code);

		// Prefer id_token claims if available, fall back to userinfo endpoint
		let claims: OidcUserInfo;
		if (tokens.id_token) {
			const payload = decodeJwtPayload(tokens.id_token) as OidcUserInfo;
			claims = payload;
		} else {
			claims = await fetchUserInfo(cfg, tokens.access_token);
		}

		// Also fetch userinfo to get groups/custom claims if id_token was present
		let fullClaims: Record<string, unknown> = { ...claims };
		try {
			const userinfo = await fetchUserInfo(cfg, tokens.access_token);
			fullClaims = { ...fullClaims, ...userinfo };
		} catch {
			// Not fatal — some providers omit userinfo_endpoint
		}

		const usernameClaim = cfg.usernameClaim ?? 'preferred_username';
		const emailClaim = cfg.emailClaim ?? 'email';
		const displayNameClaim = cfg.displayNameClaim ?? 'name';

		const username =
			String(fullClaims[usernameClaim] ?? fullClaims['preferred_username'] ?? fullClaims['sub'] ?? '');
		if (!username) return { success: false, error: 'Could not determine username from claims' };

		const { isAdmin, roleIds } = mapClaimsToRoles(fullClaims, cfg);

		return {
			success: true,
			user: {
				sub: String(fullClaims['sub'] ?? ''),
				username,
				email: fullClaims[emailClaim] ? String(fullClaims[emailClaim]) : undefined,
				displayName: fullClaims[displayNameClaim] ? String(fullClaims[displayNameClaim]) : undefined,
				isAdmin,
				roleIds,
				provider: cfg.name
			}
		};
	} catch (err) {
		console.error('[OIDC] Flow error:', err);
		return {
			success: false,
			error: err instanceof Error ? err.message : 'OIDC authentication failed'
		};
	}
}

/** Generate a cryptographically random state value. */
export function generateOidcState(providerId: number): string {
	const random = randomBytes(16).toString('hex');
	return `${providerId}:${random}`;
}

/** Parse provider ID from state value. */
export function parseOidcState(state: string): { providerId: number; valid: boolean } {
	const [idStr] = state.split(':');
	const providerId = Number(idStr);
	return { providerId: isNaN(providerId) ? -1 : providerId, valid: !isNaN(providerId) };
}
