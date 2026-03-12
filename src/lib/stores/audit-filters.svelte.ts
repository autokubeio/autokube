import type { AuditAction, AuditEntityType } from '$lib/server/queries/audit';

interface AuditFilters {
	actions: AuditAction[];
	entityTypes: AuditEntityType[];
	clusterId: number | null;
	username: string | null;
	search: string;
	page: number;
	pageSize: number;
}

const defaultFilters: AuditFilters = {
	actions: [],
	entityTypes: [],
	clusterId: null,
	username: null,
	search: '',
	page: 0,
	pageSize: 25
};

let filters = $state<AuditFilters>({ ...defaultFilters });

export const auditFiltersStore = {
	get actions() {
		return filters.actions;
	},
	get entityTypes() {
		return filters.entityTypes;
	},
	get clusterId() {
		return filters.clusterId;
	},
	get username() {
		return filters.username;
	},
	get search() {
		return filters.search;
	},
	get page() {
		return filters.page;
	},
	get pageSize() {
		return filters.pageSize;
	},

	toggleAction(action: AuditAction) {
		if (filters.actions.includes(action)) {
			filters.actions = filters.actions.filter((a) => a !== action);
		} else {
			filters.actions = [...filters.actions, action];
		}
		filters.page = 0; // Reset to first page
	},

	setActions(actions: AuditAction[]) {
		filters.actions = actions;
		filters.page = 0;
	},

	toggleEntityType(entityType: AuditEntityType) {
		if (filters.entityTypes.includes(entityType)) {
			filters.entityTypes = filters.entityTypes.filter((e) => e !== entityType);
		} else {
			filters.entityTypes = [...filters.entityTypes, entityType];
		}
		filters.page = 0;
	},

	setEntityTypes(entityTypes: AuditEntityType[]) {
		filters.entityTypes = entityTypes;
		filters.page = 0;
	},

	setClusterId(clusterId: number | null) {
		filters.clusterId = clusterId;
		filters.page = 0;
	},

	setUsername(username: string | null) {
		filters.username = username;
		filters.page = 0;
	},

	setSearch(search: string) {
		filters.search = search;
		filters.page = 0;
	},

	setPage(page: number) {
		filters.page = page;
	},

	setPageSize(pageSize: number) {
		filters.pageSize = pageSize;
		filters.page = 0;
	},

	clearFilters() {
		filters = { ...defaultFilters };
	},

	hasActiveFilters(): boolean {
		return (
			filters.actions.length > 0 ||
			filters.entityTypes.length > 0 ||
			filters.clusterId !== null ||
			filters.username !== null ||
			filters.search !== ''
		);
	}
};
