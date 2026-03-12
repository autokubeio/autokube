import type { AuthSetting } from '$lib/server/db/schema';

interface AuthSettingsState {
	settings: AuthSetting | null;
	loading: boolean;
	error: string | null;
}

const state = $state<AuthSettingsState>({
	settings: null,
	loading: false,
	error: null
});

async function loadSettings() {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/auth-settings');
		if (!res.ok) throw new Error('Failed to load auth settings');
		state.settings = await res.json();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to load settings';
		console.error('[Auth Settings] Load error:', err);
	} finally {
		state.loading = false;
	}
}

async function updateSettings(patch: Partial<AuthSetting>) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/auth-settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) throw new Error('Failed to update auth settings');
		state.settings = await res.json();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to update settings';
		console.error('[Auth Settings] Update error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

export function authSettingsStore() {
	return {
		get settings() {
			return state.settings;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		loadSettings,
		updateSettings
	};
}
