import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SmtpConfig, AppriseConfig } from '$lib/server/queries/notifications';
import { sendTestSmtp, sendTestApprise } from '$lib/server/services/notify';
import { authorize } from '$lib/server/services/authorize';

/** Convert flat form body → typed config (same logic as the create/update routes). */
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

/** POST /api/notifications/test — send a live test using the provided form config. */
export const POST: RequestHandler = async ({ request, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const type = body.type === 'apprise' ? 'apprise' : 'smtp';
		const config = bodyToConfig(type, body);

		if (type === 'smtp') {
			await sendTestSmtp(config as SmtpConfig);
		} else {
			await sendTestApprise(config as AppriseConfig);
		}

		return json({ ok: true, message: 'Test notification sent successfully.' });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[API] Notification test failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
