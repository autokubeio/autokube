<script lang="ts">
	import type { WizardData } from './provisioning-wizard.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Plus, Trash2, Server, Crown, Tag, TrendingUp, X } from 'lucide-svelte';

	const { data = $bindable() }: { data: WizardData } = $props();

	const INSTANCE_TYPES = [
		{ value: 'cx22',  label: 'CX22',  cores: 2,  mem: 4  },
		{ value: 'cx32',  label: 'CX32',  cores: 4,  mem: 8  },
		{ value: 'cx42',  label: 'CX42',  cores: 8,  mem: 16 },
		{ value: 'cx52',  label: 'CX52',  cores: 16, mem: 32 },
		{ value: 'cpx11', label: 'CPX11', cores: 2,  mem: 2  },
		{ value: 'cpx21', label: 'CPX21', cores: 3,  mem: 4  },
		{ value: 'cpx31', label: 'CPX31', cores: 4,  mem: 8  },
		{ value: 'cpx41', label: 'CPX41', cores: 8,  mem: 16 },
		{ value: 'cpx51', label: 'CPX51', cores: 16, mem: 32 }
	];

	const LOCATIONS = [
		{ value: 'nbg1', label: 'Nuremberg, DE',     flag: '🇩🇪' },
		{ value: 'fsn1', label: 'Falkenstein, DE',   flag: '🇩🇪' },
		{ value: 'hel1', label: 'Helsinki, FI',      flag: '🇫🇮' },
		{ value: 'ash',  label: 'Ashburn, VA, US',   flag: '🇺🇸' },
		{ value: 'hil',  label: 'Hillsboro, OR, US', flag: '🇺🇸' },
		{ value: 'sin',  label: 'Singapore',         flag: '🇸🇬' }
	];

	const MASTER_COUNTS = [1, 3, 5, 7];
	const NODE_COUNTS   = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

	function getInstanceShort(value: string) {
		const t = INSTANCE_TYPES.find((x) => x.value === value);
		return t ? `${t.label}  ${t.cores}C / ${t.mem}G` : value;
	}

	function getLocationShort(value: string) {
		const l = LOCATIONS.find((x) => x.value === value);
		return l ? `${l.flag} ${value}` : value;
	}

	// ── Master location helpers ───────────────────────────────────────────────

	function syncMasterLocations(count: number) {
		const current = data.masterLocations;
		if (current.length === count) return;
		if (current.length < count) {
			const fill = current[current.length - 1] ?? 'nbg1';
			data.masterLocations = [...current, ...Array(count - current.length).fill(fill)];
		} else {
			data.masterLocations = current.slice(0, count);
		}
	}

	function setMasterCount(n: number) {
		data.masterCount = n;
		syncMasterLocations(n);
	}

	// ── Worker pool helpers ───────────────────────────────────────────────────

	function addWorkerPool() {
		data.workerPools = [
			...data.workerPools,
			{
				id: crypto.randomUUID(),
				name: `worker-pool-${data.workerPools.length + 1}`,
				count: 2,
				instanceType: 'cx22',
				location: data.masterLocations[0] ?? 'nbg1',
				labels: [],
				autoscaling: { enabled: false, minInstances: 1, maxInstances: 5 }
			}
		];
	}

	function removeWorkerPool(id: string) {
		data.workerPools = data.workerPools.filter((p) => p.id !== id);
	}

	function addLabel(poolId: string) {
		const pool = data.workerPools.find((p) => p.id === poolId);
		if (pool) pool.labels = [...pool.labels, { key: '', value: '' }];
	}

	function removeLabel(poolId: string, idx: number) {
		const pool = data.workerPools.find((p) => p.id === poolId);
		if (pool) pool.labels = pool.labels.filter((_, i) => i !== idx);
	}

	const totalWorkers = $derived(data.workerPools.reduce((s, p) => s + (p.autoscaling.enabled ? p.autoscaling.minInstances : p.count), 0));
	const totalNodes   = $derived(data.masterCount + totalWorkers);
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-sm font-semibold mb-1">Node Configuration</h3>
		<p class="text-xs text-muted-foreground">Define master nodes and worker node pools for your cluster.</p>
	</div>

	<!-- Summary -->
	<div class="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
		<Server class="size-4 text-primary shrink-0" />
		<span class="text-xs font-medium text-primary">
			{data.masterCount} master{data.masterCount > 1 ? 's' : ''}
			+ {totalWorkers} worker{totalWorkers !== 1 ? 's' : ''}
			= <strong>{totalNodes} total nodes</strong>
		</span>
	</div>

	<!-- Master Nodes -->
	<div class="rounded-lg border border-border bg-card overflow-hidden">
		<div class="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
			<Crown class="size-3.5 text-amber-500" />
			<span class="text-xs font-semibold">Master Nodes</span>
			<span class="text-xs text-muted-foreground">— Control plane</span>
		</div>
		<div class="p-4 space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<!-- Count -->
				<div class="space-y-1.5">
					<Label class="text-xs font-medium text-muted-foreground">Count</Label>
					<Select.Root type="single" value={String(data.masterCount)} onValueChange={(v: string) => setMasterCount(Number(v))}>
						<Select.Trigger class="h-9 text-sm">
							{data.masterCount} {data.masterCount === 1 ? 'node' : 'nodes'}
						</Select.Trigger>
						<Select.Content>
							{#each MASTER_COUNTS as n}
								<Select.Item value={String(n)}>
									{n} {n === 1 ? 'node' : 'nodes'}
									{#if n > 1}<span class="ml-1.5 text-xs text-muted-foreground">HA</span>{/if}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					{#if data.masterCount % 2 === 0}
						<p class="text-[10px] text-amber-500">Use odd numbers for HA quorum.</p>
					{/if}
				</div>

				<!-- Instance Type -->
				<div class="space-y-1.5">
					<Label class="text-xs font-medium text-muted-foreground">Instance Type</Label>
					<Select.Root type="single" bind:value={data.masterInstanceType}>
						<Select.Trigger class="h-9 text-sm">
							{getInstanceShort(data.masterInstanceType)}
						</Select.Trigger>
						<Select.Content>
							{#each INSTANCE_TYPES as t}
								<Select.Item value={t.value}>
									<div class="flex items-center justify-between gap-4 w-full">
										<span class="font-mono font-medium">{t.label}</span>
										<span class="text-xs text-muted-foreground">{t.cores} vCPU · {t.mem} GB</span>
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<!-- Per-node locations -->
			<div class="space-y-1.5">
				<Label class="text-xs font-medium text-muted-foreground">
					Location{data.masterCount > 1 ? 's' : ''}
					{#if data.masterCount > 1}<span class="text-muted-foreground/60 font-normal ml-1">— one per node for HA</span>{/if}
				</Label>
				<div class="grid gap-2" style="grid-template-columns: repeat({Math.min(data.masterCount, 4)}, minmax(0, 1fr))">
					{#each data.masterLocations as loc, i}
						<div class="space-y-1">
							{#if data.masterCount > 1}
								<span class="text-[10px] text-muted-foreground font-mono">node-{i + 1}</span>
							{/if}
							<Select.Root
								type="single"
								value={loc}
								onValueChange={(v: string) => { if (v) data.masterLocations[i] = v; }}
							>
								<Select.Trigger class="h-9 text-sm">
									{getLocationShort(loc)}
								</Select.Trigger>
								<Select.Content>
									{#each LOCATIONS as l}
										<Select.Item value={l.value}>
											<span class="mr-1.5">{l.flag}</span>{l.label}
											<span class="ml-1.5 font-mono text-xs text-muted-foreground">({l.value})</span>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Worker Pools -->
	<div class="space-y-2.5">
		<div class="flex items-center justify-between">
			<div>
				<span class="text-xs font-semibold">Worker Pools</span>
				{#if data.workerPools.length > 0}
					<span class="ml-1.5 text-xs text-muted-foreground">({data.workerPools.length})</span>
				{/if}
			</div>
			<Button variant="outline" size="sm" onclick={addWorkerPool} class="h-7 px-2.5 text-xs gap-1.5">
				<Plus class="size-3" />
				Add Pool
			</Button>
		</div>

		{#if data.workerPools.length === 0}
			<div class="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center">
				<Server class="size-5 text-muted-foreground mx-auto mb-2" />
				<p class="text-xs text-muted-foreground">No worker pools. Add at least one pool for workloads.</p>
			</div>
		{:else}
			{#each data.workerPools as pool (pool.id)}
				<div class="rounded-lg border border-border bg-card overflow-hidden">
					<!-- Pool header -->
					<div class="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
						<Server class="size-3.5 text-muted-foreground shrink-0" />
						<Input
							value={pool.name}
							oninput={(e) => { pool.name = e.currentTarget.value; }}
							class="h-5 px-0 text-xs font-mono font-medium border-0 bg-transparent shadow-none focus-visible:ring-0 flex-1 min-w-0"
							placeholder="pool-name"
						/>
						<button
							type="button"
							onclick={() => removeWorkerPool(pool.id)}
							class="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
							aria-label="Remove pool"
						>
							<Trash2 class="size-3.5" />
						</button>
					</div>

					<div class="p-4 space-y-4">
						<!-- Count / Instance / Location -->
						<div class="grid grid-cols-3 gap-3">
							<div class="space-y-1.5">
								<Label class="text-xs font-medium text-muted-foreground">
									{pool.autoscaling.enabled ? 'Min Nodes' : 'Node Count'}
								</Label>
								{#if pool.autoscaling.enabled}
									<Input
										type="number"
										min="1"
										value={pool.autoscaling.minInstances}
										oninput={(e) => { pool.autoscaling.minInstances = Math.max(1, Number(e.currentTarget.value)); }}
										class="h-9 text-sm"
									/>
								{:else}
									<Select.Root
										type="single"
										value={String(pool.count)}
										onValueChange={(v: string) => { if (v) pool.count = Number(v); }}
									>
										<Select.Trigger class="h-9 text-sm">
											{pool.count} {pool.count === 1 ? 'node' : 'nodes'}
										</Select.Trigger>
										<Select.Content>
											{#each NODE_COUNTS as n}
												<Select.Item value={String(n)}>{n} {n === 1 ? 'node' : 'nodes'}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
							</div>

							<div class="space-y-1.5">
								<Label class="text-xs font-medium text-muted-foreground">Instance Type</Label>
								<Select.Root
									type="single"
									value={pool.instanceType}
									onValueChange={(v: string) => { if (v) pool.instanceType = v; }}
								>
									<Select.Trigger class="h-9 text-sm">
										{getInstanceShort(pool.instanceType)}
									</Select.Trigger>
									<Select.Content>
										{#each INSTANCE_TYPES as t}
											<Select.Item value={t.value}>
												<div class="flex items-center justify-between gap-4 w-full">
													<span class="font-mono font-medium">{t.label}</span>
													<span class="text-xs text-muted-foreground">{t.cores} vCPU · {t.mem} GB</span>
												</div>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-1.5">
								<Label class="text-xs font-medium text-muted-foreground">Location</Label>
								<Select.Root
									type="single"
									value={pool.location}
									onValueChange={(v: string) => { if (v) pool.location = v; }}
								>
									<Select.Trigger class="h-9 text-sm">
										{getLocationShort(pool.location)}
									</Select.Trigger>
									<Select.Content>
										{#each LOCATIONS as l}
											<Select.Item value={l.value}>
												<span class="mr-1.5">{l.flag}</span>{l.label}
												<span class="ml-1.5 font-mono text-xs text-muted-foreground">({l.value})</span>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>

						<!-- Autoscaling -->
						<div class="rounded-md border border-border bg-muted/10 p-3 space-y-3">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<TrendingUp class="size-3.5 text-muted-foreground" />
									<span class="text-xs font-medium">Autoscaling</span>
								</div>
								<Switch
									checked={pool.autoscaling.enabled}
									onCheckedChange={(v) => { pool.autoscaling.enabled = v; }}
									class="scale-75 origin-right"
								/>
							</div>
							{#if pool.autoscaling.enabled}
								<div class="grid grid-cols-2 gap-3">
									<div class="space-y-1.5">
										<Label class="text-xs text-muted-foreground">Min Instances</Label>
										<Input
											type="number"
											min="1"
											value={pool.autoscaling.minInstances}
											oninput={(e) => { pool.autoscaling.minInstances = Math.max(1, Number(e.currentTarget.value)); }}
											class="h-8 text-sm"
										/>
									</div>
									<div class="space-y-1.5">
										<Label class="text-xs text-muted-foreground">Max Instances</Label>
										<Input
											type="number"
											min={pool.autoscaling.minInstances}
											value={pool.autoscaling.maxInstances}
											oninput={(e) => { pool.autoscaling.maxInstances = Math.max(pool.autoscaling.minInstances, Number(e.currentTarget.value)); }}
											class="h-8 text-sm"
										/>
									</div>
								</div>
							{/if}
						</div>

						<!-- Labels -->
						<div class="space-y-2">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<Tag class="size-3.5 text-muted-foreground" />
									<span class="text-xs font-medium">Labels</span>
									{#if pool.labels.length > 0}
										<span class="text-xs text-muted-foreground">({pool.labels.length})</span>
									{/if}
								</div>
								<button
									type="button"
									onclick={() => addLabel(pool.id)}
									class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									<Plus class="size-3" />
									Add label
								</button>
							</div>
							{#if pool.labels.length > 0}
								<div class="space-y-1.5">
									{#each pool.labels as lbl, i}
										<div class="flex items-center gap-2">
											<Input
												value={lbl.key}
												oninput={(e) => { lbl.key = e.currentTarget.value; }}
												placeholder="key"
												class="h-7 text-xs font-mono flex-1"
											/>
											<span class="text-xs text-muted-foreground">=</span>
											<Input
												value={lbl.value}
												oninput={(e) => { lbl.value = e.currentTarget.value; }}
												placeholder="value"
												class="h-7 text-xs font-mono flex-1"
											/>
											<button
												type="button"
												onclick={() => removeLabel(pool.id, i)}
												class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-500 transition-colors"
											>
												<X class="size-3.5" />
											</button>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
