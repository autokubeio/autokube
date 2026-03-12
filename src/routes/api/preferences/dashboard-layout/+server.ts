import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/services/authorize';
import {
	getDashboardLayout,
	upsertDashboardLayout,
	getPreference,
	setPreference
} from '$lib/server/queries/preferences';

/** GET — read the saved dashboard layout for the current user. */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	try {
		const userId = auth.authEnabled ? (auth.user?.id ?? null) : null;
		const layout = await getDashboardLayout(userId);
		const activePreset = await getPreference<string | null>({
			userId, clusterId: null, key: 'dashboard_active_preset'
		});

		return json({ layout, activePreset });
	} catch (error) {
		console.error('[DashboardLayout] GET failed:', error);
		return json({ error: 'Failed to load dashboard layout' }, { status: 500 });
	}
};

/** PUT — persist the dashboard layout (tiles + activePreset). */
export const PUT: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const { tiles, activePreset } = body as {
			tiles?: { id: number; x: number; y: number; w: number; h: number }[];
			activePreset?: string | null;
		};

		if (!tiles || !Array.isArray(tiles)) {
			return json({ error: 'tiles array is required' }, { status: 400 });
		}

		// Basic validation
		for (const t of tiles) {
			if (typeof t.id !== 'number' || typeof t.x !== 'number' || typeof t.y !== 'number' ||
				typeof t.w !== 'number' || typeof t.h !== 'number') {
				return json({ error: 'Each tile must have numeric id, x, y, w, h' }, { status: 400 });
			}
		}

		const userId = auth.authEnabled ? (auth.user?.id ?? null) : null;
		const saved = await upsertDashboardLayout({ userId, tiles });

		// Save activePreset as a separate preference
		if (activePreset !== undefined) {
			await setPreference(
				{ userId, clusterId: null, key: 'dashboard_active_preset' },
				activePreset
			);
		}

		return json({ layout: saved, activePreset });
	} catch (error) {
		console.error('[DashboardLayout] PUT failed:', error);
		return json({ error: 'Failed to save dashboard layout' }, { status: 500 });
	}
};
