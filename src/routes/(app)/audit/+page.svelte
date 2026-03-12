<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		RefreshCw,
		Search,
		ClipboardList,
		User as UserIcon,
		Box,
		Activity,
		Server,
		ChevronDown,
		Check,
		Loader2,
		Eye,
		Sparkles
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import {
		getEntityIcon,
		getActionIcon,
		getActionColor,
		ENTITY_TYPES,
		ACTION_TYPES,
		getEntityTypeLabel,
		getActionLabel
	} from './audit-utils';
	import { auditFiltersStore } from '$lib/stores/audit-filters.svelte';
	import { clustersStore } from '$lib/stores/clusters.svelte';
	import EnterpriseFeatureLock from '$lib/components/enterprise-feature-lock.svelte';
	import type { AuditLogWithCluster } from '$lib/server/queries/audit';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, auditColumns } from '$lib/table-columns';

	// ── State ──────────────────────────────────────────────────

	let logs = $state<AuditLogWithCluster[]>([]);
	let total = $state(0);
	let users = $state<string[]>([]);
	let isLoading = $state(false);
	let isFetching = $state(false);
	let showDetailDialog = $state(false);
	let selectedLog = $state<AuditLogWithCluster | null>(null);
	let sortState = $state<DataTableSortState | undefined>(undefined);
	let hasValidLicense = $state(false);
	let licenseChecked = $state(false);

	// ── Derived ────────────────────────────────────────────────

	const totalPages = $derived(Math.ceil(total / auditFiltersStore.pageSize));
	const filtersActive = $derived(auditFiltersStore.hasActiveFilters());
	const entityTriggerIcon = $derived(
		auditFiltersStore.entityTypes.length === 1
			? getEntityIcon(auditFiltersStore.entityTypes[0])
			: Box
	);
	const actionTriggerIcon = $derived(
		auditFiltersStore.actions.length === 1 ? getActionIcon(auditFiltersStore.actions[0]) : Activity
	);

	// ── Fetch Functions ────────────────────────────────────────

	async function fetchAuditLogs() {
		isFetching = true;
		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not used reactively
			const params = new URLSearchParams();

			if (auditFiltersStore.actions.length > 0) {
				params.set('actions', auditFiltersStore.actions.join(','));
			}
			if (auditFiltersStore.entityTypes.length > 0) {
				params.set('entityTypes', auditFiltersStore.entityTypes.join(','));
			}
			if (auditFiltersStore.clusterId !== null) {
				params.set('clusterId', String(auditFiltersStore.clusterId));
			}
			if (auditFiltersStore.username) {
				params.set('username', auditFiltersStore.username);
			}
			if (auditFiltersStore.search) {
				params.set('search', auditFiltersStore.search);
			}
			params.set('limit', String(auditFiltersStore.pageSize));
			params.set('offset', String(auditFiltersStore.page * auditFiltersStore.pageSize));

			const res = await fetch(`/api/audit?${params}`);
			if (!res.ok) throw new Error('Failed to fetch audit logs');

			const data = await res.json();
			logs = data.logs ?? [];
			total = data.total ?? 0;
		} catch (err) {
			console.error('[Audit] Failed to fetch logs:', err);
		} finally {
			isFetching = false;
			isLoading = false;
		}
	}

	async function fetchUsers() {
		try {
			const res = await fetch('/api/audit?distinct=users');
			if (!res.ok) throw new Error('Failed to fetch users');
			const data = await res.json();
			users = data.users ?? [];
		} catch (err) {
			console.error('[Audit] Failed to fetch users:', err);
		}
	}

	// ── Helpers ───────────────────────────────────────────────

	/** Mask known sensitive field values in audit details for display. */
	const SENSITIVE_KEYS = new Set([
		'kubeconfig',
		'bearerToken',
		'bearer_token',
		'tlsCa',
		'tls_ca',
		'agentToken',
		'agent_token',
		'privateKey',
		'private_key',
		'password',
		'secret',
		'clientSecret',
		'client_secret'
	]);

	function maskSensitiveDetails(obj: Record<string, unknown>): Record<string, unknown> {
		const masked: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (SENSITIVE_KEYS.has(key) && value != null && value !== '') {
				masked[key] = '***';
			} else if (value && typeof value === 'object' && !Array.isArray(value)) {
				masked[key] = maskSensitiveDetails(value as Record<string, unknown>);
			} else {
				masked[key] = value;
			}
		}
		return masked;
	}

	// ── Handlers ───────────────────────────────────────────────

	function handleRowClick(row: AuditLogWithCluster) {
		selectedLog = row;
		showDetailDialog = true;
	}

	function handleEyeClick(e: MouseEvent, log: AuditLogWithCluster) {
		e.stopPropagation();
		selectedLog = log;
		showDetailDialog = true;
	}

	function handleRefresh() {
		fetchAuditLogs();
	}

	// ── Effects ────────────────────────────────────────────────

	onMount(async () => {
		try {
			const res = await fetch('/api/license');
			const data = await res.json();
			hasValidLicense =
				data.active && (data.payload?.type === 'professional' || data.payload?.type === 'enterprise');
		} catch {
			hasValidLicense = false;
		} finally {
			licenseChecked = true;
		}

		if (!hasValidLicense) {
			return;
		}

		isLoading = true;
		fetchAuditLogs();
		fetchUsers();
		clustersStore.fetch();
	});

	$effect(() => {
		// Track reactive dependencies
		void [
			auditFiltersStore.actions,
			auditFiltersStore.entityTypes,
			auditFiltersStore.clusterId,
			auditFiltersStore.username,
			auditFiltersStore.search,
			auditFiltersStore.page,
			auditFiltersStore.pageSize
		];

		if (!licenseChecked || !hasValidLicense) {
			return;
		}

		if (!isLoading) {
			fetchAuditLogs();
		}
	});
</script>

<svelte:head>
	<title>Audit Log - AutoKube</title>
</svelte:head>


{#if !licenseChecked}
	<section class="flex h-full min-h-0 flex-1 flex-col">
		<div class="space-y-4">
			<Skeleton class="h-10 w-56 rounded-lg" />
			<Skeleton class="h-24 w-full rounded-xl" />
			<Skeleton class="h-112 w-full rounded-xl" />
		</div>
	</section>
{:else if !hasValidLicense}
	<section class="flex h-full min-h-0 flex-1 items-start justify-center rounded-xl border border-dashed p-8">
		<div class="w-full max-w-2xl">
			<EnterpriseFeatureLock
				inline
				containerless
				featureName="Audit Log"
				featureColumns={1}
				description="Track system activity, user actions, and operational history with a Professional or Enterprise license."
				features={[
					'Platform-wide activity history',
					'User and cluster filters',
					'Detailed event inspection',
					'Compliance and review visibility'
				]}
			/>
		</div>
	</section>
{:else}
	<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Header + Filters -->
	<div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
		<div class="flex shrink-0 items-center gap-2">
			<Badge
				class="ml-auto h-5 gap-0.5 rounded-md border-0 bg-linear-to-r from-amber-400 to-yellow-500 px-1.5 text-[10px] font-bold text-black shadow-sm"
			>
				<Sparkles class="size-3" />
				Pro
			</Badge>
			<h1 class="text-lg font-semibold">Audit Log</h1>
			<span class="text-xs text-muted-foreground">
				{total}
				{total === 1 ? 'entry' : 'entries'}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-8 gap-1.5 text-xs"
				onclick={handleRefresh}
				disabled={isFetching}
			>
				{#if isFetching}
					<Loader2 class="size-3 animate-spin" />
				{:else}
					<RefreshCw class="size-3" />
				{/if}
				Refresh
			</Button>
		</div>

		<!-- Filters -->
		<div class="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
			<!-- User Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn(
								'h-8 gap-1.5 text-xs',
								auditFiltersStore.username && 'border-primary text-primary'
							)}
						>
							<UserIcon class="size-3" />
							{auditFiltersStore.username ?? 'User'}
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-72 w-52 overflow-y-auto">
					<DropdownMenu.Item onclick={() => auditFiltersStore.setUsername(null)}>
						<span class="text-xs">All Users</span>
						{#if !auditFiltersStore.username}
							<Check class="ml-auto size-3" />
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each users as user (user)}
						<DropdownMenu.Item onclick={() => auditFiltersStore.setUsername(user)}>
							<span class="font-mono text-xs">{user}</span>
							{#if auditFiltersStore.username === user}
								<Check class="ml-auto size-3" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Entity Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn(
								'h-8 gap-1.5 text-xs',
								auditFiltersStore.entityTypes.length > 0 && 'border-primary text-primary'
							)}
						>
							{@const EntityTriggerIcon = entityTriggerIcon}
							<EntityTriggerIcon class="size-3" />
							{auditFiltersStore.entityTypes.length} entities
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-72 w-52 overflow-y-auto">
					<DropdownMenu.Item onclick={() => auditFiltersStore.setEntityTypes([])}>
						<span class="text-xs">All Entities</span>
						{#if auditFiltersStore.entityTypes.length === 0}
							<Check class="ml-auto size-3" />
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each ENTITY_TYPES as { value, label } (value)}
						{@const Icon = getEntityIcon(value)}
						<DropdownMenu.Item onclick={() => auditFiltersStore.toggleEntityType(value)}>
							<Icon class="size-3 shrink-0 text-muted-foreground" />
							<span class="text-xs">{label}</span>
							{#if auditFiltersStore.entityTypes.includes(value)}
								<Check class="ml-auto size-3" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Action Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn(
								'h-8 gap-1.5 text-xs',
								auditFiltersStore.actions.length > 0 && 'border-primary text-primary'
							)}
						>
							{@const ActionTriggerIcon = actionTriggerIcon}
							<ActionTriggerIcon class="size-3" />
							{#if auditFiltersStore.actions.length === 1}
								{ACTION_TYPES.find((a) => a.value === auditFiltersStore.actions[0])?.label ??
									auditFiltersStore.actions[0]}
							{:else if auditFiltersStore.actions.length > 1}
								{auditFiltersStore.actions.length} actions
							{:else}
								Action
							{/if}
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-72 w-44 overflow-y-auto">
					<DropdownMenu.Item onclick={() => auditFiltersStore.setActions([])}>
						<span class="text-xs">All Actions</span>
						{#if auditFiltersStore.actions.length === 0}
							<Check class="ml-auto size-3" />
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each ACTION_TYPES as { value, label } (value)}
						{@const Icon = getActionIcon(value)}
						{@const colorClass = getActionColor(value)}
						<DropdownMenu.Item onclick={() => auditFiltersStore.toggleAction(value)}>
							<span
								class={cn('flex size-5 shrink-0 items-center justify-center rounded', colorClass)}
							>
								<Icon class="size-3" />
							</span>
							<span class="text-xs">{label}</span>
							{#if auditFiltersStore.actions.includes(value)}
								<Check class="ml-auto size-3" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Cluster Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn(
								'h-8 gap-1.5 text-xs',
								auditFiltersStore.clusterId !== null && 'border-primary text-primary'
							)}
						>
							<Server class="size-3" />
							{#if auditFiltersStore.clusterId !== null}
								{clustersStore.clusters.find((c) => c.id === auditFiltersStore.clusterId)?.name ??
									`Cluster #${auditFiltersStore.clusterId}`}
							{:else}
								Cluster
							{/if}
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-72 w-52 overflow-y-auto">
					<DropdownMenu.Item onclick={() => auditFiltersStore.setClusterId(null)}>
						<span class="text-xs">All Clusters</span>
						{#if auditFiltersStore.clusterId === null}
							<Check class="ml-auto size-3" />
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each clustersStore.clusters as cluster (cluster.id)}
						<DropdownMenu.Item onclick={() => auditFiltersStore.setClusterId(cluster.id)}>
							<span class="font-mono text-xs">{cluster.name}</span>
							{#if auditFiltersStore.clusterId === cluster.id}
								<Check class="ml-auto size-3" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Search -->
			<div class="relative">
				<Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder="Search name or user..."
					value={auditFiltersStore.search}
					oninput={(e) => auditFiltersStore.setSearch(e.currentTarget.value)}
					class="h-8 w-48 pl-8 text-xs"
				/>
			</div>
		</div>
	</div>

	<!-- Data Table -->
	<div class="flex min-h-0 flex-1">
		<DataTableView
			data={logs}
			keyField="id"
			name={TableName.audit}
			columns={auditColumns}
			loading={isLoading}
			{sortState}
			onSortChange={(state) => (sortState = state)}
			onRowClick={handleRowClick}
			wrapperClass="border rounded-lg"
		>
			{#snippet cell(column, log: AuditLogWithCluster)}
				{#if column.id === 'createdAt'}
					<span class="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
						{log.createdAt}
					</span>
				{:else if column.id === 'clusterName'}
					{#if log.clusterName}
						<span class="inline-flex items-center gap-1.5 font-mono text-xs">
							<Server class="size-3 shrink-0 text-muted-foreground" />
							{log.clusterName}
						</span>
					{:else}
						<span class="text-xs text-muted-foreground">—</span>
					{/if}
				{:else if column.id === 'username'}
					<span class="font-mono text-xs text-muted-foreground">{log.username}</span>
				{:else if column.id === 'action'}
					{@const ActionIcon = getActionIcon(log.action)}
					{@const colorClass = getActionColor(log.action)}
					<span
						class={cn(
							'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
							colorClass
						)}
					>
						<ActionIcon class="size-3" />
						{getActionLabel(log.action)}
					</span>
				{:else if column.id === 'entityType'}
					{@const EntityIcon = getEntityIcon(log.entityType)}
					<span class="inline-flex items-center gap-1.5 text-xs font-medium">
						<EntityIcon class="size-3 shrink-0 text-muted-foreground" />
						{getEntityTypeLabel(log.entityType)}
					</span>
				{:else if column.id === 'entityName'}
					<div class="min-w-0">
						<span class="block truncate font-mono text-xs">{log.entityName ?? '—'}</span>
					</div>
				{:else if column.id === 'ipAddress'}
					{#if log.ipAddress}
						<span class="font-mono text-[11px] text-muted-foreground">{log.ipAddress}</span>
					{:else}
						<span class="text-[11px] text-muted-foreground">—</span>
					{/if}
				{:else if column.id === 'actions'}
					<div class="flex items-center justify-center">
						<Button
							variant="ghost"
							size="sm"
							class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
							onclick={(e) => handleEyeClick(e, log)}
						>
							<Eye class="size-3.5" />
							<span class="sr-only">View details</span>
						</Button>
					</div>
				{/if}
			{/snippet}

			{#snippet emptyState()}
				<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
					<ClipboardList class="mb-3 size-10 opacity-40" />
					<p class="mb-1 font-medium">No audit entries found</p>
					{#if filtersActive}
						<p class="mb-3 text-sm">No entries match your current filters.</p>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 text-xs"
							onclick={() => auditFiltersStore.clearFilters()}
						>
							Clear filters
						</Button>
					{:else}
						<p class="text-sm">No audit events have been recorded yet.</p>
					{/if}
				</div>
			{/snippet}

			{#snippet loadingState()}
				<div class="flex items-center justify-center py-16 text-muted-foreground">
					<Loader2 class="mr-2 size-5 animate-spin" />
					Loading audit logs...
				</div>
			{/snippet}
		</DataTableView>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="flex shrink-0 items-center justify-between pt-2">
			<span class="text-xs text-muted-foreground">
				Showing {auditFiltersStore.page * auditFiltersStore.pageSize + 1}–{Math.min(
					(auditFiltersStore.page + 1) * auditFiltersStore.pageSize,
					total
				)} of {total}
			</span>
			<div class="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					class="h-7 px-2 text-xs"
					disabled={auditFiltersStore.page === 0}
					onclick={() => auditFiltersStore.setPage(auditFiltersStore.page - 1)}
				>
					Previous
				</Button>
				<span class="px-2 text-xs text-muted-foreground">
					Page {auditFiltersStore.page + 1} of {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					class="h-7 px-2 text-xs"
					disabled={auditFiltersStore.page >= totalPages - 1}
					onclick={() => auditFiltersStore.setPage(auditFiltersStore.page + 1)}
				>
					Next
				</Button>
			</div>
		</div>
	{/if}
	</section>

	<!-- Detail Dialog -->
	<Dialog.Root bind:open={showDetailDialog}>
		<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>Audit log details</Dialog.Title>
				<Dialog.Description class="sr-only">Details for audit log entry</Dialog.Description>
			</Dialog.Header>

			{#if selectedLog}
				{@const ActionIcon = getActionIcon(selectedLog.action)}
				{@const colorClass = getActionColor(selectedLog.action)}
				{@const EntityIcon = getEntityIcon(selectedLog.entityType)}

			<div class="space-y-4 py-2">
				<!-- Timestamp & User -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Timestamp</p>
						<p class="font-mono text-sm">{selectedLog.createdAt}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">User</p>
						<div class="inline-flex items-center gap-1.5">
							<UserIcon class="size-3.5 text-muted-foreground" />
							<span class="font-mono text-sm">{selectedLog.username}</span>
						</div>
					</div>
				</div>

				<!-- Action & Entity Type -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Action</p>
						<div class="inline-flex items-center gap-1.5">
							<span
								class={cn(
									'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
									colorClass
								)}
							>
								<ActionIcon class="size-3" />
								{getActionLabel(selectedLog.action)}
							</span>
						</div>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Entity type</p>
						<div class="inline-flex items-center gap-1.5">
							<EntityIcon class="size-3.5 text-muted-foreground" />
							<span class="text-sm">{getEntityTypeLabel(selectedLog.entityType)}</span>
						</div>
					</div>
				</div>

				<!-- Entity Name & Cluster ID -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Entity name</p>
						<p class="font-mono text-sm">{selectedLog.entityName ?? '—'}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Cluster ID</p>
						<p class="font-mono text-sm">{selectedLog.clusterId ?? '—'}</p>
					</div>
				</div>

				<!-- IP Address -->
				<div class="space-y-1">
					<p class="text-xs font-medium text-muted-foreground">IP address</p>
					<p class="font-mono text-sm">{selectedLog.ipAddress ?? '—'}</p>
				</div>

				<!-- Description -->
				{#if selectedLog.description}
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Description</p>
						<p class="text-sm text-muted-foreground">{selectedLog.description}</p>
					</div>
				{/if}

				<!-- User Agent -->
				{#if selectedLog.userAgent}
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">User agent</p>
						<p class="font-mono text-xs break-all text-muted-foreground">
							{selectedLog.userAgent}
						</p>
					</div>
				{/if}

				<!-- Details JSON -->
				{#if selectedLog.details && Object.keys(selectedLog.details).length}
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Details</p>
						<div class="rounded-lg border bg-zinc-950 p-3 dark:bg-zinc-900/60">
							<pre class="overflow-x-auto font-mono text-[11px] text-zinc-300">{JSON.stringify(
									maskSensitiveDetails(selectedLog.details),
									null,
									2
								)}</pre>
						</div>
					</div>
				{/if}
			</div>

				<div class="flex justify-end pt-2">
					<Button variant="outline" size="sm" onclick={() => (showDetailDialog = false)}>
						Close
					</Button>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
