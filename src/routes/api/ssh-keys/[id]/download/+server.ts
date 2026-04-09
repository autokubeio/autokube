import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findSshKey } from '$lib/server/queries/ssh-keys';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, cookies, request }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const row = await findSshKey(Number(params.id));
	if (!row) {
		return json({ error: 'SSH key not found' }, { status: 404 });
	}
	if (!row.privateKey) {
		return json({ error: 'No private key stored for this SSH key' }, { status: 404 });
	}

	const safeName = row.name.replace(/[^a-z0-9_-]/gi, '_');
	const filename = `${safeName}_id_${row.keyType}`;

	// Normalize line endings (CRLF → LF) and ensure a trailing newline —
	// OpenSSH rejects private key files that lack these.
	const normalized = row.privateKey.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';

	return new Response(normalized, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
