<script lang="ts">
	import { Check, ChevronsUpDown } from 'lucide-svelte';
	import * as Popover from '$lib/components/ui/popover';
	import * as Command from '$lib/components/ui/command';
	import { cn } from '$lib/utils';

	interface InstanceType {
		value: string;
		label: string;
		cores: number;
		mem: number;
		cpuType?: string;
	}

	let {
		value = $bindable(''),
		instanceTypes,
		class: className = ''
	}: {
		value?: string;
		instanceTypes: InstanceType[];
		class?: string;
	} = $props();

	let open = $state(false);
	let search = $state('');

	// Auto-select first item when list loads and current value isn't in it
	$effect(() => {
		if (instanceTypes.length > 0 && !instanceTypes.find((t) => t.value === value)) {
			value = instanceTypes[0].value;
		}
	});

	const filtered = $derived(
		search.trim()
			? instanceTypes.filter(
					(t) =>
						t.label.toLowerCase().includes(search.toLowerCase()) ||
						t.value.toLowerCase().includes(search.toLowerCase()) ||
						String(t.cores).includes(search) ||
						String(t.mem).includes(search)
			  )
			: instanceTypes
	);

	// Group into shared vs dedicated when not searching
	const groups = $derived.by(() => {
		if (search.trim()) return null;
		const shared = filtered.filter((t) => t.cpuType !== 'dedicated');
		const dedicated = filtered.filter((t) => t.cpuType === 'dedicated');
		return { shared, dedicated };
	});

	const selected = $derived(instanceTypes.find((t) => t.value === value));

	function select(v: string) {
		value = v;
		open = false;
		search = '';
	}

	function cpuBadgeClass(cpuType?: string) {
		return cpuType === 'dedicated'
			? 'bg-violet-500/15 text-violet-500 border-violet-500/20'
			: 'bg-sky-500/15 text-sky-500 border-sky-500/20';
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring',
			className
		)}
		role="combobox"
		aria-expanded={open}
	>
		{#if selected}
			<div class="flex items-center gap-1.5 min-w-0">
				<span class="font-mono font-medium text-sm truncate">{selected.label}</span>
				<span class={cn('shrink-0 rounded border px-1 py-px text-[10px] font-medium leading-none', cpuBadgeClass(selected.cpuType))}>
					{selected.cpuType === 'dedicated' ? 'Ded' : 'Shr'}
				</span>
				<span class="text-xs text-muted-foreground shrink-0">{selected.cores}C·{selected.mem}G</span>
			</div>
		{:else}
			<span class="text-muted-foreground text-sm">Select type…</span>
		{/if}
		<ChevronsUpDown class="ml-2 size-3.5 shrink-0 text-muted-foreground opacity-50" />
	</Popover.Trigger>

	<Popover.Content class="w-80 p-0" align="start" sideOffset={4}>
		<Command.Root shouldFilter={false}>
			<Command.Input bind:value={search} placeholder="Search instance types…" class="h-9" />
			<Command.List class="max-h-64 overflow-y-auto">
				{#if filtered.length === 0}
					<Command.Empty>No matching types.</Command.Empty>
				{:else if groups && (groups.shared.length > 0 || groups.dedicated.length > 0)}
					{#if groups.shared.length > 0}
						<Command.Group heading="Shared CPU">
							{#each groups.shared as t (t.value)}
								<Command.Item value={t.value} onSelect={() => select(t.value)} class="cursor-pointer">
									<Check class={cn('mr-2 size-3 shrink-0', value === t.value ? 'opacity-100' : 'opacity-0')} />
									<div class="flex flex-1 items-center justify-between gap-2 min-w-0">
										<span class="font-mono font-medium text-sm">{t.label}</span>
										<span class="text-xs text-muted-foreground shrink-0">{t.cores} vCPU · {t.mem} GB</span>
									</div>
								</Command.Item>
							{/each}
						</Command.Group>
					{/if}
					{#if groups.dedicated.length > 0}
						<Command.Separator />
						<Command.Group heading="Dedicated CPU">
							{#each groups.dedicated as t (t.value)}
								<Command.Item value={t.value} onSelect={() => select(t.value)} class="cursor-pointer">
									<Check class={cn('mr-2 size-3 shrink-0', value === t.value ? 'opacity-100' : 'opacity-0')} />
									<div class="flex flex-1 items-center justify-between gap-2 min-w-0">
										<span class="font-mono font-medium text-sm">{t.label}</span>
										<span class="text-xs text-muted-foreground shrink-0">{t.cores} vCPU · {t.mem} GB</span>
									</div>
								</Command.Item>
							{/each}
						</Command.Group>
					{/if}
				{:else}
					{#each filtered as t (t.value)}
						<Command.Item value={t.value} onSelect={() => select(t.value)} class="cursor-pointer">
							<Check class={cn('mr-2 size-3 shrink-0', value === t.value ? 'opacity-100' : 'opacity-0')} />
							<div class="flex flex-1 items-center justify-between gap-2 min-w-0">
								<span class="font-mono font-medium text-sm">{t.label}</span>
								<span class="text-xs text-muted-foreground shrink-0">{t.cores} vCPU · {t.mem} GB</span>
							</div>
						</Command.Item>
					{/each}
				{/if}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
