<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		Sidebar,
		SidebarContent,
		SidebarFooter,
		SidebarGroup,
		SidebarGroupContent,
		SidebarGroupLabel,
		SidebarHeader,
		SidebarMenu,
		SidebarMenuButton,
		SidebarMenuItem,
		SidebarRail,
		SidebarSeparator
	} from '$lib/components/ui/sidebar';
	import { ChevronsUpDown, LogOut, Sparkles, BadgeCheck, Bell, Zap } from 'lucide-svelte';
	import * as Accordion from '$lib/components/ui/accordion';
	import { page } from '$app/state';
	import { page as pstore } from '$app/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { topItems, menuCategories, bottomItems, type MenuItem } from '$lib/nav-data';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	interface Props {
		authEnabled: boolean;
		user: {
			id: number;
			username: string;
			displayName: string | null;
			email: string | null;
			isActive: boolean;
		} | null;
	}

	let { authEnabled, user }: Props = $props();

	const displayName = $derived(user?.displayName || user?.username || 'User');
	const userEmail = $derived(user?.email || '');
	const initials = $derived(() => {
		const name = user?.displayName || user?.username || 'AK';
		return name
			.split(/[\s_]/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	});

	const currentPath = $derived($pstore.url.pathname);

	async function handleLogout() {
		try {
			const res = await fetch('/api/auth/logout', { method: 'POST' });
			if (res.ok) {
				goto('/login');
			}
		} catch (err) {
			console.error('[Sidebar] Logout error:', err);
		}
	}

	function getActiveCategory(pathname: string): string {
		for (const cat of menuCategories) {
			if (cat.items.some((item) => pathname === item.href)) return cat.label;
		}
		return menuCategories[0].label;
	}

	function hasCategoryActiveItem(items: readonly MenuItem[]): boolean {
		return items.some((item) => isActive(item.href));
	}
	function isActive(path: string): boolean {
		if (path === '/') return currentPath === '/';
		return currentPath === path || currentPath.startsWith(`${path}/`);
	}

	let manualCategory = $state<string | null>(null);
	let openCategory = $derived(manualCategory ?? getActiveCategory(page.url.pathname));

	// Reset manual override when URL changes
	$effect(() => {
		page.url.pathname;
		manualCategory = null;
	});

	// License tier: null = unknown, 'none' | 'professional' | 'enterprise'
	let licenseTier = $state<'none' | 'professional' | 'enterprise'>('none');

	onMount(async () => {
		try {
			const res = await fetch('/api/license');
			if (res.ok) {
				const data = await res.json();
				if (data.active && data.payload?.type === 'enterprise') licenseTier = 'enterprise';
				else if (data.active && data.payload?.type === 'professional') licenseTier = 'professional';
				else licenseTier = 'none';
			}
		} catch {
			licenseTier = 'none';
		}
	});
</script>

<Sidebar collapsible="icon">
	<!-- Brand -->
	<SidebarHeader class="py-2.5">
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton size="lg" tooltipContent="AutoKube">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground"
							>
								AK
							</div>
							<div class="grid flex-1 text-left text-sm leading-tight">
								<span class="truncate font-semibold">AutoKube</span>
								<span class="truncate text-xs text-muted-foreground">Kubernetes Manager</span>
							</div>
						</a>
					{/snippet}
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	</SidebarHeader>

	<SidebarSeparator />

	<!-- Top Items (Dashboard) -->
	<SidebarContent>
		<SidebarGroup class="pb-0">
			<SidebarMenu>
				{#each topItems as item}
					<SidebarMenuItem>
						<SidebarMenuButton
							isActive={page.url.pathname === item.href}
							tooltipContent={item.label}
						>
							{#snippet child({ props })}
								<a href={item.href} {...props}>
									<item.Icon />
									<span>{item.label}</span>
								</a>
							{/snippet}
						</SidebarMenuButton>
					</SidebarMenuItem>
				{/each}
			</SidebarMenu>
		</SidebarGroup>

		<!-- Category Groups -->
		<Accordion.Root
			type="single"
			value={openCategory}
			onValueChange={(val) => {
				manualCategory = val ?? null;
			}}
		>
			{#each menuCategories as category}
				<Accordion.Item value={category.label} class="border-none">
					<SidebarGroup class="py-1">
						<Accordion.Trigger
							class="group/label flex w-full cursor-pointer items-center rounded-md px-2 py-2 text-xs font-semibold text-sidebar-foreground/70 transition-colors group-data-[state=collapsed]:justify-center hover:bg-sidebar-accent hover:text-sidebar-foreground hover:no-underline"
						>
							<span class="group-data-[state=collapsed]:hidden">{category.label}</span>
							{#if hasCategoryActiveItem(category.items)}
								<span
									class="mr-2 ml-auto h-2 w-2 shrink-0 rounded-full bg-primary group-data-[state=collapsed]:hidden"
									title="{category.label} (active)"
								></span>
							{/if}
						</Accordion.Trigger>
						<Accordion.Content>
							<SidebarGroupContent>
								<SidebarMenu>
									{#each category.items as item}
										<SidebarMenuItem>
											<SidebarMenuButton
												isActive={page.url.pathname === item.href}
												tooltipContent={item.label}
											>
												{#snippet child({ props })}
													<a href={item.href} {...props}>
														<item.Icon />
														<span>{item.label}</span>
														{#if item.badge}
															<Badge
																class="ml-auto h-5 gap-0.5 rounded-md border-0 bg-linear-to-r from-amber-400 to-yellow-500 px-1.5 text-[10px] font-bold text-black shadow-sm"
															>
																<Sparkles class="size-3" />
																{item.badge}
															</Badge>
														{/if}
													</a>
												{/snippet}
											</SidebarMenuButton>
										</SidebarMenuItem>
									{/each}
								</SidebarMenu>
							</SidebarGroupContent>
						</Accordion.Content>
					</SidebarGroup>
				</Accordion.Item>
			{/each}
		</Accordion.Root>

		<SidebarGroup class="py-1">
			<SidebarGroupLabel>System</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{#each bottomItems as item}
						<SidebarMenuItem>
							<SidebarMenuButton
								isActive={page.url.pathname === item.href}
								tooltipContent={item.label}
							>
								{#snippet child({ props })}
									<a href={item.href} {...props}>
										<item.Icon />
										<span>{item.label}</span>
										{#if item.badge}
											<Badge
												class="ml-auto h-5 gap-0.5 rounded-md border-0 bg-linear-to-r from-amber-400 to-yellow-500 px-1.5 text-[10px] font-bold text-black shadow-sm"
											>
												<Sparkles class="size-3" />
												{item.badge}
											</Badge>
										{/if}
									</a>
								{/snippet}
							</SidebarMenuButton>
						</SidebarMenuItem>
					{/each}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	</SidebarContent>

	<!-- User Menu - Only show if auth is enabled and user is logged in -->
	{#if authEnabled && user}
		<SidebarFooter>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<SidebarMenuButton
									{...props}
									size="lg"
									class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
								>
									<Avatar.Root class="h-8 w-8 rounded-lg">
										<Avatar.Fallback class="rounded-lg">{initials()}</Avatar.Fallback>
									</Avatar.Root>
									<div class="grid flex-1 text-left text-sm leading-tight">
										<span class="truncate font-medium">{displayName}</span>
										<span class="truncate text-xs">{userEmail}</span>
									</div>
									<ChevronsUpDown class="ml-auto size-4" />
								</SidebarMenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content
							class="w-[--bits-dropdown-menu-anchor-width] min-w-56 rounded-lg"
							side="bottom"
							align="end"
							sideOffset={4}
						>
							<DropdownMenu.Label class="p-0 font-normal">
								<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar.Root class="h-8 w-8 rounded-lg">
										<Avatar.Fallback class="rounded-lg">{initials()}</Avatar.Fallback>
									</Avatar.Root>
									<div class="grid flex-1 text-left text-sm leading-tight">
										<span class="truncate font-medium">{displayName}</span>
										<span class="truncate text-xs">{userEmail}</span>
									</div>
								</div>
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
								{#if licenseTier !== 'enterprise'}
									<DropdownMenu.Group>
										<DropdownMenu.Item onclick={() => window.open('https://autokube.io/pricing', '_blank')} class="cursor-pointer">
											<Zap class="mr-2 size-4 text-amber-500" />
											<span>{licenseTier === 'professional' ? 'Upgrade to Enterprise' : 'Upgrade to Pro'}</span>
										</DropdownMenu.Item>
									</DropdownMenu.Group>
								{/if}
							<DropdownMenu.Separator />
							<DropdownMenu.Item onclick={handleLogout}>
								<LogOut class="mr-2 size-4" />
								Log out
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarFooter>
	{/if}

	<SidebarRail />
</Sidebar>
