const ENDPOINT = '/api/preferences/sidebar-pinned';
const SAVE_DEBOUNCE_MS = 300;
export const MAX_PINNED = 5;

let items = $state<string[]>([]);
let loaded = $state(false);
let loading = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function load() {
	if (loaded || loading || typeof fetch === 'undefined') return;
	loading = true;
	try {
		const res = await fetch(ENDPOINT);
		if (!res.ok) return;
		const data = (await res.json()) as { items?: unknown };
		if (Array.isArray(data.items)) {
			items = data.items.filter((v): v is string => typeof v === 'string').slice(0, MAX_PINNED);
		}
		loaded = true;
	} catch (err) {
		console.error('[pinnedItemsStore] load failed:', err);
	} finally {
		loading = false;
	}
}

function persist() {
	if (typeof fetch === 'undefined') return;
	clearTimeout(saveTimer);
	const snapshot = [...items];
	saveTimer = setTimeout(async () => {
		try {
			await fetch(ENDPOINT, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: snapshot })
			});
		} catch (err) {
			console.error('[pinnedItemsStore] save failed:', err);
		}
	}, SAVE_DEBOUNCE_MS);
}

export const pinnedItemsStore = {
	get items() {
		return items;
	},
	get loaded() {
		return loaded;
	},
	/** Fetch the latest pinned list from the server. Idempotent — only the first call hits the API. */
	async hydrate() {
		await load();
	},
	isPinned(href: string): boolean {
		return items.includes(href);
	},
	canPinMore(): boolean {
		return items.length < MAX_PINNED;
	},
	/**
	 * Toggle pin state for an href, optimistically; persists asynchronously.
	 * Returns:
	 *   - 'pinned'   — added to the list
	 *   - 'unpinned' — removed from the list
	 *   - 'limit'    — rejected because the pin limit was reached
	 */
	toggle(href: string): 'pinned' | 'unpinned' | 'limit' {
		const idx = items.indexOf(href);
		if (idx >= 0) {
			items = [...items.slice(0, idx), ...items.slice(idx + 1)];
			persist();
			return 'unpinned';
		}
		if (items.length >= MAX_PINNED) return 'limit';
		items = [...items, href];
		persist();
		return 'pinned';
	},
	unpin(href: string) {
		const idx = items.indexOf(href);
		if (idx < 0) return;
		items = [...items.slice(0, idx), ...items.slice(idx + 1)];
		persist();
	}
};
