import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAiProviders, createAiProvider } from '$lib/server/queries/ai-providers';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const providers = await listAiProviders();
		return json({ providers });
	} catch (err) {
		console.error('[API] Failed to list AI providers:', err);
		return json({ error: 'Failed to list AI providers' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();

		if (!body.name) return json({ error: 'Name is required' }, { status: 400 });
		if (!body.provider) return json({ error: 'Provider is required' }, { status: 400 });
		if (!body.model) return json({ error: 'Model is required' }, { status: 400 });
		if (!body.apiKey) return json({ error: 'API key is required' }, { status: 400 });

		const provider = await createAiProvider({
			name: body.name,
			provider: body.provider,
			model: body.model,
			apiKey: body.apiKey,
			baseUrl: body.baseUrl ?? null,
			enabled: body.enabled ?? true,
			isDefault: body.isDefault ?? false
		});

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'settings',
			entityId: String(provider.id),
			entityName: provider.name,
			description: `Created AI provider "${provider.name}" (${provider.provider})`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ provider }, { status: 201 });
	} catch (err) {
		console.error('[API] Failed to create AI provider:', err);
		return json({ error: 'Failed to create AI provider' }, { status: 500 });
	}
};
