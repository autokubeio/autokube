import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChannel, patchChannel, destroyChannel } from '$lib/server/queries/notifications';
import type {
	SmtpConfig,
	AppriseConfig,
	NotificationEventType
} from '$lib/server/queries/notifications';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function bodyToConfig(type: string, body: Record<string, unknown>): SmtpConfig | AppriseConfig {
	if (type === 'smtp') {
		return {
			host: String(body.smtpHost ?? ''),
			port: Number(body.smtpPort ?? 587),
			secure: Boolean(body.smtpTls ?? false),
			username: body.smtpAuthRequired ? String(body.smtpUsername ?? '') : undefined,
			password: body.smtpAuthRequired ? String(body.smtpPassword ?? '') : undefined,
			from_email: String(body.smtpFromAddress ?? ''),
			from_name: String(body.smtpFromName ?? ''),
			to_emails: String(body.smtpTo ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		} satisfies SmtpConfig;
	}
	return { urls: [String(body.appriseUrl ?? '')] } satisfies AppriseConfig;
}

export const PATCH: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const channelId = Number(params.id);
		const body = (await request.json()) as Record<string, unknown>;

		const existing = await findChannel(channelId);
		if (!existing) {
			return json({ error: 'Channel not found' }, { status: 404 });
		}

		const patch: Parameters<typeof patchChannel>[1] = {};
		if (body.name !== undefined) patch.name = String(body.name);
		if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
		if (body.eventTypes !== undefined)
			patch.eventTypes = body.eventTypes as NotificationEventType[];

		// Update config only when relevant fields are provided
		if (
			body.smtpHost !== undefined ||
			body.appriseUrl !== undefined ||
			body.smtpTls !== undefined
		) {
			patch.config = bodyToConfig(existing.type, body);
		}

		const updated = await patchChannel(channelId, patch);

		await logAuditEvent({
			username: 'system',
			action: 'update',
			entityType: 'notification',
			entityId: params.id,
			entityName: existing.name,
			description: `Updated notification channel "${existing.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(updated);
	} catch (error) {
		console.error('[API] Failed to update notification channel:', error);
		return json({ error: 'Failed to update channel' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, params, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const channelId = Number(params.id);

		const existing = await findChannel(channelId);
		if (!existing) {
			return json({ error: 'Channel not found' }, { status: 404 });
		}

		await destroyChannel(channelId);

		await logAuditEvent({
			username: 'system',
			action: 'delete',
			entityType: 'notification',
			entityId: params.id,
			entityName: existing.name,
			description: `Deleted notification channel "${existing.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ message: `Channel ${params.id} deleted` });
	} catch (error) {
		console.error('[API] Failed to delete notification channel:', error);
		return json({ error: 'Failed to delete channel' }, { status: 500 });
	}
};
