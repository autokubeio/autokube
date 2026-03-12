import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findSshKey, patchSshKey, destroySshKey } from '$lib/server/queries/ssh-keys';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params }) => {
	const row = await findSshKey(Number(params.id));

	if (!row) {
		return json({ error: 'SSH key not found' }, { status: 404 });
	}

	// Strip private key
	const { privateKey: _, ...safe } = row;
	return json(safe);
};

export const PATCH: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const body = await request.json();
	const updated = await patchSshKey(Number(params.id), body);

	if (!updated) {
		return json({ error: 'SSH key not found' }, { status: 404 });
	}

	const { privateKey: _, ...safe } = updated;

	// Strip private key from audit details
	const { privateKey: __, ...safeDetails } = body;
	const maskedDetails: Record<string, unknown> = { ...safeDetails };
	if (body.privateKey !== undefined) maskedDetails.privateKey = '***';

	await logAuditEvent({
		username: 'system',
		action: 'update',
		entityType: 'ssh_key',
		entityId: params.id,
		entityName: updated.name,
		description: `Updated SSH key "${updated.name}"`,
		details: maskedDetails,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent') ?? null
	});

	return json(safe);
};

export const DELETE: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const existing = await findSshKey(Number(params.id));

	if (!existing) {
		return json({ error: 'SSH key not found' }, { status: 404 });
	}

	await destroySshKey(Number(params.id));

	await logAuditEvent({
		username: 'system',
		action: 'delete',
		entityType: 'ssh_key',
		entityId: params.id,
		entityName: existing.name,
		description: `Deleted SSH key "${existing.name}"`,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent') ?? null
	});

	return json({ message: `SSH key ${params.id} deleted` });
};
