<script lang="ts">
	import AccessRestricted from '$lib/components/access-restricted.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		Bell,
		Plus,
		Mail,
		Zap,
		Trash2,
		Pencil,
		Send,
		CheckCircle2,
		AlertCircle,
		Loader2,
		ChevronDown,
		MessageCircle,
		Hash,
		Webhook
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { NOTIFICATION_EVENT_TYPES } from '$lib/notifications-constants';
	import type { ResolvedChannel } from '$lib/server/queries/notifications';

	// ── State ──────────────────────────────────────────────────────────────
	let channels = $state<ResolvedChannel[]>([]);
	let loading = $state(true);
	let dialogOpen = $state(false);
	let editingChannel = $state<ResolvedChannel | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state('');
	let testSuccess = $state<boolean | null>(null);

	// Form fields
	let form = $state({
		name: '',
		enabled: true,
		type: 'smtp' as 'smtp' | 'apprise',
		// smtp
		smtpHost: '',
		smtpPort: '587',
		smtpTls: false,
		smtpAuthRequired: false,
		smtpUsername: '',
		smtpPassword: '',
		smtpFromAddress: '',
		smtpFromName: 'AutoKube Alerts',
		smtpTo: '',
		// apprise
		appriseUrl: '',
		appriseScheme: 'tgram' as 'tgram' | 'discord' | 'slack' | 'json' | 'custom'
	});

	let errors = $state<Record<string, string>>({});

	// ── Lifecycle ──────────────────────────────────────────────────────────
	onMount(loadChannels);
	// Clear test result when switching between SMTP/Apprise
	$effect(() => {
		void form.type;
		testResult = '';
		testSuccess = null;
	});
	async function loadChannels() {
		loading = true;
		try {
			const res = await fetch('/api/notifications');
			if (res.ok) {
				const data = await res.json();
				channels = data.channels ?? [];
			}
		} catch (err) {
			console.error('[Notifications] Failed to load:', err);
		} finally {
			loading = false;
		}
	}

	// ── Dialog helpers ─────────────────────────────────────────────────────
	function openAdd() {
		editingChannel = null;
		form = {
			name: '',
			enabled: true,
			type: 'smtp',
			smtpHost: '',
			smtpPort: '587',
			smtpTls: false,
			smtpAuthRequired: false,
			smtpUsername: '',
			smtpPassword: '',
			smtpFromAddress: '',
			smtpFromName: 'AutoKube Alerts',
			smtpTo: '',
			appriseUrl: '',
			appriseScheme: 'tgram'
		};
		errors = {};
		testResult = '';
		testSuccess = null;
		dialogOpen = true;
	}

	function openEdit(ch: ResolvedChannel) {
		editingChannel = ch;
		const cfg = ch.config as unknown as Record<string, unknown>;
		if (ch.type === 'smtp') {
			form = {
				name: ch.name,
				enabled: ch.enabled,
				type: 'smtp',
				smtpHost: String(cfg.host ?? ''),
				smtpPort: String(cfg.port ?? '587'),
				smtpTls: Boolean(cfg.secure),
				smtpAuthRequired: !!cfg.username,
				smtpUsername: String(cfg.username ?? ''),
				smtpPassword: String(cfg.password ?? ''),
				smtpFromAddress: String(cfg.from_email ?? ''),
				smtpFromName: String(cfg.from_name ?? ''),
				smtpTo: Array.isArray(cfg.to_emails) ? (cfg.to_emails as string[]).join(', ') : '',
				appriseUrl: '',
				appriseScheme: 'tgram'
			};
		} else {
			const urls = Array.isArray(cfg.urls) ? (cfg.urls as string[]) : [];
			const url = urls[0] ?? '';
			form = {
				name: ch.name,
				enabled: ch.enabled,
				type: 'apprise',
				smtpHost: '',
				smtpPort: '587',
				smtpTls: false,
				smtpAuthRequired: false,
				smtpUsername: '',
				smtpPassword: '',
				smtpFromAddress: '',
				smtpFromName: 'AutoKube Alerts',
				smtpTo: '',
				appriseUrl: url,
				appriseScheme: detectScheme(url)
			};
		}
		errors = {};
		testResult = '';
		testSuccess = null;
		dialogOpen = true;
	}

	/** Detect Apprise scheme from URL for the sub-type selector. */
	function detectScheme(url: string): 'tgram' | 'discord' | 'slack' | 'json' | 'custom' {
		const lower = url.toLowerCase();
		if (lower.startsWith('tgram://')) return 'tgram';
		if (lower.startsWith('discord://')) return 'discord';
		if (lower.startsWith('slack://')) return 'slack';
		if (lower.startsWith('json://') || lower.startsWith('jsons://')) return 'json';
		return 'custom';
	}

	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!form.name.trim()) e.name = 'Channel name is required';
		if (form.type === 'smtp') {
			if (!form.smtpHost.trim()) e.smtpHost = 'Host is required';
			if (!form.smtpFromAddress.trim()) e.smtpFromAddress = 'From address is required';
			if (!form.smtpTo.trim()) e.smtpTo = 'At least one recipient is required';
		} else {
			if (!form.appriseUrl.trim()) e.appriseUrl = 'Apprise URL is required';
		}
		errors = e;
		return Object.keys(e).length === 0;
	}

	async function saveChannel() {
		if (!validate()) return;
		saving = true;
		try {
			const body = { ...form };
			const url = editingChannel ? `/api/notifications/${editingChannel.id}` : '/api/notifications';
			const method = editingChannel ? 'PATCH' : 'POST';
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				dialogOpen = false;
				await loadChannels();
			} else {
				const data = await res.json();
				errors.general = data.error ?? 'Failed to save channel';
			}
		} catch (err) {
			console.error('[Notifications] Save error:', err);
			errors.general = 'Unexpected error';
		} finally {
			saving = false;
		}
	}

	async function deleteChannel(id: number) {
		try {
			const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
			if (res.ok) await loadChannels();
		} catch (err) {
			console.error('[Notifications] Delete error:', err);
		}
	}

	async function toggleChannel(ch: ResolvedChannel) {
		try {
			await fetch(`/api/notifications/${ch.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !ch.enabled })
			});
			await loadChannels();
		} catch (err) {
			console.error('[Notifications] Toggle error:', err);
		}
	}

	async function sendTest() {
		testing = true;
		testResult = '';
		testSuccess = null;
		try {
			const res = await fetch('/api/notifications/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form)
			});
			const data = await res.json();
			if (res.ok) {
				testSuccess = true;
				testResult = data.message ?? 'Test notification sent successfully!';
			} else {
				testSuccess = false;
				testResult = data.error ?? 'Failed to send test notification';
			}
		} catch (err) {
			testSuccess = false;
			testResult = err instanceof Error ? err.message : 'Network error - failed to send test';
		} finally {
			testing = false;
		}
	}

	// ── Computed ───────────────────────────────────────────────────────────
	function channelSummary(ch: ResolvedChannel): string {
		const cfg = ch.config as unknown as Record<string, unknown>;
		if (ch.type === 'smtp') {
			const to = Array.isArray(cfg.to_emails) ? (cfg.to_emails as string[]).join(', ') : '';
			return `${cfg.host}:${cfg.port} → ${to}`;
		}
		const urls = Array.isArray(cfg.urls) ? (cfg.urls as string[]) : [];
		return urls[0] ? maskUrl(urls[0]) : '';
	}

	function maskUrl(url: string): string {
		// tgram://BOT_TOKEN/CHAT_ID — mask the token segment after ://
		if (/^tgram:\/\//i.test(url)) {
			return url.replace(/(tgram:\/\/)([^/]+)(\/.*)?$/i, (_, scheme, token, rest) => {
				const visible = token.slice(0, 6);
				return `${scheme}${visible}••••${rest ?? ''}`;
			});
		}
		// discord://WebhookID/WebhookToken — mask the token
		if (/^discord:\/\//i.test(url)) {
			return url.replace(/(discord:\/\/[^/]+\/)(.+)$/i, (_, prefix, token) => {
				return `${prefix}${token.slice(0, 4)}••••`;
			});
		}
		// slack://TokenA/TokenB/TokenC — mask TokenB and TokenC
		if (/^slack:\/\//i.test(url)) {
			return url.replace(/(slack:\/\/[^/]+\/)(.+)$/i, (_, prefix) => {
				return `${prefix}••••/••••`;
			});
		}
		// json:// or jsons:// — show host, mask path
		if (/^jsons?:\/\//i.test(url)) {
			const match = url.match(/^(jsons?:\/\/[^/]+)(\/.*)?$/i);
			if (match) return `${match[1]}${match[2] ? '/••••' : ''}`;
		}
		// Generic: mask user:pass@host style credentials
		return url.replace(/(:\/\/[^:@]*:[^@]*)@/, '://••••@').replace(/(\/[^/]{4})[^/]+$/, '$1••••');
	}

	/** Get a friendly label for the Apprise URL scheme shown in the channel list. */
	function channelSchemeLabel(url: string): string {
		const lower = url.toLowerCase();
		if (lower.startsWith('tgram://')) return 'Telegram';
		if (lower.startsWith('discord://')) return 'Discord';
		if (lower.startsWith('slack://')) return 'Slack';
		if (lower.startsWith('json://') || lower.startsWith('jsons://')) return 'Webhook';
		return 'Apprise';
	}

	function channelsForEvent(eventId: string): ResolvedChannel[] {
		return channels.filter((ch) => ch.enabled && ch.eventTypes.includes(eventId as never));
	}

	// ── Apprise scheme helpers ─────────────────────────────────────────────
	const appriseSchemeLabel = $derived(
		({
			tgram: 'Telegram Bot URL',
			discord: 'Discord Webhook URL',
			slack: 'Slack Webhook URL',
			json: 'Webhook endpoint URL',
			custom: 'Any Apprise URL'
		})[form.appriseScheme]
	);

	const apprisePlaceholder = $derived(
		({
			tgram: 'tgram://BotToken/ChatID',
			discord: 'discord://WebhookID/WebhookToken',
			slack: 'slack://TokenA/TokenB/TokenC',
			json: 'json://hostname:port/path  or  jsons://hostname/path',
			custom: 'scheme://...'
		})[form.appriseScheme]
	);

	const appriseHelpText = $derived(
		({
			tgram: 'Create a bot via @BotFather, then use tgram://BOT_TOKEN/CHAT_ID. Multiple chat IDs: tgram://TOKEN/ID1/ID2',
			discord: 'Go to Server Settings → Integrations → Webhooks → Copy URL, then use discord://WEBHOOK_ID/WEBHOOK_TOKEN',
			slack: 'Create an Incoming Webhook in your Slack app, then use slack://TOKEN_A/TOKEN_B/TOKEN_C from the webhook URL',
			json: 'POST a JSON payload to any HTTP endpoint. Use json:// for HTTP, jsons:// for HTTPS',
			custom: 'Any Apprise-compatible URL. Requires APPRISE_API_URL env var for unsupported schemes.'
		})[form.appriseScheme]
	);

	/** Check if a specific channel is subscribed to an event (regardless of enabled state) */
	function isChannelSubscribed(channelId: number, eventId: string): boolean {
		const ch = channels.find((c) => c.id === channelId);
		return ch ? ch.eventTypes.includes(eventId as never) : false;
	}

	/** Toggle a single event for a single channel (add/remove from eventTypes) */
	async function toggleEventForChannel(channel: ResolvedChannel, eventId: string) {
		const hasEvent = channel.eventTypes.includes(eventId as never);
		const newEventTypes = hasEvent
			? channel.eventTypes.filter((e) => e !== eventId)
			: [...channel.eventTypes, eventId as never];

		try {
			await fetch(`/api/notifications/${channel.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ eventTypes: newEventTypes })
			});
			await loadChannels();
		} catch (err) {
			console.error('[Notifications] Toggle event error:', err);
		}
	}

	/** Toggle an entire alert rule on/off — removes or adds the event from all channels */
	async function toggleAlertRule(eventId: string) {
		const subscribed = channels.filter((ch) => ch.eventTypes.includes(eventId as never));
		const turnOff = subscribed.length > 0;

		try {
			const promises = turnOff
				? subscribed.map((ch) =>
						fetch(`/api/notifications/${ch.id}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								eventTypes: ch.eventTypes.filter((e) => e !== eventId)
							})
						})
					)
				: channels.map((ch) =>
						fetch(`/api/notifications/${ch.id}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								eventTypes: [...ch.eventTypes, eventId as never]
							})
						})
					);
			await Promise.all(promises);
			await loadChannels();
		} catch (err) {
			console.error('[Notifications] Toggle alert rule error:', err);
		}
	}

	interface Props { canAccess?: boolean; }
	let { canAccess = true }: Props = $props();
</script>

{#if !canAccess}
<AccessRestricted message="You don't have permission to manage notification settings. Contact your administrator." />
{:else}
<!-- Header -->
<div class="flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">Notification Channels</h2>
			<Badge variant="secondary" class="text-xs">{channels.length}</Badge>
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">Configure where alerts are delivered</p>
	</div>
	<Button size="sm" class="gap-1.5 text-xs" onclick={openAdd}>
		<Plus class="size-3" />
		Add Channel
	</Button>
</div>

<!-- Channel list -->
<div class="mt-4 space-y-2">
	{#if loading && channels.length === 0}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="size-4 animate-spin text-muted-foreground" />
		</div>
	{:else if channels.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12"
		>
			<Bell class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No notification channels configured</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAdd}>
				<Plus class="size-3" /> Add your first channel
			</Button>
		</div>
	{:else}
		{#each channels as ch (ch.id)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Icon -->
				<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
					{#if ch.type === 'apprise'}
						{@const urls = (ch.config as unknown as { urls?: string[] }).urls ?? []}
						{@const scheme = urls[0]?.toLowerCase() ?? ''}
						{#if scheme.startsWith('discord://')}
							<MessageCircle class="size-4 text-indigo-500" />
						{:else if scheme.startsWith('slack://')}
							<Hash class="size-4 text-green-500" />
						{:else if scheme.startsWith('json://') || scheme.startsWith('jsons://')}
							<Webhook class="size-4 text-orange-500" />
						{:else}
							<Zap class="size-4 text-yellow-500" />
						{/if}
					{:else}
						<Mail class="size-4 text-blue-500" />
					{/if}
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-sm font-medium">{ch.name}</span>
						<Badge variant="secondary" class="font-mono text-[10px] capitalize">
							{#if ch.type === 'apprise'}
								{@const urls = (ch.config as unknown as { urls?: string[] }).urls ?? []}
								{channelSchemeLabel(urls[0] ?? '')}
							{:else}
								SMTP
							{/if}
						</Badge>
						{#if ch.enabled}
							<Badge variant="outline" class="text-[10px]">
								<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>
								Enabled
							</Badge>
						{:else}
							<Badge variant="outline" class="text-[10px] text-muted-foreground">
								<span class="mr-1 inline-block size-1.5 rounded-full bg-muted-foreground"></span>
								Disabled
							</Badge>
						{/if}
					</div>
					<p class="mt-0.5 truncate text-xs text-muted-foreground">{channelSummary(ch)}</p>
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Switch
						checked={ch.enabled}
						onCheckedChange={() => toggleChannel(ch)}
						aria-label="Toggle channel"
					/>
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => openEdit(ch)}
					>
						<Pencil class="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-destructive"
						onclick={() => deleteChannel(ch.id)}
					>
						<Trash2 class="size-3.5" />
					</Button>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- Alert Rules Section -->
<div class="mt-6">
	<div class="mb-3">
		<h3 class="text-base font-semibold">Alert Rules</h3>
		<p class="text-sm text-muted-foreground">
			Choose which events trigger alerts and which channel receives them
		</p>
	</div>

	<div class="overflow-hidden rounded-lg border bg-card">
		<!-- Table header -->
		<div class="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b bg-muted/40 px-4 py-2">
			<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Event</span>
			<span
				class="w-44 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>Channel</span
			>
			<span class="w-8 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>On</span
			>
		</div>
		<!-- Rows -->
		<div class="divide-y">
			{#each NOTIFICATION_EVENT_TYPES as event (event.id)}
				{@const eventChannels = channelsForEvent(event.id)}
				{@const anySubscribed = channels.some((ch) => ch.eventTypes.includes(event.id as never))}
				<div class="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3">
					<div>
						<p class="text-sm font-medium">{event.label}</p>
						<p class="text-xs text-muted-foreground">{event.description}</p>
					</div>
					<div class="flex w-44 items-center justify-end">
						{#if channels.length === 0}
							<span class="text-xs text-muted-foreground/50">No channels</span>
						{:else}
							<Popover.Root>
								<Popover.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											class="inline-flex h-8 items-center gap-1.5 rounded-md border bg-transparent px-2.5 text-xs shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										>
											{#if eventChannels.length === 0}
												<span class="text-muted-foreground">None</span>
											{:else if eventChannels.length === 1}
												{#if eventChannels[0].type === 'apprise'}
													<Zap class="size-3 text-yellow-500" />
												{:else}
													<Mail class="size-3 text-blue-500" />
												{/if}
												<span class="max-w-20 truncate">{eventChannels[0].name}</span>
											{:else}
												<span class="text-muted-foreground">{eventChannels.length} channels</span>
											{/if}
											<ChevronDown class="size-3 shrink-0 text-muted-foreground/70" />
										</button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-48 p-1" align="end" sideOffset={4}>
									<div class="space-y-0.5">
										{#each channels as ch (ch.id)}
											<button
												class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] transition-colors hover:bg-muted"
												onclick={() => toggleEventForChannel(ch, event.id)}
											>
												<Checkbox
													checked={isChannelSubscribed(ch.id, event.id)}
													class="pointer-events-none size-3.5"
												/>
												{#if ch.type === 'apprise'}
													<Zap class="size-3 shrink-0 text-yellow-500" />
												{:else}
													<Mail class="size-3 shrink-0 text-blue-500" />
												{/if}
												<span class="truncate">{ch.name}</span>
												{#if !ch.enabled}
													<span class="ml-auto text-[9px] text-muted-foreground">off</span>
												{/if}
											</button>
										{/each}
									</div>
								</Popover.Content>
							</Popover.Root>
						{/if}
					</div>
					<div class="flex w-8 justify-end">
						<Switch
							checked={anySubscribed}
							onCheckedChange={() => toggleAlertRule(event.id)}
							disabled={channels.length === 0}
							aria-label={event.label}
						/>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<!-- Add / Edit Channel Dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{editingChannel ? 'Edit' : 'Add'} Notification Channel</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Name + Enabled -->
			<div class="flex items-end gap-3">
				<div class="flex-1 space-y-1.5">
					<Label for="ch-name">Channel name <span class="text-destructive">*</span></Label>
					<Input
						id="ch-name"
						placeholder="e.g. Ops Alerts"
						bind:value={form.name}
						class={errors.name ? 'border-destructive' : ''}
					/>
					{#if errors.name}<p class="text-xs text-destructive">{errors.name}</p>{/if}
				</div>
				<div class="flex flex-col items-center gap-1 pb-0.5">
					<Label class="text-xs">Enabled</Label>
					<Switch bind:checked={form.enabled} />
				</div>
			</div>

			<!-- Type toggle -->
			<div class="space-y-1.5">
				<Label>Type</Label>
				<Tabs.Root
					value={form.type}
					onValueChange={(v) => {
						if (v === 'smtp' || v === 'apprise') form.type = v;
					}}
					class="w-full"
				>
					<Tabs.List class="w-full">
						<Tabs.Trigger value="smtp" class="flex-1 gap-2">
							<Mail class="size-3.5" />
							SMTP
						</Tabs.Trigger>
						<Tabs.Trigger value="apprise" class="flex-1 gap-2">
							<Zap class="size-3.5" />
							Apprise
						</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>
			</div>

			<Separator />

			{#if form.type === 'smtp'}
				<!-- SMTP Fields -->
				<div class="grid grid-cols-[1fr_120px] gap-3">
					<div class="space-y-1.5">
						<Label for="smtp-host"
							>Host <span class="text-xs text-muted-foreground">SMTP server hostname</span></Label
						>
						<Input
							id="smtp-host"
							placeholder="smtp.gmail.com"
							bind:value={form.smtpHost}
							class={errors.smtpHost ? 'border-destructive' : ''}
						/>
						{#if errors.smtpHost}<p class="text-xs text-destructive">{errors.smtpHost}</p>{/if}
					</div>
					<div class="space-y-1.5">
						<Label for="smtp-port">Port</Label>
						<Input id="smtp-port" type="number" bind:value={form.smtpPort} />
					</div>
				</div>

				<div class="flex items-center justify-between rounded-md border px-3 py-2.5">
					<div>
						<p class="text-sm font-medium">TLS / SSL</p>
						<p class="text-xs text-muted-foreground">Encrypt connection</p>
					</div>
					<Switch bind:checked={form.smtpTls} />
				</div>

				<div class="flex items-center justify-between rounded-md border px-3 py-2.5">
					<div>
						<p class="text-sm font-medium">Authentication</p>
						<p class="text-xs text-muted-foreground">Require username &amp; password</p>
					</div>
					<Switch bind:checked={form.smtpAuthRequired} />
				</div>

				{#if form.smtpAuthRequired}
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1.5">
							<Label for="smtp-user">Username</Label>
							<Input id="smtp-user" bind:value={form.smtpUsername} />
						</div>
						<div class="space-y-1.5">
							<Label for="smtp-pass">Password</Label>
							<Input id="smtp-pass" type="password" bind:value={form.smtpPassword} />
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="smtp-from"
							>From address <span class="text-xs text-muted-foreground">Sender email</span></Label
						>
						<Input
							id="smtp-from"
							placeholder="alerts@example.com"
							bind:value={form.smtpFromAddress}
							class={errors.smtpFromAddress ? 'border-destructive' : ''}
						/>
						{#if errors.smtpFromAddress}<p class="text-xs text-destructive">
								{errors.smtpFromAddress}
							</p>{/if}
					</div>
					<div class="space-y-1.5">
						<Label for="smtp-fname"
							>From name <span class="text-xs text-muted-foreground">Display name</span></Label
						>
						<Input id="smtp-fname" bind:value={form.smtpFromName} />
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="smtp-to"
						>To <span class="text-xs text-muted-foreground">Comma-separated recipients</span></Label
					>
					<Input
						id="smtp-to"
						placeholder="admin@example.com, ops@example.com"
						bind:value={form.smtpTo}
						class={errors.smtpTo ? 'border-destructive' : ''}
					/>
					{#if errors.smtpTo}<p class="text-xs text-destructive">{errors.smtpTo}</p>{/if}
				</div>
			{:else}
				<!-- Apprise Fields -->
				<div class="space-y-1.5">
					<Label>Service</Label>
					<div class="grid grid-cols-5 gap-1.5">
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors hover:bg-muted/60 {form.appriseScheme === 'tgram' ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}"
							onclick={() => (form.appriseScheme = 'tgram')}
						>
							<Send class="size-4" />
							Telegram
						</button>
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors hover:bg-muted/60 {form.appriseScheme === 'discord' ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}"
							onclick={() => (form.appriseScheme = 'discord')}
						>
							<MessageCircle class="size-4" />
							Discord
						</button>
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors hover:bg-muted/60 {form.appriseScheme === 'slack' ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}"
							onclick={() => (form.appriseScheme = 'slack')}
						>
							<Hash class="size-4" />
							Slack
						</button>
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors hover:bg-muted/60 {form.appriseScheme === 'json' ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}"
							onclick={() => (form.appriseScheme = 'json')}
						>
							<Webhook class="size-4" />
							Webhook
						</button>
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors hover:bg-muted/60 {form.appriseScheme === 'custom' ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}"
							onclick={() => (form.appriseScheme = 'custom')}
						>
							<Zap class="size-4" />
							Custom
						</button>
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="apprise-url"
						>Apprise URL <span class="text-xs text-muted-foreground">{appriseSchemeLabel}</span
						></Label
					>
					<Input
						id="apprise-url"
						placeholder={apprisePlaceholder}
						bind:value={form.appriseUrl}
						class={errors.appriseUrl ? 'border-destructive' : ''}
					/>
					{#if errors.appriseUrl}<p class="text-xs text-destructive">{errors.appriseUrl}</p>{/if}
					<p class="text-xs text-muted-foreground">
						{appriseHelpText}
					</p>
				</div>
			{/if}

			{#if errors.general}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{errors.general}
				</p>
			{/if}

			{#if testing}
				<div class="flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
					<Loader2 class="size-4 animate-spin text-muted-foreground" />
					<span class="text-muted-foreground">Sending test notification...</span>
				</div>
			{:else if testResult}
				{#if testSuccess}
					<div
						class="flex items-start gap-2 rounded-md bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400"
					>
						<CheckCircle2 class="mt-0.5 size-4 shrink-0" />
						<span>{testResult}</span>
					</div>
				{:else}
					<div
						class="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
					>
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<span>{testResult}</span>
					</div>
				{/if}
			{/if}
		</div>

		<Dialog.Footer class="flex-row items-center gap-4">
			<Button
				variant="outline"
				size="sm"
				class="gap-1.5"
				onclick={sendTest}
				disabled={testing || saving}
			>
				{#if testing}
					<Loader2 class="size-3.5 animate-spin" />
				{:else}
					<Send class="size-3.5" />
				{/if}
				{testing ? 'Sending…' : 'Send test'}
			</Button>
			<div class="flex-1"></div>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button onclick={saveChannel} disabled={saving}>
					{saving ? 'Saving…' : editingChannel ? 'Save Changes' : 'Add Channel'}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
{/if}
