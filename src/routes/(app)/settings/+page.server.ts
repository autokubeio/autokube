import type { PageServerLoad } from './$types';
import { authorize } from '$lib/server/services/authorize';

export const load: PageServerLoad = async ({ cookies }) => {
	const auth = await authorize(cookies);

	const [canSettings, canUsers, canClusters, canNotifications, canLicense] = await Promise.all([
		auth.can('settings', 'read'),
		auth.can('users', 'read'),
		auth.can('clusters', 'read'),
		auth.can('notifications', 'read'),
		auth.can('license', 'read')
	]);

	return {
		canManageAuth: canSettings || canUsers,
		canManageLicense: canLicense,
		canManageClusters: canClusters,
		canManageNotifications: canNotifications,
		canManageGeneral: canSettings,
		canManageSshKeys: canSettings,
		canManageAi: canSettings,
		canManageDangerZone: canSettings
	};
};
