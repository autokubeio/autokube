<script lang="ts">
	import { Separator } from '$lib/components/ui/separator';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cn } from '$lib/utils';
	import ClusterUsageBar from '$lib/components/cluster-usage-bar.svelte';
	import { formatCpuCapacity, formatMemCapacity, formatDiskCapacity } from '$lib/utils/formatters';
	import {
		CircleCheck,
		CircleAlert,
		Server,
		Box,
		UserCircle,
		ChevronsUpDown,
		Sparkles
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import type { ClusterInfo } from '$lib/stores/cluster.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	interface Props {
		cluster: ClusterInfo;
		allClusters: ClusterInfo[];
		onSelectCluster: (cluster: ClusterInfo) => void;
	}

	let { cluster, allClusters, onSelectCluster }: Props = $props();
</script>

<div
	class="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
>
	<!-- Cluster Switcher — always visible -->
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="flex items-center gap-1.5 rounded-sm px-2 py-0.5 transition-colors hover:bg-muted/60"
				>
					<span
						class={cn(
							'size-2 rounded-full',
							cluster.status === 'connected' && 'bg-green-500',
							cluster.status === 'warning' && 'bg-amber-500',
							cluster.status === 'disconnected' && 'bg-red-500',
							cluster.status === 'unknown' && 'bg-gray-400'
						)}
					></span>
					<Server class="size-3" />
					<span class="font-medium">{cluster.name}</span>
					<ChevronsUpDown class="size-3 opacity-60" />
				</button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content
			class="min-w-52 rounded-lg"
			align="start"
			side="bottom"
			sideOffset={4}
		>
			<DropdownMenu.Label class="text-xs text-muted-foreground"
				>Switch Cluster</DropdownMenu.Label
			>
			{#each allClusters as c, i}
				<DropdownMenu.Item onSelect={() => onSelectCluster(c)} class="gap-2 p-2">
					<span
						class={cn(
							'size-2 rounded-full transition-colors duration-500',
							c.status === 'connected' && 'bg-green-500',
							c.status === 'warning' && 'bg-amber-500',
							c.status === 'disconnected' && 'bg-red-500',
							c.status === 'unknown' && 'bg-gray-400'
						)}
					></span>
					<div class="grid flex-1 text-left text-sm leading-tight">
						<span class="truncate font-medium">{c.name}</span>
						<span class="truncate text-xs text-muted-foreground">
							{c.version}
							{#if c.status !== 'unknown'}
								<span class="ml-1 opacity-60">· {c.health}</span>
							{/if}
						</span>
					</div>
					<DropdownMenu.Shortcut>⌃{i + 1}</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Separator />
			<DropdownMenu.Item class="gap-2 p-2" onSelect={() => goto('/settings#cluster')}>
				<Sparkles class="size-3" />
				<span class="text-muted-foreground">Add cluster</span>
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<Separator orientation="vertical" class="mx-0.5 h-3.5!" />

	<!-- Health — always visible -->
	<div
		class={cn(
			'flex items-center gap-1 rounded-sm px-1.5 py-0.5',
			cluster.health === 'Healthy'
				? 'text-green-600 dark:text-green-400'
				: 'text-yellow-600 dark:text-yellow-400'
		)}
	>
		{#if cluster.health === 'Healthy'}
			<CircleCheck class="size-3" />
		{:else}
			<CircleAlert class="size-3" />
		{/if}
		{cluster.health}
	</div>

	<!-- Extended info — hidden on mobile -->
	<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! sm:block" />

	<div class="hidden items-center gap-1 px-1.5 py-0.5 lg:flex">
		<UserCircle class="size-3" />
		{cluster.user}
	</div>

	<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! sm:block" />

	<div class="hidden items-center gap-1 px-1.5 py-0.5 sm:flex">
		<Server class="size-3" />
		{cluster.version}
	</div>

	<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! md:block" />

	<div class="hidden items-center gap-1 px-1.5 py-0.5 md:flex">
		<Box class="size-3" />
		{cluster.nodes} nodes
	</div>

	<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! md:block" />

	<div class="hidden items-center gap-1 px-1.5 py-0.5 md:flex">
		<Box class="size-3" />
		{cluster.namespaces} ns
	</div>

	{#if cluster.metricsAvailable && settingsStore.showResourceUsage}
		<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! lg:block" />

		<div class="hidden items-center gap-2 px-1 lg:flex">
			<ClusterUsageBar
				label="CPU"
				usage={cluster.cpuUsage}
				capacity={cluster.cpuCapacity}
				formatValue={formatCpuCapacity}
			/>
			<ClusterUsageBar
				label="MEM"
				usage={cluster.memoryUsage}
				capacity={cluster.memoryCapacity}
				formatValue={formatMemCapacity}
			/>
			{#if cluster.diskCapacity > 0}
				<ClusterUsageBar
					label="DISK"
					usage={cluster.diskUsage}
					capacity={cluster.diskCapacity}
					formatValue={formatDiskCapacity}
				/>
			{/if}
		</div>
	{/if}

	<Separator orientation="vertical" class="mx-0.5 hidden h-3.5! lg:block" />
</div>
