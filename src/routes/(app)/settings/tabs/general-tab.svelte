<script lang="ts">
	import AccessRestricted from '$lib/components/access-restricted.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import { mode, setMode } from 'mode-watcher';
	import {
		Sun,
		Moon,
		Type,
		Terminal,
		Code,
		Grid3x3,
		BarChart3,
		TableProperties,
		Tags,
		Trash2,
		ShieldCheck,
		Clock,
		Layers,
		Loader2,
		Save
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';

	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		UI_FONTS,
		MONO_FONTS,
		FONT_SIZES,
		LIGHT_THEMES,
		DARK_THEMES,
		applyThemeClass
	} from '$lib/theme-utils';

	const lightPreview = $derived(
		LIGHT_THEMES.find((t) => t.id === settingsStore.lightTheme)?.preview
	);
	const darkPreview = $derived(DARK_THEMES.find((t) => t.id === settingsStore.darkTheme)?.preview);

	$effect(() => {
		const isDark = mode.current === 'dark';
		const themeId = isDark ? settingsStore.darkTheme : settingsStore.lightTheme;
		applyThemeClass(themeId);
	});

	// ── Scan settings (server-side) ───────────────────────────────────────

	let scanCron = $state('0 2 * * *');
	let scanConcurrency = $state(5);
	let scanLoading = $state(true);
	let scanSaving = $state(false);

	const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 8, 10, 15, 20];

	onMount(async () => {
		try {
			const res = await fetch('/api/settings/scan');
			if (res.ok) {
				const data = await res.json();
				scanCron = data.cronExpression ?? '0 2 * * *';
				scanConcurrency = data.concurrency ?? 5;
			}
		} catch {
			console.error('[Settings] Failed to load scan settings');
		} finally {
			scanLoading = false;
		}
	});

	async function saveScanSettings() {
		scanSaving = true;
		try {
			const res = await fetch('/api/settings/scan', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cronExpression: scanCron,
					concurrency: scanConcurrency
				})
			});
			if (res.ok) {
				const data = await res.json();
				scanCron = data.cronExpression;
				scanConcurrency = data.concurrency;
				toast.success('Scan settings saved');
			} else {
				const data = await res.json();
				toast.error(data.error ?? 'Failed to save scan settings');
			}
		} catch {
			toast.error('Failed to save scan settings');
		} finally {
			scanSaving = false;
		}
	}

	interface Props { canAccess?: boolean; }
	let { canAccess = true }: Props = $props();
</script>

{#if !canAccess}
<AccessRestricted message="You don't have permission to manage general settings. Contact your administrator." />
{:else}
<div class="space-y-6">
	<!-- Appearance -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Appearance</Card.Title>
			<Card.Description>Customize how AutoKube looks.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6">
			<!-- Color Mode -->
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium">Color Mode</p>
					<p class="text-xs text-muted-foreground">Switches the active color scheme</p>
				</div>
				<div class="flex items-center rounded-lg border p-1">
					<button
						class={cn(
							'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
							mode.current === 'light'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'
						)}
						onclick={() => setMode('light')}
					>
						<Sun class="size-3.5" />
						Light
					</button>
					<button
						class={cn(
							'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
							mode.current === 'dark'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'
						)}
						onclick={() => setMode('dark')}
					>
						<Moon class="size-3.5" />
						Dark
					</button>
				</div>
			</div>

			<!-- Theme selectors -->
			<div class="grid grid-cols-2 gap-6">
				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<Sun class="size-3.5" />
						Light Theme
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.lightTheme}
						onValueChange={(v) => {
							if (v) settingsStore.lightTheme = v;
						}}
					>
						<Select.Trigger class="w-full">
							<div class="flex items-center gap-2">
								{#if lightPreview}
									<div class="flex items-center gap-0.5">
										<span class="size-2 rounded-full" style:background={lightPreview.primary}
										></span>
										<span class="size-2 rounded-full" style:background={lightPreview.fg}></span>
									</div>
								{/if}
								{LIGHT_THEMES.find((t) => t.id === settingsStore.lightTheme)?.name ??
									'Select theme'}
							</div>
						</Select.Trigger>
						<Select.Content class="max-h-64">
							{#each LIGHT_THEMES as theme}
								<Select.Item value={theme.id}>
									<div class="flex items-center gap-2">
										<div class="flex items-center gap-0.5">
											<span
												class="size-2.5 rounded-full border"
												style:background={theme.preview.primary}
											></span>
											<span class="size-2.5 rounded-full border" style:background={theme.preview.fg}
											></span>
										</div>
										{theme.name}
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<Moon class="size-3.5" />
						Dark Theme
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.darkTheme}
						onValueChange={(v) => {
							if (v) settingsStore.darkTheme = v;
						}}
					>
						<Select.Trigger class="w-full">
							<div class="flex items-center gap-2">
								{#if darkPreview}
									<div class="flex items-center gap-0.5">
										<span class="size-2 rounded-full" style:background={darkPreview.primary}></span>
										<span class="size-2 rounded-full" style:background={darkPreview.fg}></span>
									</div>
								{/if}
								{DARK_THEMES.find((t) => t.id === settingsStore.darkTheme)?.name ?? 'Select theme'}
							</div>
						</Select.Trigger>
						<Select.Content class="max-h-64">
							{#each DARK_THEMES as theme}
								<Select.Item value={theme.id}>
									<div class="flex items-center gap-2">
										<div class="flex items-center gap-0.5">
											<span
												class="size-2.5 rounded-full border"
												style:background={theme.preview.primary}
											></span>
											<span class="size-2.5 rounded-full border" style:background={theme.preview.fg}
											></span>
										</div>
										{theme.name}
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Typography -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>Typography</Card.Title
			>
		</Card.Header>
		<Card.Content class="space-y-6">
			<div class="grid grid-cols-2 gap-6">
				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<Type class="size-3.5" />
						UI font
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.font}
						onValueChange={(v) => {
							if (v) settingsStore.font = v;
						}}
					>
						<Select.Trigger class="w-fit">
							{UI_FONTS.find((f) => f.id === settingsStore.font)?.name ?? 'Select font'}
						</Select.Trigger>
						<Select.Content class="max-h-64">
							{#each UI_FONTS as font}
								<Select.Item value={font.id}>{font.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<span class="text-xs font-bold">A+</span>
						Font size
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.fontSize}
						onValueChange={(v) => {
							if (v) settingsStore.fontSize = v;
						}}
					>
						<Select.Trigger class="w-fit">
							{FONT_SIZES.find((f) => f.id === settingsStore.fontSize)?.name ?? 'Select size'}
						</Select.Trigger>
						<Select.Content>
							{#each FONT_SIZES as size}
								<Select.Item value={size.id}>{size.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<Terminal class="size-3.5" />
						Terminal font
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.terminalFont}
						onValueChange={(v) => {
							if (v) settingsStore.terminalFont = v;
						}}
					>
						<Select.Trigger class="w-fit">
							{MONO_FONTS.find((f) => f.id === settingsStore.terminalFont)?.name ?? 'Select font'}
						</Select.Trigger>
						<Select.Content>
							{#each MONO_FONTS as font}
								<Select.Item value={font.id}>{font.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<Label class="flex items-center gap-1.5 text-sm">
						<Code class="size-3.5" />
						Editor font
					</Label>
					<Select.Root
						type="single"
						value={settingsStore.editorFont}
						onValueChange={(v) => {
							if (v) settingsStore.editorFont = v;
						}}
					>
						<Select.Trigger class="w-fit">
							{MONO_FONTS.find((f) => f.id === settingsStore.editorFont)?.name ?? 'Select font'}
						</Select.Trigger>
						<Select.Content>
							{#each MONO_FONTS as font}
								<Select.Item value={font.id}>{font.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
		</Card.Content>
	</Card.Root>



	<!-- Toggle Settings -->
	<div class="space-y-1.5">
		<div class="flex items-center justify-between px-1">
			<h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display</h3>
		</div>
		<div class="rounded-lg border divide-y">
			<div class="flex items-center justify-between px-4 py-3">
				<div class="space-y-0.5">
					<Label class="flex items-center gap-1.5 text-sm font-medium">
						<BarChart3 class="size-3.5" />
						Show resource usage
					</Label>
					<p class="text-xs text-muted-foreground">CPU and memory bars in the cluster status bar</p>
				</div>
				<Switch
					checked={settingsStore.showResourceUsage}
					onCheckedChange={(v) => (settingsStore.showResourceUsage = v)}
				/>
			</div>
			<div class="flex items-center justify-between px-4 py-3">
				<div class="space-y-0.5">
					<Label class="flex items-center gap-1.5 text-sm font-medium">
						<Tags class="size-3.5" />
						Show namespace badges
					</Label>
					<p class="text-xs text-muted-foreground">Color-code namespace badges by environment</p>
				</div>
				<Switch
					checked={settingsStore.showNamespaceBadges}
					onCheckedChange={(v) => (settingsStore.showNamespaceBadges = v)}
				/>
			</div>
			<div class="flex items-center justify-between px-4 py-3">
				<div class="space-y-0.5">
					<Label class="flex items-center gap-1.5 text-sm font-medium">
						<TableProperties class="size-3.5" />
						Compact table rows
					</Label>
					<p class="text-xs text-muted-foreground">Reduce row height for denser data tables</p>
				</div>
				<Switch
					checked={settingsStore.compactTableRows}
					onCheckedChange={(v) => (settingsStore.compactTableRows = v)}
				/>
			</div>
			<div class="flex items-center justify-between px-4 py-3">
				<div class="space-y-0.5">
					<Label class="flex items-center gap-1.5 text-sm font-medium">
						<Trash2 class="size-3.5" />
						Confirm before delete
					</Label>
					<p class="text-xs text-muted-foreground">Show confirmation popover before deleting resources</p>
				</div>
				<Switch
					checked={settingsStore.confirmDelete}
					onCheckedChange={(v) => (settingsStore.confirmDelete = v)}
				/>
			</div>
		</div>
	</div>

	<!-- Security Scanning -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<ShieldCheck class="size-4" />
				Security Scanning
			</Card.Title>
			<Card.Description>Configure automated vulnerability scan schedule and concurrency.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6">
			{#if scanLoading}
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" />
					Loading scan settings…
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-6">
					<div class="space-y-2">
						<Label class="flex items-center gap-1.5 text-sm">
							<Clock class="size-3.5" />
							Scan Schedule (Cron)
						</Label>
						<Input
							bind:value={scanCron}
							placeholder="0 2 * * *"
							class="font-mono text-sm"
						/>
						<p class="text-xs text-muted-foreground">
							UTC cron expression — e.g. <code class="rounded bg-muted px-1">0 2 * * *</code> = daily at 2 AM
						</p>
					</div>

					<div class="space-y-2">
						<Label class="flex items-center gap-1.5 text-sm">
							<Layers class="size-3.5" />
							Parallel Scans
						</Label>
						<Select.Root
							type="single"
							value={String(scanConcurrency)}
							onValueChange={(v: string) => {
								if (v) scanConcurrency = Number(v);
							}}
						>
							<Select.Trigger class="w-fit">
								{scanConcurrency} parallel {scanConcurrency === 1 ? 'scan' : 'scans'}
							</Select.Trigger>
							<Select.Content>
								{#each CONCURRENCY_OPTIONS as opt}
									<Select.Item value={String(opt)}>{opt}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-muted-foreground">
							Number of images scanned simultaneously
						</p>
					</div>
				</div>

				<div class="flex justify-end">
					<Button size="sm" onclick={saveScanSettings} disabled={scanSaving}>
						{#if scanSaving}
							<Loader2 class="size-4 animate-spin" />
						{:else}
							<Save class="size-4" />
						{/if}
						Save Scan Settings
					</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
{/if}
