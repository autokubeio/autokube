<script module lang="ts">
	// ── Types & shared exports (importable by other components) ───────────────

	export interface LabelItem {
		name: string;
		color: string;
	}

	export const DEFAULT_LABELS: LabelItem[] = [
		{ name: 'production', color: 'red' },
		{ name: 'staging', color: 'orange' },
		{ name: 'development', color: 'blue' },
		{ name: 'critical', color: 'pink' },
		{ name: 'monitoring', color: 'emerald' },
		{ name: 'internal', color: 'slate' },
		{ name: 'external', color: 'indigo' },
		{ name: 'testing', color: 'violet' },
		{ name: 'backup', color: 'amber' },
		{ name: 'legacy', color: 'yellow' }
	];

	export const COLOR_BADGE: Record<string, string> = {
		red: 'border-red-500/40 bg-red-500/10 text-red-400',
		orange: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
		amber: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
		yellow: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-400',
		lime: 'border-lime-500/40 bg-lime-500/10 text-lime-400',
		green: 'border-green-500/40 bg-green-500/10 text-green-400',
		emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
		teal: 'border-teal-400/40 bg-teal-400/10 text-teal-400',
		blue: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
		indigo: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-400',
		violet: 'border-violet-500/40 bg-violet-500/10 text-violet-400',
		purple: 'border-purple-500/40 bg-purple-500/10 text-purple-400',
		fuchsia: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400',
		pink: 'border-pink-500/40 bg-pink-500/10 text-pink-400',
		slate: 'border-slate-400/40 bg-slate-400/10 text-slate-400'
	};

	export const COLOR_DOT: Record<string, string> = {
		red: 'bg-red-500',
		orange: 'bg-orange-500',
		amber: 'bg-amber-500',
		yellow: 'bg-yellow-400',
		lime: 'bg-lime-500',
		green: 'bg-green-500',
		emerald: 'bg-emerald-500',
		teal: 'bg-teal-400',
		blue: 'bg-blue-500',
		indigo: 'bg-indigo-500',
		violet: 'bg-violet-500',
		purple: 'bg-purple-500',
		fuchsia: 'bg-fuchsia-500',
		pink: 'bg-pink-500',
		slate: 'bg-slate-400'
	};
</script>

<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import { Tag, Plus, X, Check } from 'lucide-svelte';

	// ── Color palette ─────────────────────────────────────────────────────────

	const COLORS = [
		{ id: 'red', bg: 'bg-red-500', ring: 'ring-red-500' },
		{ id: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
		{ id: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
		{ id: 'yellow', bg: 'bg-yellow-400', ring: 'ring-yellow-400' },
		{ id: 'lime', bg: 'bg-lime-500', ring: 'ring-lime-500' },
		{ id: 'green', bg: 'bg-green-500', ring: 'ring-green-500' },
		{ id: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
		{ id: 'teal', bg: 'bg-teal-400', ring: 'ring-teal-400' },
		{ id: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
		{ id: 'indigo', bg: 'bg-indigo-500', ring: 'ring-indigo-500' },
		{ id: 'violet', bg: 'bg-violet-500', ring: 'ring-violet-500' },
		{ id: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
		{ id: 'fuchsia', bg: 'bg-fuchsia-500', ring: 'ring-fuchsia-500' },
		{ id: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
		{ id: 'slate', bg: 'bg-slate-400', ring: 'ring-slate-400' }
	] as const;

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		selected = $bindable<LabelItem[]>([]),
		max = 10,
		error
	}: {
		selected?: LabelItem[];
		max?: number;
		error?: string;
	} = $props();

	// ── Select popover ────────────────────────────────────────────────────────

	let selectOpen = $state(false);

	const selectedCount = $derived(selected.length);

	function isSelected(name: string) {
		return selected.some((l) => l.name === name);
	}

	function toggle(label: LabelItem) {
		if (isSelected(label.name)) {
			selected = selected.filter((l) => l.name !== label.name);
		} else if (selected.length < max) {
			selected = [...selected, label];
		}
	}

	function removeLabel(name: string) {
		selected = selected.filter((l) => l.name !== name);
	}

	// ── Create popover ────────────────────────────────────────────────────────

	let createOpen = $state(false);
	let newName = $state('');
	let newColor = $state('blue');

	function handleCreate() {
		const name = newName.trim();
		if (!name || selected.length >= max) return;
		if (selected.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
		selected = [...selected, { name, color: newColor }];
		newName = '';
		newColor = 'blue';
		createOpen = false;
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleCreate();
		}
		if (e.key === 'Escape') createOpen = false;
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<!-- Select popover trigger -->
	<Popover.Root bind:open={selectOpen}>
		<Popover.Trigger>
			<button
				type="button"
				class={cn(
					'inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground',
					error && selected.length === 0 && 'border-destructive'
				)}
			>
				<Tag class="size-3.5" />
				Labels ({selectedCount}/{max})
			</button>
		</Popover.Trigger>
		<Popover.Content class="w-64 p-0" align="start" sideOffset={6}>
			<div class="border-b px-3 py-2.5">
				<p class="text-sm font-semibold">Select labels</p>
				<p class="text-xs text-muted-foreground">{selectedCount} of {max} selected</p>
			</div>
			<div class="max-h-64 overflow-y-auto py-1">
				{#each DEFAULT_LABELS as label (label.name)}
					{@const active = isSelected(label.name)}
					{@const disabled = !active && selected.length >= max}
					<button
						type="button"
						onclick={() => toggle(label)}
						{disabled}
						class={cn(
							'flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors',
							active
								? 'text-foreground'
								: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
							disabled && 'cursor-not-allowed opacity-40'
						)}
					>
						<span
							class={cn(
								'size-2.5 shrink-0 rounded-full',
								COLOR_DOT[label.color] ?? COLOR_DOT.slate
							)}
						></span>
						<span class="flex-1">{label.name}</span>
						{#if active}
							<Check class="size-3.5 text-emerald-500" />
						{/if}
					</button>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Create popover trigger (+ button) -->
	<Popover.Root bind:open={createOpen}>
		<Popover.Trigger>
			<button
				type="button"
				class="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
				disabled={selected.length >= max}
			>
				<Plus class="size-3.5" />
			</button>
		</Popover.Trigger>
		<Popover.Content class="w-72 p-4" align="start" sideOffset={6}>
			<p class="mb-3 text-sm font-semibold">Create new label</p>

			<Input
				placeholder="label-name"
				class="h-8 font-mono text-xs"
				bind:value={newName}
				onkeydown={handleCreateKeydown}
				autofocus
			/>

			<p class="mt-3 mb-2 text-xs text-muted-foreground">Color</p>
			<div class="grid grid-cols-8 gap-1.5">
				{#each COLORS as c (c.id)}
					<button
						type="button"
						aria-label="Select {c.label} color"
						onclick={() => (newColor = c.id)}
						class={cn(
							'size-6 rounded-full transition-transform hover:scale-110',
							c.bg,
							newColor === c.id && `ring-2 ring-offset-2 ring-offset-popover ${c.ring}`
						)}
					></button>
				{/each}
			</div>

			<div class="mt-4 flex gap-2">
				<Button class="h-8 flex-1 text-xs" onclick={handleCreate} disabled={!newName.trim()}>
					Create
				</Button>
				<Button variant="outline" class="h-8 text-xs" onclick={() => (createOpen = false)}>
					Cancel
				</Button>
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Selected badges -->
	{#each selected as label (label.name)}
		<span
			class={cn(
				'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
				COLOR_BADGE[label.color] ?? COLOR_BADGE.slate
			)}
		>
			<span class={cn('size-1.5 rounded-full', COLOR_DOT[label.color] ?? COLOR_DOT.slate)}></span>
			{label.name}
			<button
				type="button"
				onclick={() => removeLabel(label.name)}
				class="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
			>
				<X class="size-3" />
			</button>
		</span>
	{/each}
</div>

{#if error}
	<p class="text-[11px] text-destructive">{error}</p>
{/if}
