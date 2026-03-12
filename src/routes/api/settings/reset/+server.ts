import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { authorize } from '$lib/server/services/authorize';
import {
	clusters,
	users,
	roles,
	sessions,
	authSettings,
	sshKeys,
	notificationSettings,
	clusterNotifications,
	settings,
	auditLogs,
	provisionedClusters,
	provisionedClusterLogs,
	hostMetrics,
	userPreferences
} from '$lib/server/db/schema';

export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		// Delete all data from all tables
		await db.delete(auditLogs);
		await db.delete(clusterNotifications);
		await db.delete(notificationSettings);
		await db.delete(sshKeys);
		await db.delete(sessions);
		await db.delete(users);
		await db.delete(roles);
		await db.delete(authSettings);
		await db.delete(provisionedClusterLogs);
		await db.delete(provisionedClusters);
		await db.delete(clusters);
		await db.delete(hostMetrics);
		await db.delete(userPreferences);
		await db.delete(settings);

		return json({ success: true });
	} catch (err) {
		console.error('[API] Clear all data error:', err);
		return json({ error: 'Failed to clear all application data' }, { status: 500 });
	}
};
