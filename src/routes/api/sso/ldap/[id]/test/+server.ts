import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findLdapProvider } from '$lib/server/queries/ldap';
import { authorize } from '$lib/server/services/authorize';
import { testLdapConnection } from '$lib/server/services/ldap-auth';
import { isEnterpriseEnabled } from '$lib/server/services/license';

export const POST: RequestHandler = async ({ params, cookies }) => {
	if (!(await isEnterpriseEnabled())) {
		return json({ error: 'Business License required', upgrade: 'https://autokube.io/pricing' }, { status: 402 });
	}
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const provider = await findLdapProvider(Number(params.id));
	if (!provider) return json({ error: 'Not found' }, { status: 404 });

	const result = await testLdapConnection(provider);
	return json(result);
};
