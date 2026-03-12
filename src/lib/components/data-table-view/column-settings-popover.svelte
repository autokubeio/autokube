<script lang="ts">
	import { Settings2, GripVertical, Eye, EyeOff, RotateCcw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cn } from '$lib/utils';
	import { tablePreferencesStore as tableSettingsStore } from './table-settings.svelte';
	import type { ColumnConfig, ColumnSetting } from './types';

	interface Props {
		name: string;
		configurableColumns: ColumnConfig[];
	}

	let { name, configurableColumns }: Props = $props();

	let open = $state(false);
	let columns = $state<ColumnSetting[]>([]);

	// Default preferences from configurable columns
	const defaultPrefs = $derived(configurableColumns.map((col) => ({ id: col.id, visible: true })));

	// Drag-and-drop state
	let draggedColId = $state<string | null>(null);
	let dragOverColId = $state<string | null>(null);

	// Load columns when dropdown opens
	$effect(() => {
		if (open) {
			columns = tableSettingsStore.getAllColumns(name, defaultPrefs);
		}
	});

	// Get column label from config
	function getColumnLabel(id: string): string {
		const config = configurableColumns.find((c) => c.id === id);
		return config?.label || id;
	}

	// Save columns and update grid immediately
	async function saveColumns(newColumns: ColumnSetting[]) {
		columns = newColumns;
		await tableSettingsStore.setColumns(name, columns);
	}

	// Toggle column visibility
	function toggleVisibility(colId: string) {
		const newColumns = columns.map((col) =>
			col.id === colId ? { ...col, visible: !col.visible } : col
		);
		saveColumns(newColumns);
	}

	// Drag & Drop Reorder
	function onDragStart(colId: string) {
		draggedColId = colId;
	}

	function onDragOver(e: DragEvent, colId: string) {
		e.preventDefault();
		dragOverColId = colId;
	}

	function onDrop(targetColId: string) {
		if (!draggedColId || draggedColId === targetColId) return;
		const order = [...columns];
		const from = order.findIndex((c) => c.id === draggedColId);
		const to = order.findIndex((c) => c.id === targetColId);
		order.splice(from, 1);
		order.splice(to, 0, columns[from]);
		saveColumns(order);
		draggedColId = null;
		dragOverColId = null;
	}

	function onDragEnd() {
		draggedColId = null;
		dragOverColId = null;
	}

	// Reset to defaults
	async function resetToDefaults() {
		await tableSettingsStore.resettable(name);
		columns = tableSettingsStore.getAllColumns(name, defaultPrefs);
		open = false;
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="sm"
				class="h-6 w-6 cursor-pointer p-0 text-muted-foreground hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
			>
				<Settings2 class="h-4 w-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-48">
		<div class="border-b p-3">
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium">Columns</span>
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs"
					onclick={resetToDefaults}
					title="Reset to defaults"
				>
					<RotateCcw class="mr-1 h-3 w-3" />
					Reset
				</Button>
			</div>
		</div>
		<div class="py-1">
			{#each columns as column (column.id)}
				{@const isDragging = draggedColId === column.id}
				{@const isOver = dragOverColId === column.id}
				{@const isVisible = column.visible}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					draggable="true"
					ondragstart={() => onDragStart(column.id)}
					ondragover={(e) => onDragOver(e, column.id)}
					ondrop={() => onDrop(column.id)}
					ondragend={onDragEnd}
					onclick={() => toggleVisibility(column.id)}
					onkeydown={(e) => e.key === 'Enter' && toggleVisibility(column.id)}
					role="button"
					tabindex="0"
					class={cn(
						'mx-1 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 transition-colors select-none',
						'hover:bg-accent hover:text-accent-foreground',
						isDragging && 'opacity-40',
						isOver && 'border-t-2 border-primary'
					)}
				>
					<GripVertical
						class="size-3 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
					/>
					{#if isVisible}
						<Eye class="size-3.5 shrink-0 text-primary" />
					{:else}
						<EyeOff class="size-3.5 shrink-0 text-muted-foreground opacity-50" />
					{/if}
					<span class="text-xs capitalize">{getColumnLabel(column.id)}</span>
				</div>
			{/each}
		</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>
