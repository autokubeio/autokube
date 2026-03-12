<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { arrayAdd, arrayModify, arrayDelete, arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Key,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Database,
		EyeOff
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type Secret,
		type SecretWithAge,
		getTypeColor,
		getTypeShortName
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, secretsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allSecrets = $state<Secret[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedSecret = $state<SecretWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Secrets with age
	const secretsWithAge = $derived.by((): SecretWithAge[] => {
		const currentTime = timeTicker.now;
		return allSecrets.map((s) => ({
			...s,
			age: calculateAgeWithTicker(s.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredSecrets = $derived.by(() => {
		let result = secretsWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((s) => s.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(s) =>
					s.name.toLowerCase().includes(query) ||
					s.namespace.toLowerCase().includes(query) ||
					s.type.toLowerCase().includes(query) ||
					getTypeShortName(s.type).toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof Secret, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let secretsWatch: ReturnType<typeof useResourceWatch<Secret>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchSecrets();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (secretsWatch) secretsWatch.unsubscribe();

			secretsWatch = useResourceWatch<Secret>({
				clusterId: activeCluster.id,
				resourceType: 'secrets',
				namespace: ns,
				onAdded: (s) => {
					allSecrets = arrayAdd(allSecrets, s, (i) => `${i.namespace}/${i.name}`);
				},
				onModified: (s) => {
					allSecrets = arrayModify(allSecrets, s, (i) => `${i.namespace}/${i.name}`);
				},
				onDeleted: (s) => {
					allSecrets = arrayDelete(allSecrets, s, (i) => `${i.namespace}/${i.name}`);
				}
			});

			secretsWatch.subscribe();
		} else {
			allSecrets = [];
			namespaces = [];
			if (secretsWatch) {
				secretsWatch.unsubscribe();
				secretsWatch = null;
			}
		}
	});

	onDestroy(() => {
		secretsWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchNamespaces() {
		if (!activeCluster?.id) return;
		try {
			const res = await fetch(`/api/namespaces?cluster=${activeCluster.id}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[Secrets] Failed to fetch namespaces:', err);
		}
	}

	async function fetchSecrets() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/secrets?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.secrets) {
				allSecrets = data.secrets;
			} else {
				error = data.error || 'Failed to fetch secrets';
				allSecrets = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch secrets';
			allSecrets = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/secrets/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete secret');
			}
			toast.success(`Secret "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete secret: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(secret: SecretWithAge) {
		selectedSecret = secret;
		showDetailDialog = true;
	}

	function openYamlEditor(secret: SecretWithAge) {
		drawerResource = { resourceType: 'secret', name: secret.name, namespace: secret.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchSecrets();
	}
</script>

<svelte:head>
	<title>Secrets - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Secrets</h1>
			<span class="text-sm text-muted-foreground">
				{filteredSecrets.length} of {secretsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchSecrets}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<Select.Root
				type="single"
				value={selectedNamespace}
				onValueChange={(v: string) => {
					if (v) {
						selectedNamespace = v;
						fetchSecrets();
					}
				}}
			>
				<Select.Trigger class="h-8 flex-1 text-xs sm:w-44">
					{selectedNamespace === 'all' ? 'All namespaces' : selectedNamespace}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All namespaces</Select.Item>
					{#each namespaces as ns}
						<Select.Item value={ns}>{ns}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search secrets..."
					class="h-8 w-full pl-8 text-xs sm:w-56"
					bind:value={searchQuery}
				/>
			</div>
		</div>
	</div>

	<!-- Error -->
	{#if error}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
		>
			<AlertCircle class="size-4 shrink-0" />
			<span class="text-sm">{error}</span>
		</div>
	{/if}

	<!-- Empty states -->
	{#if !loading && !error && !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cluster selected</h3>
				<p class="text-sm text-muted-foreground">Select a cluster to view secrets</p>
			</div>
		</div>
	{:else if !loading && !error && allSecrets.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Key class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No secrets found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no secrets'
						: `No secrets in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredSecrets}
				keyField="id"
				name={TableName.secrets}
				columns={secretsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, secret: SecretWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Key class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{secret.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={secret.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = secret.namespace;
								fetchSecrets();
							}}
						/>
					{:else if column.id === 'type'}
						<Badge class="{getTypeColor(secret.type)} px-1.5 py-0 text-xs" title={secret.type}>
							{getTypeShortName(secret.type)}
						</Badge>
					{:else if column.id === 'dataCount'}
						<div class="flex items-center gap-1">
							<Database class="size-3 text-muted-foreground" />
							<span class="text-xs">{secret.dataCount}</span>
						</div>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{secret.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(secret);
								}}
								title="Edit YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openDetail(secret);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={secret.name}
								loading={deleting}
								onConfirm={() => handleDelete(secret.name, secret.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete secret"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Key class="mb-3 h-10 w-10 opacity-40" />
						<p>No secrets found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading secrets...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-4xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Secret Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedSecret}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedSecret.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedSecret.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Type</p>
							<div class="mt-1">
								<Badge class="{getTypeColor(selectedSecret.type)} px-2 py-0.5 text-xs" title={selectedSecret.type}>
									{getTypeShortName(selectedSecret.type)}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Data Keys</p>
							<p class="mt-1 text-sm">{selectedSecret.dataCount}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedSecret.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedSecret.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Data Keys -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						<span class="flex items-center gap-1.5">
							<EyeOff class="size-4" />
							Data Keys ({Object.keys(selectedSecret.data).length})
						</span>
					</h3>
					{#if Object.keys(selectedSecret.data).length > 0}
						<div class="space-y-1.5">
							{#each Object.keys(selectedSecret.data) as key}
								<div class="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
									<Key class="size-3 shrink-0 text-muted-foreground" />
									<span class="font-mono text-xs">{key}</span>
									<span class="ml-auto text-[11px] text-muted-foreground">
										{selectedSecret.data[key] ? `${selectedSecret.data[key].length} chars (base64)` : 'empty'}
									</span>
								</div>
							{/each}
						</div>
						<p class="mt-2 text-[11px] text-muted-foreground">
							Secret values are base64-encoded and not displayed for security.
						</p>
					{:else}
						<p class="text-sm text-muted-foreground">No data</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedSecret.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedSecret.labels) as [k, v]}
								<div class="flex items-start gap-2 text-xs">
									<span class="min-w-0 font-mono break-all text-muted-foreground">{k}:</span>
									<span class="font-mono">{v}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No labels</p>
					{/if}
				</div>

				<!-- Annotations -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Annotations</h3>
					{#if Object.keys(selectedSecret.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedSecret.annotations) as [k, v]}
								{@const parsed = tryPrettyJson(v)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 font-mono text-[11px] break-all text-muted-foreground">{k}</p>
									{#if parsed.pretty}
										<pre
											class="overflow-x-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{parsed.text}</pre>
									{:else}
										<p class="font-mono text-xs break-all">{v}</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No annotations</p>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if activeCluster && showYamlDialog}
	<ResourceDrawer
		bind:open={showYamlDialog}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={closeYamlEditor}
		onSuccess={handleYamlSuccess}
	/>
{/if}
