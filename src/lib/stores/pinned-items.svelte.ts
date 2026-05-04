const STORAGE_KEY = 'autokube:sidebar:pinned';
export const MAX_PINNED = 5;

let items = $state<string[]>([]);
let hydrated = false;

function hydrate() {
	if (hydrated || typeof localStorage === 'undefined') return;
	hydrated = true;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			items = parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_PINNED);
		}
	} catch {
		// ignore corrupt storage
	}
}

function persist() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
	} catch {
		// quota / private mode — ignore
	}
}

export const pinnedItemsStore = {
	get items() {
		hydrate();
		return items;
	},
	isPinned(href: string): boolean {
		hydrate();
		return items.includes(href);
	},
	canPinMore(): boolean {
		hydrate();
		return items.length < MAX_PINNED;
	},
	/**
	 * Toggle pin state for an href.
	 * Returns:
	 *   - 'pinned'   — added to the list
	 *   - 'unpinned' — removed from the list
	 *   - 'limit'    — rejected because the pin limit was reached
	 */
	toggle(href: string): 'pinned' | 'unpinned' | 'limit' {
		hydrate();
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
		hydrate();
		const idx = items.indexOf(href);
		if (idx < 0) return;
		items = [...items.slice(0, idx), ...items.slice(idx + 1)];
		persist();
	}
};
