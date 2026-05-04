import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/services/authorize';
import { getPreference, setPreference } from '$lib/server/queries/preferences';

const KEY = 'sidebar_pinned';
const MAX_PINNED = 5;

/** GET — read the current user's pinned sidebar items. */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	try {
		const userId = auth.authEnabled ? (auth.user?.id ?? null) : null;
		const items = (await getPreference<string[]>({ userId, clusterId: null, key: KEY })) ?? [];
		return json({ items });
	} catch (error) {
		console.error('[SidebarPinned] GET failed:', error);
		return json({ error: 'Failed to load pinned items' }, { status: 500 });
	}
};

/** PUT — replace the current user's pinned sidebar items. */
export const PUT: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const items = (body as { items?: unknown }).items;

		if (!Array.isArray(items) || !items.every((v): v is string => typeof v === 'string')) {
			return json({ error: 'items must be an array of strings' }, { status: 400 });
		}
		if (items.length > MAX_PINNED) {
			return json({ error: `At most ${MAX_PINNED} pinned items allowed` }, { status: 400 });
		}

		const userId = auth.authEnabled ? (auth.user?.id ?? null) : null;
		await setPreference({ userId, clusterId: null, key: KEY }, items);
		return json({ items });
	} catch (error) {
		console.error('[SidebarPinned] PUT failed:', error);
		return json({ error: 'Failed to save pinned items' }, { status: 500 });
	}
};
