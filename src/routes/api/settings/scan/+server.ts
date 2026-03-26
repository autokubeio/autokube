import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import {
	getScanScheduleCron,
	setScanScheduleCron,
	getScanConcurrency,
	setScanConcurrency
} from '$lib/server/queries/settings';
import { listScanSchedules, upsertScanSchedule } from '$lib/server/queries/image-scans';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const [cronExpression, concurrency] = await Promise.all([
		getScanScheduleCron(),
		getScanConcurrency()
	]);

	return json({ cronExpression, concurrency });
};

export const PATCH: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'edit'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();

		if (body.cronExpression !== undefined) {
			const cron = String(body.cronExpression);
			await setScanScheduleCron(cron);
			// Sync all per-cluster schedules to the new global cron
			const allSchedules = await listScanSchedules();
			for (const schedule of allSchedules) {
				await upsertScanSchedule({
					clusterId: schedule.clusterId,
					enabled: schedule.enabled ?? true,
					cronExpression: cron,
					namespaces: schedule.namespaces,
					lastRunAt: schedule.lastRunAt,
					nextRunAt: schedule.nextRunAt
				});
			}
		}

		if (body.concurrency !== undefined) {
			await setScanConcurrency(Number(body.concurrency));
		}

		const [cronExpression, concurrency] = await Promise.all([
			getScanScheduleCron(),
			getScanConcurrency()
		]);

		return json({ cronExpression, concurrency });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update scan settings';
		return json({ error: message }, { status: 400 });
	}
};
