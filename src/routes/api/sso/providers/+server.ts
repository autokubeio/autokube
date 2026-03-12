/**
 * Public endpoint — returns enabled SSO providers for the login page.
 * No authentication required. Returns only non-sensitive fields (id, name, type).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listLdapProviders } from '$lib/server/queries/ldap';
import { listOidcProviders } from '$lib/server/queries/oidc';

export const GET: RequestHandler = async () => {
	try {
		const [ldapRows, oidcRows] = await Promise.all([listLdapProviders(), listOidcProviders()]);

		return json({
			ldap: ldapRows
				.filter((p) => p.enabled)
				.map((p) => ({ id: p.id, name: p.name, type: 'ldap' as const })),
			oidc: oidcRows
				.filter((p) => p.enabled)
				.map((p) => ({ id: p.id, name: p.name, type: 'oidc' as const }))
		});
	} catch (err) {
		console.error('[API] Failed to load SSO providers:', err);
		// Return empty lists on error — login page degrades gracefully
		return json({ ldap: [], oidc: [] });
	}
};
