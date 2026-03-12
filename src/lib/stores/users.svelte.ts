import type { User } from '$lib/server/db/schema';

interface UserWithRole extends User {
	roleId: number | null;
	roleName: string | null;
}

interface UsersState {
	users: UserWithRole[];
	loading: boolean;
	error: string | null;
}

const state = $state<UsersState>({
	users: [],
	loading: false,
	error: null
});

async function loadUsers() {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/users');
		if (!res.ok) throw new Error('Failed to load users');
		const data = await res.json();
		state.users = data.users;
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to load users';
		console.error('[Users] Load error:', err);
	} finally {
		state.loading = false;
	}
}

async function createUser(input: {
	username: string;
	password: string;
	email?: string;
	displayName?: string;
	roleId?: number;
}) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error || 'Failed to create user');
		}
		await loadUsers();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to create user';
		console.error('[Users] Create error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

async function updateUser(id: number, patch: Partial<User> & { roleId?: number | null }) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch(`/api/users/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error || 'Failed to update user');
		}
		await loadUsers();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to update user';
		console.error('[Users] Update error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

async function deleteUser(id: number) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete user');
		await loadUsers();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to delete user';
		console.error('[Users] Delete error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

export function usersStore() {
	return {
		get users() {
			return state.users;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		loadUsers,
		createUser,
		updateUser,
		deleteUser
	};
}
