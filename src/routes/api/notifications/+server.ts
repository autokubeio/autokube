import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listChannels, insertChannel } from '$lib/server/queries/notifications';
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

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const channels = await listChannels();
		return json({ channels, total: channels.length });
	} catch (error) {
		console.error('[API] Failed to list notification channels:', error);
		return json({ error: 'Failed to list channels' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'create')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as Record<string, unknown>;

		if (!body.name) {
			return json({ error: 'Name is required' }, { status: 400 });
		}
		const type = body.type === 'apprise' ? 'apprise' : 'smtp';

		const channel = await insertChannel({
			type,
			name: String(body.name),
			enabled: body.enabled !== false,
			config: bodyToConfig(type, body),
			eventTypes: body.eventTypes as NotificationEventType[] | undefined
		});

		await logAuditEvent({
			username: 'system',
			action: 'create',
			entityType: 'notification',
			entityId: String(channel.id),
			entityName: channel.name,
			description: `Created notification channel "${channel.name}" (${type})`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(channel, { status: 201 });
	} catch (error) {
		console.error('[API] Failed to create notification channel:', error);
		return json({ error: 'Failed to create channel' }, { status: 500 });
	}
};
