import type { PermissionMap, ResolvedRole } from '$lib/server/queries/roles';

interface RoleWithCount extends ResolvedRole {
	userCount: number;
}

interface RolesState {
	roles: RoleWithCount[];
	loading: boolean;
	error: string | null;
}

const state = $state<RolesState>({
	roles: [],
	loading: false,
	error: null
});

async function loadRoles() {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/roles');
		if (!res.ok) throw new Error('Failed to load roles');
		const data = await res.json();
		state.roles = data.roles;
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to load roles';
		console.error('[Roles] Load error:', err);
	} finally {
		state.loading = false;
	}
}

async function createRole(input: {
	name: string;
	description?: string;
	permissions: PermissionMap;
	clusterIds?: number[] | null;
}) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch('/api/roles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error || 'Failed to create role');
		}
		await loadRoles();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to create role';
		console.error('[Roles] Create error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

async function updateRole(id: number, patch: Partial<ResolvedRole>) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch(`/api/roles/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error || 'Failed to update role');
		}
		await loadRoles();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to update role';
		console.error('[Roles] Update error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

async function deleteRole(id: number) {
	state.loading = true;
	state.error = null;
	try {
		const res = await fetch(`/api/roles/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to delete role');
		await loadRoles();
	} catch (err) {
		state.error = err instanceof Error ? err.message : 'Failed to delete role';
		console.error('[Roles] Delete error:', err);
		throw err;
	} finally {
		state.loading = false;
	}
}

export function rolesStore() {
	return {
		get roles() {
			return state.roles;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		loadRoles,
		createRole,
		updateRole,
		deleteRole
	};
}
