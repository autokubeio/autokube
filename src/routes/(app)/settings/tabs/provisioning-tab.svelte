<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		Cloud,
		Eye,
		EyeOff,
		Save,
		Trash2,
		CheckCircle2,
		AlertTriangle,
		AlertCircle,
		ShieldOff,
		ShieldCheck,
		ExternalLink,
		Loader2,
		Plus,
		RefreshCw,
		Server,
		ScrollText
	} from 'lucide-svelte';
	import { provisionedClustersStore, type ProvisionedClusterPublic } from '$lib/stores/provisioned-clusters.svelte';
	import ProvisioningWizard from '$lib/components/provisioning/provisioning-wizard.svelte';
	import ProvisioningLogsDialog from '$lib/components/provisioning/provisioning-logs-dialog.svelte';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';

	interface ProviderConfig {
		id: string;
		name: string;
		description: string;
		docsUrl: string;
		tokenPlaceholder: string;
		color: string;
		available: boolean;
	}

	const PROVIDERS: ProviderConfig[] = [
		{
			id: 'hetzner',
			name: 'Hetzner Cloud',
			description: 'Fast, affordable K3s clusters in Europe and the US. Requires a Read & Write API token.',
			docsUrl: 'https://docs.hetzner.com/cloud/api/getting-started/generating-api-token',
			tokenPlaceholder: 'HetznerCloudAPITokenHere...',
			color: 'text-red-500',
			available: true
		},
		{
			id: 'aws',
			name: 'Amazon AWS',
			description: "The world's most comprehensive and broadly adopted cloud platform.",
			docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
			tokenPlaceholder: 'AKIAIOSFODNN7EXAMPLE',
			color: 'text-orange-400',
			available: false
		},
		{
			id: 'gcp',
			name: 'Google Cloud',
			description: 'High-performance cloud infrastructure for data-intensive workloads.',
			docsUrl: 'https://cloud.google.com/iam/docs/creating-managing-service-account-keys',
			tokenPlaceholder: 'Service account JSON key...',
			color: 'text-blue-500',
			available: false
		},
		{
			id: 'digitalocean',
			name: 'DigitalOcean',
			description: 'Simple and cost-effective cloud infrastructure built for developers.',
			docsUrl: 'https://docs.digitalocean.com/reference/api/create-personal-access-token/',
			tokenPlaceholder: 'dop_v1_...',
			color: 'text-blue-400',
			available: false
		}
	];

	// ── State ─────────────────────────────────────────────────────────────────

	// Provider token state
	let tokenStatus = $state<Record<string, boolean>>({});
	let tokenInputs = $state<Record<string, string>>({});
	let showToken = $state<Record<string, boolean>>({});
	let saving = $state<Record<string, boolean>>({});
	let removing = $state<Record<string, boolean>>({});
	let loading = $state(true);

	// Cluster management state
	let wizardOpen = $state(false);
	let logsDialogOpen = $state(false);
	let logsClusterId = $state<number | null>(null);
	let logsClusterName = $state<string>('');
	let deleting = $state<number | null>(null);

	function openLogs(cluster: ProvisionedClusterPublic) {
		logsClusterId = cluster.id;
		logsClusterName = cluster.clusterName;
		logsDialogOpen = true;
	}

	const provisionedClusters = $derived(provisionedClustersStore.clusters);

	const PROVIDER_LABELS: Record<string, string> = {
		hetzner: 'Hetzner Cloud',
		aws: 'Amazon AWS',
		gcp: 'Google Cloud',
		digitalocean: 'DigitalOcean'
	};

	// ── Load ──────────────────────────────────────────────────────────────────

	onMount(async () => {
		await provisionedClustersStore.fetch();
		try {
			const res = await fetch('/api/settings/providers');
			if (res.ok) {
				const data = await res.json();
				tokenStatus = data.tokens ?? {};
			}
		} catch {
			toast.error('Failed to load provider settings');
		} finally {
			loading = false;
		}
	});

	// ── Cluster Actions ───────────────────────────────────────────────────────

	let toggling = $state<number | null>(null);

	async function toggleProtection(cluster: ProvisionedClusterPublic) {
		toggling = cluster.id;
		try {
			await provisionedClustersStore.update(cluster.id, {
				protectAgainstDeletion: !cluster.protectAgainstDeletion
			});
			toast.success(
				cluster.protectAgainstDeletion
					? `Protection disabled for "${cluster.clusterName}"`
					: `Protection enabled for "${cluster.clusterName}"`
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update protection');
		} finally {
			toggling = null;
		}
	}

	async function handleDelete(cluster: ProvisionedClusterPublic) {
		deleting = cluster.id;
		try {
			if (cluster.protectAgainstDeletion) {
				await provisionedClustersStore.update(cluster.id, { protectAgainstDeletion: false });
			}
			await provisionedClustersStore.delete(cluster.id);
			toast.success(`Cluster "${cluster.clusterName}" deleted`);
			if (logsClusterId === cluster.id) {
				logsDialogOpen = false;
				logsClusterId = null;
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete cluster');
		} finally {
			deleting = null;
		}
	}

	function getConfig<T>(jsonStr: string | null, fallback: T): T {
		if (!jsonStr) return fallback;
		try {
			return JSON.parse(jsonStr) as T;
		} catch {
			return fallback;
		}
	}

	function onWizardSuccess(id: number) {
		logsClusterId = id;
		const c = provisionedClusters.find((x) => x.id === id);
		logsClusterName = c?.clusterName ?? '';
		logsDialogOpen = true;
	}

	// ── Provider Token Actions ────────────────────────────────────────────────

	async function saveToken(providerId: string) {
		const token = tokenInputs[providerId]?.trim();
		if (!token) return;

		saving[providerId] = true;
		try {
			const res = await fetch('/api/settings/providers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider: providerId, token })
			});
			if (!res.ok) {
				const d = await res.json();
				throw new Error(d.error ?? 'Failed to save');
			}
			tokenStatus[providerId] = true;
			tokenInputs[providerId] = '';
			toast.success(`${PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId} token saved`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save token');
		} finally {
			saving[providerId] = false;
		}
	}

	async function removeToken(providerId: string) {
		removing[providerId] = true;
		try {
			const res = await fetch('/api/settings/providers', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider: providerId })
			});
			if (!res.ok) throw new Error('Failed to remove');
			tokenStatus[providerId] = false;
			toast.success(`Token removed`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to remove token');
		} finally {
			removing[providerId] = false;
		}
	}
</script>

<!-- Header -->
<div class="flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">Provisioned Clusters</h2>
			<Badge variant="secondary" class="text-xs">{provisionedClusters.length}</Badge>
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">K3s clusters created and managed directly from AutoKube.</p>
	</div>
	<div class="flex items-center gap-2">
		<Button
			variant="outline"
			size="sm"
			class="gap-1.5 text-xs"
			onclick={() => provisionedClustersStore.fetch()}
			disabled={provisionedClustersStore.loading}
		>
			<RefreshCw class={cn('size-3', provisionedClustersStore.loading && 'animate-spin')} />
			Refresh
		</Button>
		<Button size="sm" class="gap-1.5 text-xs" onclick={() => (wizardOpen = true)}>
			<Plus class="size-3" />
			New Cluster
		</Button>
	</div>
</div>

<!-- Cluster list -->
<div class="mt-4 space-y-2">
	{#if provisionedClustersStore.loading && provisionedClusters.length === 0}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="size-4 animate-spin text-muted-foreground" />
		</div>
	{:else if provisionedClusters.length === 0}
		<div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12">
			<Cloud class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No provisioned clusters yet</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={() => (wizardOpen = true)}>
				<Plus class="size-3" /> Create your first cluster
			</Button>
		</div>
	{:else}
		{#each provisionedClusters as cluster (cluster.id)}
			{@const masters = getConfig<{ count: number; instanceType: string }>(cluster.mastersPoolConfig, { count: 0, instanceType: '—' })}
			{@const workers = getConfig<Array<{ count: number }>>(cluster.workerPoolsConfig, [])}
			{@const workerCount = workers.reduce((s, p) => s + p.count, 0)}
			{@const isError = cluster.status === 'error'}
			<div class={cn(
				'rounded-lg border bg-card px-4 py-3',
				isError ? 'border-red-500/40 bg-red-500/5' : ''
			)}>
				<div class="flex items-center gap-4">
					<!-- Icon -->
					<div class={cn(
						'flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted',
						isError && 'border-red-500/40 bg-red-500/10'
					)}>
						<Cloud class={cn('size-4', isError ? 'text-red-400' : 'text-muted-foreground')} />
					</div>

					<!-- Info -->
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="font-mono text-sm font-medium">{cluster.clusterName}</span>
							<Badge variant="secondary" class="font-mono text-[10px]">{PROVIDER_LABELS[cluster.provider] ?? cluster.provider}</Badge>
							<Badge variant="outline" class="font-mono text-[10px]">{cluster.k3sVersion}</Badge>
						</div>
						<p class="mt-0.5 truncate text-xs text-muted-foreground">
							{masters.count} master{masters.count !== 1 ? 's' : ''} &middot; {workerCount} worker{workerCount !== 1 ? 's' : ''} &middot; {masters.instanceType}
						</p>
					</div>

					<!-- Status badge -->
					<div class="shrink-0">
						{#if cluster.status === 'running'}
							<Badge class="gap-1 border-emerald-500/50 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
								<span class="size-1.5 rounded-full bg-emerald-500"></span>Running
							</Badge>
						{:else if cluster.status === 'provisioning'}
							<Badge class="gap-1 border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
								<Loader2 class="size-2.5 animate-spin" />Provisioning
							</Badge>
						{:else if isError}
							<Badge class="gap-1 border-red-500/50 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
								<AlertCircle class="size-2.5" />Error
							</Badge>
						{:else if cluster.status === 'deleting'}
							<Badge class="gap-1 border-red-500/50 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
								<Loader2 class="size-2.5 animate-spin" />Deleting
							</Badge>
						{:else}
							<Badge variant="outline" class="gap-1 text-[10px] text-muted-foreground">
								<span class="size-1.5 rounded-full bg-muted-foreground/40"></span>Pending
							</Badge>
						{/if}
					</div>

					<!-- Actions -->
					<div class="flex shrink-0 items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							class="size-7 text-muted-foreground hover:text-foreground"
							title="View provisioning logs"
							onclick={() => openLogs(cluster)}
						>
							<ScrollText class="size-3.5" />
						</Button>
					<Button
						variant="ghost"
						size="icon"
						class={cn('size-7', cluster.protectAgainstDeletion ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-foreground')}
						title={cluster.protectAgainstDeletion ? 'Protected — click to disable deletion protection' : 'Unprotected — click to enable deletion protection'}
						onclick={() => toggleProtection(cluster)}
						disabled={toggling === cluster.id}
					>
						{#if toggling === cluster.id}
							<Loader2 class="size-3.5 animate-spin" />
						{:else if cluster.protectAgainstDeletion}
							<ShieldCheck class="size-3.5" />
						{:else}
							<ShieldOff class="size-3.5" />
						{/if}
					</Button>
					<ConfirmDelete
						title={cluster.clusterName}
						description={cluster.protectAgainstDeletion
							? 'This cluster has deletion protection enabled. Confirming will disable protection and permanently delete it.'
							: 'This will permanently delete the cluster record. Cloud resources must be destroyed separately.'}
							loading={deleting === cluster.id}
							onConfirm={() => handleDelete(cluster)}
						>
							{#snippet children()}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 text-muted-foreground hover:text-destructive"
									disabled={deleting === cluster.id}
								>
									{#if deleting === cluster.id}
										<Loader2 class="size-3.5 animate-spin" />
									{:else}
										<Trash2 class="size-3.5" />
									{/if}
								</Button>
							{/snippet}
						</ConfirmDelete>
					</div>
				</div>

				<!-- Error message row -->
				{#if isError && cluster.statusMessage}
					<div class="mt-2 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
						<AlertCircle class="size-3.5 shrink-0 text-red-400 mt-0.5" />
						<p class="text-xs text-red-400 break-all leading-relaxed">{cluster.statusMessage}</p>
						<Button
							variant="ghost"
							size="sm"
							class="ml-auto shrink-0 h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/20"
							onclick={() => openLogs(cluster)}
						>
							<ScrollText class="size-3 mr-1" />
							View logs
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<!-- ── Provider Credentials ──────────────────────────────────────────── -->
<div class="mt-8">
	<div class="flex items-start justify-between mb-4">
		<div>
			<div class="flex items-center gap-2">
				<h2 class="text-lg font-semibold">Cloud Provider Credentials</h2>
			</div>
			<p class="mt-0.5 text-sm text-muted-foreground">API tokens stored encrypted at rest. Configure a provider to enable cluster provisioning.</p>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center gap-2 text-sm text-muted-foreground py-6">
			<Loader2 class="size-4 animate-spin" />
			Loading provider settings...
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each PROVIDERS as provider}
				<div class={cn(
					'rounded-lg border bg-card p-4 flex flex-col gap-3 transition-colors',
					provider.available ? 'border-border' : 'border-border/50 opacity-60'
				)}>
					<!-- Provider header -->
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2.5 min-w-0">
							<div class={cn('flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50', provider.color)}>
								<Server class="size-4" />
							</div>
							<div class="min-w-0">
								<div class="flex items-center gap-1.5 flex-wrap">
									<span class="text-sm font-medium">{provider.name}</span>
									{#if !provider.available}
										<Badge variant="secondary" class="text-[10px] px-1.5">Coming Soon</Badge>
									{:else if tokenStatus[provider.id]}
										<Badge variant="outline" class="text-[10px] border-emerald-500/30 text-emerald-500 bg-emerald-500/5 px-1.5">
											<CheckCircle2 class="size-2.5 mr-1" />Configured
										</Badge>
									{:else}
										<Badge variant="outline" class="text-[10px] border-amber-500/30 text-amber-500 bg-amber-500/5 px-1.5">
											<AlertTriangle class="size-2.5 mr-1" />Not set
										</Badge>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{provider.description}</p>
							</div>
						</div>
						{#if provider.available}
							<a
								href={provider.docsUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="shrink-0 text-muted-foreground hover:text-primary transition-colors"
								title="View documentation"
							>
								<ExternalLink class="size-3.5" />
							</a>
						{/if}
					</div>

					<!-- Token input — only for available providers -->
					{#if provider.available}
						<div class="flex gap-2 items-center">
							<div class="relative flex-1">
								<Input
									type={showToken[provider.id] ? 'text' : 'password'}
									placeholder={tokenStatus[provider.id] ? 'Leave blank to keep existing' : provider.tokenPlaceholder}
									bind:value={tokenInputs[provider.id]}
									class="pr-8 font-mono text-xs h-8"
									onkeydown={(e) => { if (e.key === 'Enter') saveToken(provider.id); }}
								/>
								<button
									type="button"
									onclick={() => (showToken[provider.id] = !showToken[provider.id])}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								>
									{#if showToken[provider.id]}
										<EyeOff class="size-3.5" />
									{:else}
										<Eye class="size-3.5" />
									{/if}
								</button>
							</div>
							<Button
								size="sm"
								class="h-8 px-3"
								onclick={() => saveToken(provider.id)}
								disabled={!tokenInputs[provider.id]?.trim() || saving[provider.id]}
							>
								{#if saving[provider.id]}
									<Loader2 class="size-3 animate-spin" />
								{:else}
									<Save class="size-3" />
								{/if}
							</Button>
							{#if tokenStatus[provider.id]}
								<Button
									variant="ghost"
									size="sm"
									class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
									onclick={() => removeToken(provider.id)}
									disabled={removing[provider.id]}
									title="Remove token"
								>
									{#if removing[provider.id]}
										<Loader2 class="size-3 animate-spin" />
									{:else}
										<Trash2 class="size-3" />
									{/if}
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<ProvisioningWizard bind:open={wizardOpen} onSuccess={onWizardSuccess} />

{#if logsClusterId !== null}
	<ProvisioningLogsDialog
		bind:open={logsDialogOpen}
		clusterId={logsClusterId}
		clusterName={logsClusterName}
	/>
{/if}
