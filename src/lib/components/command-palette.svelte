<script lang="ts">
	import * as Command from '$lib/components/ui/command';
	import { topItems, menuCategories, bottomItems } from '$lib/nav-data';
	import { goto } from '$app/navigation';

	let open = $state(false);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			open = !open;
		}
	}

	function navigate(href: string) {
		open = false;
		goto(href);
	}

	export function toggle() {
		open = !open;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<Command.Dialog bind:open title="Quick Navigation" description="Search and navigate to any page">
	<Command.Input placeholder="Type to search..." />
	<Command.List>
		<Command.Empty>No results found.</Command.Empty>

		<Command.Group heading="General">
			{#each topItems as item}
				<Command.Item onSelect={() => navigate(item.href)} class="gap-2">
					<item.Icon class="size-4 text-muted-foreground" />
					<span>{item.label}</span>
					<Command.Shortcut>{item.href}</Command.Shortcut>
				</Command.Item>
			{/each}
		</Command.Group>

		{#each menuCategories as category}
			<Command.Group heading={category.label}>
				{#each category.items as item}
					<Command.Item onSelect={() => navigate(item.href)} class="gap-2">
						<item.Icon class="size-4 text-muted-foreground" />
						<span>{item.label}</span>
						<Command.Shortcut>{item.href}</Command.Shortcut>
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}

		<Command.Group heading="System">
			{#each bottomItems as item}
				<Command.Item onSelect={() => navigate(item.href)} class="gap-2">
					<item.Icon class="size-4 text-muted-foreground" />
					<span>{item.label}</span>
					<Command.Shortcut>{item.href}</Command.Shortcut>
				</Command.Item>
			{/each}
		</Command.Group>
	</Command.List>
</Command.Dialog>
