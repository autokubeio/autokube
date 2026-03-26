<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { cn } from '$lib/utils';
	import {
		Plug,
		Loader2,
		CheckCircle2,
		AlertCircle,
		Upload,
		KeyRound,
		Zap,
		Copy,
		Check,
		ShieldCheck,
		Bell,
		Mail,
		ExternalLink,
		RotateCcw,
		Layers,
		Globe,
		Settings2,
		HardDrive,
		Shield,
		ScanSearch,
		Download,
		Trash2
	} from 'lucide-svelte';
	import type { ClusterPublic } from '$lib/stores/clusters.svelte';
	import LabelPicker, { DEFAULT_LABELS } from '$lib/components/label-picker.svelte';
	import type { LabelItem } from '$lib/components/label-picker.svelte';
	import IconPicker from '$lib/components/icon-picker.svelte';
	import type { ResolvedChannel } from '$lib/server/queries/notifications';
	import { type NotifGroups, defaultNotifGroups, NOTIF_GROUP_META } from '$lib/notifications-constants';

	const GROUP_ICONS: Record<string, typeof Layers> = { Layers, Globe, Settings2, HardDrive, Shield };

	// ── Types ─────────────────────────────────────────────────────────────────

	interface ClusterForm {
		name: string;
		icon: string;
		kubeconfig: string;
		apiServer: string;
		bearerToken: string;
		tlsSkipVerify: boolean;
		namespace: string;
		context: string;
	}

	interface FormErrors {
		name?: string;
		labels?: string;
		kubeconfig?: string;
		apiServer?: string;
		bearerToken?: string;
	}

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		open = $bindable(false),
		cluster,
		onSuccess
	}: {
		open?: boolean;
		cluster?: ClusterPublic;
		onSuccess?: (id: number) => void;
	} = $props();

	const isEditMode = $derived(!!cluster);

	// ── State ─────────────────────────────────────────────────────────────────

	let tab = $state('general');
	let method = $state<'agent' | 'kubeconfig' | 'bearer'>('agent');
	let labels = $state<LabelItem[]>([]);
	let saving = $state(false);
	let saveError = $state('');
	let testingConnection = $state<'idle' | 'loading' | 'success' | 'error'>('idle');

	let form = $state<ClusterForm>({
		name: '',
		icon: 'globe',
		kubeconfig: '',
		apiServer: '',
		bearerToken: '',
		tlsSkipVerify: false,
		namespace: 'default',
		context: ''
	});

	let errors = $state<FormErrors>({});

	// ── Agent token ───────────────────────────────────────────────────────────

	let agentToken = $state('');
	let agentTokenRegenerated = $state(false); // true only when user explicitly clicked regenerate in edit mode
	let copiedToken = $state(false);
	let copiedHelm = $state(false);

	// ── Vulnerability scanning ────────────────────────────────────────────────

	let scanEnabled = $state(false);
	let scannerPreference = $state<'grype' | 'trivy' | 'both'>('both');

	interface ScannerStatus {
		id: string;
		name: string;
		installed: boolean;
		version: string | null;
		loading: boolean;
	}

	let scanners = $state<ScannerStatus[]>([]);
	let scannersLoading = $state(false);

	async function loadScanners() {
		scannersLoading = true;
		try {
			const res = await fetch('/api/scanners');
			if (res.ok) {
				const data = await res.json();
				scanners = (data.scanners ?? []).map((s: { id: string; name: string; installed: boolean; version: string | null }) => ({ ...s, loading: false }));
			}
		} catch (err) {
			console.error('[ClusterDialog] Failed to load scanners:', err);
		} finally {
			scannersLoading = false;
		}
	}

	async function handleScannerAction(scannerId: string, action: 'install' | 'remove' | 'check') {
		const idx = scanners.findIndex((s) => s.id === scannerId);
		if (idx === -1) return;
		scanners[idx].loading = true;
		try {
			const res = await fetch('/api/scanners', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, scanner: scannerId })
			});
			if (res.ok) {
				await loadScanners();
			} else {
				const data = await res.json();
				console.error('[ClusterDialog] Scanner action failed:', data.error);
			}
		} catch (err) {
			console.error('[ClusterDialog] Scanner action error:', err);
		} finally {
			if (scanners[idx]) scanners[idx].loading = false;
		}
	}

	function generateToken(explicit = false) {
		const arr = new Uint8Array(24);
		crypto.getRandomValues(arr);
		agentToken =
			'autokube_agent_token_' +
			Array.from(arr)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		if (explicit) agentTokenRegenerated = true;
	}

	async function copyText(text: string, field: 'token' | 'helm') {
		await navigator.clipboard.writeText(text);
		if (field === 'token') {
			copiedToken = true;
			setTimeout(() => (copiedToken = false), 2000);
		} else {
			copiedHelm = true;
			setTimeout(() => (copiedHelm = false), 2000);
		}
	}

	const helmCommand = $derived(
		`helm repo add autokube https://charts.autokube.io\nhelm install autokube-agent autokube/autokube-agent \\\n  --namespace autokube-system --create-namespace \\\n  --set url=${typeof window !== 'undefined' ? window.location.origin : 'https://autokube.io'} \\\n  --set token=${agentToken}`
	);

	// ── Metrics ──────────────────────────────────────────────────────────────

	let metricsServer = $state(true);
	let cpuWarnThreshold = $state('60');
	let cpuCritThreshold = $state('80');
	let memWarnThreshold = $state('60');
	let memCritThreshold = $state('80');

	// ── Notifications ─────────────────────────────────────────────────────────

	function notifCount(events: Record<string, boolean>) {
		const vals = Object.values(events);
		return { on: vals.filter(Boolean).length, total: vals.length };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function groupCount(resources: Record<string, any>) {
		let on = 0, total = 0;
		for (const events of Object.values(resources)) {
			const c = notifCount(events);
			on += c.on; total += c.total;
		}
		return { on, total };
	}

	function toggleAllNotif(events: Record<string, boolean>, value: boolean) {
		for (const k of Object.keys(events)) {
			events[k] = value;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function toggleAllGroup(resources: Record<string, any>, value: boolean) {
		for (const events of Object.values(resources)) {
			toggleAllNotif(events, value);
		}
	}

	function notifTotal(g: NotifGroups): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const groups = [g.workload, g.network, g.configuration, g.storage, g.accessControl] as Record<string, any>[];
		let on = 0, total = 0;
		for (const grp of groups) {
			for (const events of Object.values(grp)) {
				const c = notifCount(events as Record<string, boolean>);
				on += c.on; total += c.total;
			}
		}
		return `${on}/${total}`;
	}

	// ── Notification channels ────────────────────────────────────────────────

	let availableChannels = $state<ResolvedChannel[]>([]);
	let channelsLoading = $state(false);
	// Per-channel notif config: Record<channelId, NotifGroups>
	let channelNotif = $state<Record<number, NotifGroups>>({});
	let expandedChannels = $state<number[]>([]);
	let hadInitialBindings = $state(false);

	$effect(() => {
		if (open) {
			loadChannels();
			loadScanners();
		}
	});

	async function loadChannels() {
		channelsLoading = true;
		try {
			const res = await fetch('/api/notifications');
			if (res.ok) {
				const data = await res.json();
				availableChannels = (data.channels ?? []).filter((c: ResolvedChannel) => c.enabled);
			}
		} catch (err) {
			console.error('[ClusterDialog] Failed to load channels:', err);
		} finally {
			channelsLoading = false;
		}
	}

	function toggleChannel(id: number) {
		if (channelNotif[id]) {
			const next = { ...channelNotif };
			delete next[id];
			channelNotif = next;
			expandedChannels = expandedChannels.filter((c) => c !== id);
		} else {
			channelNotif = { ...channelNotif, [id]: defaultNotifGroups() };
			if (!expandedChannels.includes(id)) expandedChannels = [...expandedChannels, id];
		}
	}

	function toggleExpand(id: number) {
		expandedChannels = expandedChannels.includes(id)
			? expandedChannels.filter((c) => c !== id)
			: [...expandedChannels, id];
	}

	function resetChannelNotif(id: number) {
		channelNotif = { ...channelNotif, [id]: defaultNotifGroups() };
	}

	// ── Sync form when editing ────────────────────────────────────────────────

	$effect(() => {
		if (open) {
			if (cluster) {
				const authType = cluster.authType ?? 'kubeconfig';
				method =
					authType === 'agent' || authType === 'in-cluster'
						? 'agent'
						: authType === 'bearer-token'
							? 'bearer'
							: 'kubeconfig';
				labels = (cluster.labels ?? []).map((name) => ({
					name,
					color: DEFAULT_LABELS.find((d) => d.name === name)?.color ?? 'blue'
				}));
				form = {
					name: cluster.name,
					icon: cluster.icon ?? 'globe',
					kubeconfig: '',
					apiServer: cluster.apiServer ?? '',
					bearerToken: '',
					tlsSkipVerify: cluster.tlsSkipVerify ?? false,
					namespace: cluster.namespace ?? 'default',
					context: cluster.context ?? ''
				};
				metricsServer = cluster.metricsEnabled ?? true;
				cpuWarnThreshold = String(cluster.cpuWarnThreshold ?? 60);
				cpuCritThreshold = String(cluster.cpuCritThreshold ?? 80);
				memWarnThreshold = String(cluster.memWarnThreshold ?? 60);
				memCritThreshold = String(cluster.memCritThreshold ?? 80);

				scanEnabled = cluster.scanEnabled ?? false;
				scannerPreference = (cluster.scannerPreference as 'grype' | 'trivy' | 'both') ?? 'both';

				// Load existing notification bindings
				loadClusterBindings(cluster.id);
			}
			// Only auto-generate a token for new clusters; edit mode keeps the existing token
			if (!isEditMode && !agentToken) generateToken();
			errors = {};
			saveError = '';
		}
	});

	async function loadClusterBindings(clusterId: number) {
		try {
			const res = await fetch(`/api/clusters/${clusterId}/notifications`);
			if (res.ok) {
				const data = await res.json();
				const loaded: Record<number, NotifGroups> = {};
				const expanded: number[] = [];
				for (const b of data.bindings ?? []) {
					if (b.notifConfig) {
						loaded[b.notificationId] = b.notifConfig;
						expanded.push(b.notificationId);
					}
				}
				channelNotif = loaded;
				expandedChannels = expanded;
				hadInitialBindings = expanded.length > 0;
			}
		} catch (err) {
			console.error('[ClusterDialog] Failed to load notification bindings:', err);
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function resetForm() {
		tab = 'general';
		method = 'agent';
		labels = [];
		agentToken = '';
		agentTokenRegenerated = false;
		form = {
			name: '',
			icon: 'globe',
			kubeconfig: '',
			apiServer: '',
			bearerToken: '',
			tlsSkipVerify: false,
			namespace: 'default',
			context: ''
		};
		cpuWarnThreshold = '60';
		cpuCritThreshold = '80';
		memWarnThreshold = '60';
		memCritThreshold = '80';
		metricsServer = true;
		scanEnabled = false;
		scannerPreference = 'both';
		scanners = [];
		channelNotif = {};
		expandedChannels = [];
		errors = {};
		saveError = '';
		testingConnection = 'idle';
	}

	function handleClose() {
		open = false;
		resetForm();
	}

	function validate(): boolean {
		const next: FormErrors = {};
		if (!form.name.trim()) next.name = 'Cluster name is required';
		if (labels.length === 0) next.labels = 'At least one label is required';
		if (method === 'kubeconfig' && !form.kubeconfig.trim() && !isEditMode)
			next.kubeconfig = 'Kubeconfig is required';
		if (method === 'bearer') {
			if (!form.apiServer.trim()) next.apiServer = 'API server URL is required';
			if (!form.bearerToken.trim() && !isEditMode) next.bearerToken = 'Bearer token is required';
		}
		// No validation needed for agent - token is auto-generated
		errors = next;
		if (Object.keys(next).length > 0) tab = 'general';
		return Object.keys(next).length === 0;
	}

	async function handleTestConnection() {
		// Reset errors
		errors = {};
		testingConnection = 'loading';
		saveError = '';

		// Build request body based on method
		const authType = method === 'kubeconfig' ? 'kubeconfig' : 'bearer-token';
		const body = {
			authType,
			...(method === 'kubeconfig' && {
				kubeconfig: form.kubeconfig,
				context: form.context
			}),
			...(method === 'bearer' && {
				apiServer: form.apiServer,
				bearerToken: form.bearerToken,
				tlsSkipVerify: form.tlsSkipVerify
			})
		};

		try {
			const res = await fetch('/api/clusters/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await res.json();

			if (data.success) {
				testingConnection = 'success';
			} else {
				testingConnection = 'error';
				saveError = data.error || 'Connection test failed';
			}
		} catch (err) {
			testingConnection = 'error';
			saveError = err instanceof Error ? err.message : 'Network error';
		}

		// Reset status after 3 seconds
		const wasSuccess = testingConnection === 'success';
		setTimeout(() => {
			testingConnection = 'idle';
			if (wasSuccess) saveError = '';
		}, 3000);
	}

	async function handleSubmit() {
		if (!validate()) return;
		saving = true;
		saveError = '';

		const authType =
			method === 'kubeconfig' ? 'kubeconfig' : method === 'bearer' ? 'bearer-token' : 'agent';

		const body = {
			name: form.name.trim(),
			icon: form.icon,
			authType,
			labels: labels.map((l) => l.name),
			namespace: form.namespace || 'default',
			context: form.context || undefined,
			...(method === 'kubeconfig' && form.kubeconfig.trim() && { kubeconfig: form.kubeconfig }),
			...(method === 'bearer' && {
				apiServer: form.apiServer,
				...(form.bearerToken.trim() && { bearerToken: form.bearerToken }),
				tlsSkipVerify: form.tlsSkipVerify
			}),
			// Only send agentToken when: creating new cluster, or user explicitly regenerated it
			...(method === 'agent' && (!isEditMode || agentTokenRegenerated) && {
				agentToken
			}),
			metricsEnabled: metricsServer,
			cpuWarnThreshold: Number(cpuWarnThreshold) || 60,
			cpuCritThreshold: Number(cpuCritThreshold) || 80,
			memWarnThreshold: Number(memWarnThreshold) || 60,
			memCritThreshold: Number(memCritThreshold) || 80,
			scanEnabled,
			scannerPreference
		};

		try {
			const url = isEditMode ? `/api/clusters/${cluster!.id}` : '/api/clusters';
			const res = await fetch(url, {
				method: isEditMode ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? 'Request failed');
			}
			const data = await res.json();
			const savedClusterId = data.id ?? cluster?.id ?? 0;

			// Save notification bindings — only if user configured channels OR we need to clear existing ones
			if (Object.keys(channelNotif).length > 0 && savedClusterId) {
				try {
					await fetch(`/api/clusters/${savedClusterId}/notifications`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							bindings: Object.entries(channelNotif).map(([chId, config]) => ({
								channelId: Number(chId),
								notifConfig: config
							}))
						})
					});
				} catch (err) {
					console.error('[ClusterDialog] Failed to save notification bindings:', err);
				}
			} else if (savedClusterId && hadInitialBindings) {
				// Only clear bindings if there were previously-saved bindings to clear
				try {
					await fetch(`/api/clusters/${savedClusterId}/notifications`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ bindings: [] })
					});
				} catch { /* ignore */ }
			}

			handleClose();
			onSuccess?.(savedClusterId);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save cluster';
		} finally {
			saving = false;
		}
	}

	const methods = [
		{
			id: 'kubeconfig' as const,
			icon: Upload,
			label: 'Kubeconfig File',
			desc: 'Upload or paste',
			recommended: false
		},
		{
			id: 'bearer' as const,
			icon: KeyRound,
			label: 'Bearer Token',
			desc: 'API + token',
			recommended: false
		},
		{
			id: 'agent' as const,
			icon: Zap,
			label: 'AutoKube Agent',
			desc: 'Helm install',
			recommended: true
		}
	];
</script>

<Dialog.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) handleClose();
	}}
>
	<Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>{isEditMode ? 'Edit Cluster' : 'Add New Cluster'}</Dialog.Title>
			<Dialog.Description class="text-xs">
				{isEditMode
					? 'Update cluster configuration and settings.'
					: 'Configure your Kubernetes cluster connection and settings.'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<Tabs.Root
				value={tab}
				onValueChange={(v) => (tab = v)}
				class="flex w-full flex-1 flex-col overflow-hidden"
			>
				<Tabs.List class="h-9 w-full shrink-0">
					<Tabs.Trigger value="general" class="flex-1 text-xs">General</Tabs.Trigger>
					<Tabs.Trigger value="connection" class="flex-1 text-xs">Connection</Tabs.Trigger>
					<Tabs.Trigger value="metrics" class="flex-1 text-xs">Metrics</Tabs.Trigger>
					<Tabs.Trigger value="security" class="flex-1 text-xs">Security</Tabs.Trigger>
					<Tabs.Trigger value="notifications" class="flex-1 text-xs">Notifications</Tabs.Trigger>
				</Tabs.List>

				<!-- ── General Tab ─────────────────────────────────────────── -->
				<Tabs.Content value="general" class="mt-3 flex-1 space-y-4 overflow-y-auto px-0">
					<!-- Name -->
					<div class="space-y-1.5">
						<Label class="text-xs">Cluster Name <span class="text-destructive">*</span></Label>
						<div class="flex gap-2">
							<IconPicker value={form.icon} onchange={(icon) => (form.icon = icon)} />
							<Input
								placeholder="my-cluster"
								class={cn('h-8 font-mono text-xs', errors.name && 'border-destructive')}
								bind:value={form.name}
							/>
						</div>
						{#if errors.name}
							<p class="text-[11px] text-destructive">{errors.name}</p>
						{/if}
					</div>

					<!-- Labels -->
					<div class="space-y-1.5">
						<Label class="text-xs">Labels <span class="text-destructive">*</span></Label>
						<LabelPicker bind:selected={labels} error={errors.labels} />
					</div>

					<!-- Namespace -->
					<div class="space-y-1.5">
						<Label class="text-xs">Default Namespace</Label>
						<Input
							placeholder="default"
							class="h-8 font-mono text-xs"
							bind:value={form.namespace}
						/>
					</div>
				</Tabs.Content>

				<!-- ── Connection Tab ─────────────────────────────────────────── -->
				<Tabs.Content value="connection" class="mt-3 flex-1 space-y-4 overflow-y-auto px-0">
					<!-- Connection Method -->
					<div class="space-y-2">
						<Label class="text-xs">Connection Method</Label>
						<div class="grid grid-cols-3 gap-3">
							{#each methods as opt (opt.id)}
								<button
									type="button"
									onclick={() => {
										method = opt.id;
										errors = {};
									}}
									class={cn(
										'relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
										method === opt.id
											? 'border-emerald-500 bg-emerald-500/5'
											: 'border-border hover:border-muted-foreground/30 hover:bg-muted/20'
									)}
								>
									{#if opt.recommended}
										<span
											class={cn(
												'absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
												method === opt.id
													? 'bg-emerald-500 text-white'
													: 'bg-muted text-muted-foreground'
											)}>Recommended</span
										>
									{/if}
									<opt.icon
										class={cn(
											'size-5',
											method === opt.id ? 'text-emerald-500' : 'text-muted-foreground'
										)}
									/>
									<div>
										<p class="text-sm leading-tight font-semibold">{opt.label}</p>
										<p class="mt-0.5 text-xs text-muted-foreground">{opt.desc}</p>
									</div>
								</button>
							{/each}
						</div>
					</div>

					<!-- ── Kubeconfig ──────────────────────────────────────── -->
					{#if method === 'kubeconfig'}
						<div class="space-y-3">
							<div class="space-y-1.5">
								<Label class="text-xs"
									>Kubeconfig {#if !isEditMode}<span class="text-destructive">*</span
										>{/if}</Label
								>
								{#if isEditMode && cluster?.hasKubeconfig && !form.kubeconfig}
									<div
										class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5"
									>
										<ShieldCheck class="size-3.5 text-emerald-500" />
										<span class="text-xs text-muted-foreground"
											>Kubeconfig is configured (encrypted)</span
										>
									</div>
								{/if}
								<textarea
									class={cn(
										'min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs text-muted-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring focus:outline-none',
										errors.kubeconfig && 'border-destructive'
									)}
									placeholder={isEditMode && cluster?.hasKubeconfig
										? 'Paste new kubeconfig to replace existing...'
										: 'apiVersion: v1\nkind: Config\nclusters:\n  ...'}
									bind:value={form.kubeconfig}
								></textarea>
								{#if errors.kubeconfig}
									<p class="text-[11px] text-destructive">{errors.kubeconfig}</p>
								{/if}
							</div>
							<div class="space-y-1.5">
								<Label class="text-xs"
									>Context <span class="text-muted-foreground">(optional)</span></Label
								>
								<Input
									placeholder="default"
									class="h-8 font-mono text-xs"
									bind:value={form.context}
								/>
							</div>
						</div>
					{/if}

					<!-- ── Bearer Token ────────────────────────────────────── -->
					{#if method === 'bearer'}
						<div class="space-y-3">
							<div class="space-y-1.5">
								<Label class="text-xs">API Server URL <span class="text-destructive">*</span></Label
								>
								<Input
									placeholder="https://my-cluster.example.com:6443"
									class={cn('h-8 font-mono text-xs', errors.apiServer && 'border-destructive')}
									bind:value={form.apiServer}
								/>
								{#if errors.apiServer}
									<p class="text-[11px] text-destructive">{errors.apiServer}</p>
								{/if}
							</div>
							<div class="space-y-1.5">
								<Label class="text-xs"
									>Bearer Token {#if !isEditMode}<span class="text-destructive">*</span
										>{/if}</Label
								>
								{#if isEditMode && cluster?.hasBearerToken && !form.bearerToken}
									<div
										class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5"
									>
										<ShieldCheck class="size-3.5 text-emerald-500" />
										<span class="text-xs text-muted-foreground"
											>Bearer token is configured (encrypted)</span
										>
									</div>
								{/if}
								<textarea
									class={cn(
										'min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs text-muted-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring focus:outline-none',
										errors.bearerToken && 'border-destructive'
									)}
									placeholder={isEditMode && cluster?.hasBearerToken
										? 'Paste new token to replace existing...'
										: 'eyJhbGciOiJSUzI1NiIsInR5cCI6...'}
									bind:value={form.bearerToken}
								></textarea>
								{#if errors.bearerToken}
									<p class="text-[11px] text-destructive">{errors.bearerToken}</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<Switch bind:checked={form.tlsSkipVerify} />
								<Label class="text-xs">Skip TLS verification</Label>
							</div>
						</div>
					{/if}

					<!-- ── AutoKube Agent ──────────────────────────────────── -->
					{#if method === 'agent'}
						<div class="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
							<!-- Header -->
							<div class="flex items-center gap-2">
								<Zap class="size-4 text-emerald-500" />
								<span class="text-sm font-semibold">AutoKube Agent Setup</span>
								<span
									class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
									>Secure</span
								>
							</div>

							<!-- Token -->
									{#if isEditMode && !agentTokenRegenerated}
										<!-- Edit mode: show existing-token info, offer explicit regeneration -->
										<div class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
											<ShieldCheck class="size-3.5 shrink-0 text-emerald-500" />
											<span class="flex-1 text-xs text-muted-foreground">Agent token is configured and active</span>
											<button
												type="button"
												onclick={() => generateToken(true)}
												class="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
											>
												<RotateCcw class="size-3" />
												Regenerate
											</button>
										</div>
									{:else}
										<!-- New cluster or after explicit regeneration: show token -->
										{#if isEditMode}
											<div class="flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-[11px] text-orange-600 dark:text-orange-400">
												<AlertCircle class="size-3.5 shrink-0" />
												New token generated — reinstall the Helm chart with this token or the agent will disconnect.
											</div>
										{/if}
										<div class="rounded-md border bg-background/60 p-3">
											<div class="flex items-center justify-between">
												<p class="text-xs font-medium">Installation Token</p>
												<button
													type="button"
													onclick={() => copyText(agentToken, 'token')}
													class="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
												>
													{#if copiedToken}
														<Check class="size-3.5 text-emerald-500" />
													{:else}
														<Copy class="size-3.5" />
													{/if}
													Copy
												</button>
											</div>
											<p class="mt-2 font-mono text-xs break-all text-muted-foreground">{agentToken}</p>
										</div>
									{/if}
							<!-- Helm command — only shown when a (new) token is available -->
							{#if !isEditMode || agentTokenRegenerated}
							<div class="rounded-md border bg-background/60 p-3">
								<div class="flex items-center justify-between">
									<p class="text-xs font-medium">Helm Installation Command</p>
									<button
										type="button"
										onclick={() => copyText(helmCommand, 'helm')}
										class="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
									>
										{#if copiedHelm}
											<Check class="size-3.5 text-emerald-500" />
										{:else}
											<Copy class="size-3.5" />
										{/if}
										Copy
									</button>
								</div>
								<pre
									class="mt-2 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">{helmCommand}</pre>
							</div>
							{/if}

							<p class="text-center text-xs text-muted-foreground italic">
								{#if isEditMode && !agentTokenRegenerated}
									Agent is connected and using the existing token.
								{:else}
									The agent will automatically connect and register once installed.
								{/if}
							</p>
						</div>
					{/if}
				</Tabs.Content>

				<!-- ── Metrics Tab ─────────────────────────────────────────── -->
				<Tabs.Content value="metrics" class="mt-3 flex-1 space-y-4 overflow-y-auto px-0">
					<!-- Source -->
					<div>
						<p class="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Source</p>
						<div class="flex items-center justify-between gap-4 rounded-lg border p-3">
							<div>
								<p class="text-xs font-medium">metrics-server integration</p>
								<p class="text-[11px] text-muted-foreground">Live CPU / memory usage for nodes and pods</p>
							</div>
							<Switch bind:checked={metricsServer} />
						</div>
					</div>

					<!-- Thresholds -->
					<div>
						<p class="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Warning Thresholds</p>
						<p class="mb-3 text-[11px] text-muted-foreground">Highlight usage bars when a node or pod exceeds these limits.</p>
						<div class="space-y-2">
							<!-- CPU -->
							<div class="rounded-lg border p-3">
								<p class="mb-2 text-xs font-medium">CPU thresholds</p>
								<div class="flex items-center gap-4">
									<div class="flex flex-1 items-center gap-1.5">
										<span class="h-2 w-2 shrink-0 rounded-full bg-yellow-500"></span>
										<p class="text-[11px] text-muted-foreground w-12">Warning</p>
										<Input type="number" min="1" max="99" class="h-7 w-16 text-center text-xs" bind:value={cpuWarnThreshold} />
										<span class="text-xs text-muted-foreground">%</span>
									</div>
									<div class="flex flex-1 items-center gap-1.5">
										<span class="h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
										<p class="text-[11px] text-muted-foreground w-12">Critical</p>
										<Input type="number" min="1" max="100" class="h-7 w-16 text-center text-xs" bind:value={cpuCritThreshold} />
										<span class="text-xs text-muted-foreground">%</span>
									</div>
								</div>
								<!-- Visual scale -->
								<div class="mt-2 flex h-1.5 overflow-hidden rounded-full">
									<div class="bg-green-500 transition-all" style="width: {cpuWarnThreshold}%"></div>
									<div class="bg-yellow-500 transition-all" style="width: {Math.max(0, Number(cpuCritThreshold) - Number(cpuWarnThreshold))}%"></div>
									<div class="bg-red-500 flex-1"></div>
								</div>
							</div>
							<!-- Memory -->
							<div class="rounded-lg border p-3">
								<p class="mb-2 text-xs font-medium">Memory thresholds</p>
								<div class="flex items-center gap-4">
									<div class="flex flex-1 items-center gap-1.5">
										<span class="h-2 w-2 shrink-0 rounded-full bg-yellow-500"></span>
										<p class="text-[11px] text-muted-foreground w-12">Warning</p>
										<Input type="number" min="1" max="99" class="h-7 w-16 text-center text-xs" bind:value={memWarnThreshold} />
										<span class="text-xs text-muted-foreground">%</span>
									</div>
									<div class="flex flex-1 items-center gap-1.5">
										<span class="h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
										<p class="text-[11px] text-muted-foreground w-12">Critical</p>
										<Input type="number" min="1" max="100" class="h-7 w-16 text-center text-xs" bind:value={memCritThreshold} />
										<span class="text-xs text-muted-foreground">%</span>
									</div>
								</div>
								<!-- Visual scale -->
								<div class="mt-2 flex h-1.5 overflow-hidden rounded-full">
									<div class="bg-green-500 transition-all" style="width: {memWarnThreshold}%"></div>
									<div class="bg-yellow-500 transition-all" style="width: {Math.max(0, Number(memCritThreshold) - Number(memWarnThreshold))}%"></div>
									<div class="bg-red-500 flex-1"></div>
								</div>
							</div>
						</div>
					</div>

				</Tabs.Content>

				<!-- ── Notifications Tab ───────────────────────────────────── -->
				<!-- ── Security Tab ─────────────────────────────────────────── -->
				<Tabs.Content value="security" class="mt-3 flex-1 space-y-4 overflow-y-auto px-0">
					<p class="text-[11px] text-muted-foreground">Configure vulnerability scanning for container images in this cluster.</p>

					<!-- Enable scanning toggle -->
					<div class="flex items-center justify-between rounded-lg border px-3 py-2.5">
						<div class="flex items-center gap-2">
							<ScanSearch class="size-4 text-muted-foreground" />
							<div>
								<p class="text-xs font-medium">Enable Scanning</p>
								<p class="text-[10px] text-muted-foreground">Scan container images for known vulnerabilities</p>
							</div>
						</div>
						<Switch checked={scanEnabled} onCheckedChange={(v) => (scanEnabled = v)} />
					</div>

					{#if scanEnabled}
						<!-- In-cluster scanning info -->
						<div class="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
							<div class="flex items-start gap-2">
								<Globe class="mt-0.5 size-3.5 shrink-0 text-primary" />
								<div>
									<p class="text-xs font-medium text-primary">In-Cluster Scanning</p>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										Scans run as Jobs inside the cluster. Private registries are 
										accessible and images are not re-downloaded to the server.
									</p>
								</div>
							</div>
						</div>

						<!-- Scanner preference -->
						<div class="space-y-2">
							<Label class="text-xs">Scanner Preference</Label>
							<div class="grid grid-cols-3 gap-2">
								{#each [{ id: 'grype', label: 'Grype' }, { id: 'trivy', label: 'Trivy' }, { id: 'both', label: 'Both' }] as opt (opt.id)}
									<button
										type="button"
										class={cn(
											'rounded-md border px-3 py-2 text-xs font-medium transition-colors',
											scannerPreference === opt.id
												? 'border-primary bg-primary/10 text-primary'
												: 'text-muted-foreground hover:bg-muted'
										)}
										onclick={() => (scannerPreference = opt.id as 'grype' | 'trivy' | 'both')}
									>
										{opt.label}
									</button>
								{/each}
							</div>
							<p class="text-[10px] text-muted-foreground">
								{#if scannerPreference === 'both'}
									Uses Grype first, falls back to Trivy if unavailable.
								{:else if scannerPreference === 'grype'}
									Uses Grype for all vulnerability scans.
								{:else}
									Uses Trivy for all vulnerability scans.
								{/if}
							</p>
						</div>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="notifications" class="mt-3 flex-1 space-y-3 overflow-y-auto px-0">
					<p class="text-[11px] text-muted-foreground">Configure which events each notification channel receives for this cluster.</p>

					<!-- Channels -->
					<div class="rounded-lg border">
						<div class="flex items-center gap-2 border-b px-3 py-2">
							<Bell class="size-3.5 text-muted-foreground" />
							<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Channels</p>
							{#if availableChannels.length > 0}
								<span class="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
									{Object.keys(channelNotif).length}/{availableChannels.length} active
								</span>
							{/if}
						</div>

						{#if channelsLoading}
							<div class="flex items-center justify-center px-3 py-4">
								<Loader2 class="size-4 animate-spin text-muted-foreground" />
							</div>
						{:else if availableChannels.length === 0}
							<div class="flex items-center justify-between px-3 py-3">
								<p class="text-[11px] text-muted-foreground">No channels configured yet.</p>
								<a href="/settings#notifications" class="flex items-center gap-1 text-[11px] text-primary underline underline-offset-2">
									Add channel <ExternalLink class="size-3" />
								</a>
							</div>
						{:else}
							<div class="divide-y">
								{#each availableChannels as ch (ch.id)}
									{@const enabled = !!channelNotif[ch.id]}
									{@const expanded = expandedChannels.includes(ch.id)}
									<div>
										<!-- Channel row -->
										<div class="flex items-center justify-between px-3 py-2.5">
											<div class="flex items-center gap-2">
										<div class="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted">
											<Mail class="size-3.5 text-muted-foreground" />
										</div>
										<div>
											<p class="text-xs font-medium">{ch.name}</p>
											<p class="text-[10px] capitalize text-muted-foreground">{ch.type}</p>
										</div>
									</div>
									<div class="flex items-center gap-2">
										{#if enabled}
											<button
												type="button"
												class="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												onclick={() => toggleExpand(ch.id)}
											>
												<span class="tabular-nums font-medium">{notifTotal(channelNotif[ch.id])}</span>
												<svg class={cn('size-3 transition-transform', expanded && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
											</button>
										{/if}
										<Switch checked={enabled} onCheckedChange={() => toggleChannel(ch.id)} />
									</div>
								</div>

								<!-- Per-channel resource config -->
								{#if enabled && expanded}
									{@const g = channelNotif[ch.id]}
									<!-- Expanded toolbar -->
									<div class="flex items-center justify-between border-t bg-muted/20 px-3 py-1.5">
										<p class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Event filters</p>
										<button
											type="button"
											class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
											onclick={() => resetChannelNotif(ch.id)}
										>
											<RotateCcw class="size-2.5" />
											Reset defaults
										</button>
									</div>
									<div class="space-y-0 divide-y bg-muted/20 px-3 pb-3 pt-2">
										{#each NOTIF_GROUP_META as gm (gm.key)}
											{@const groupData = g[gm.key] as Record<string, Record<string, boolean>>}
											{@const GroupIcon = GROUP_ICONS[gm.icon]}
											<div class="rounded-md border bg-background">
												<div class={cn("flex items-center justify-between border-b px-2.5 py-1.5", gm.classes.headerBg)}>
													<div class="flex items-center gap-1.5"><GroupIcon class={cn("size-3", gm.classes.iconColor)} /><p class={cn("text-[10px] font-semibold tracking-wide uppercase", gm.classes.textColor)}>{gm.label}</p><span class={cn("rounded-full px-1 py-0.5 text-[10px] tabular-nums", gm.classes.badgeBg, gm.classes.badgeText)}>{groupCount(groupData).on}/{groupCount(groupData).total}</span></div>
													<div class="flex items-center gap-1.5"><span class="text-[10px] text-muted-foreground">All</span><Switch checked={groupCount(groupData).on === groupCount(groupData).total} onCheckedChange={(v) => toggleAllGroup(groupData, v)} /></div>
												</div>
												<div class="divide-y">
													{#each gm.resources as res (res.key)}
														{@const resData = groupData[res.key] as Record<string, boolean>}
														<div>
															<div class="flex items-center justify-between bg-muted/30 px-2.5 py-1.5"><p class="text-[10px] font-semibold text-foreground">{res.label}</p><div class="flex items-center gap-1.5"><span class="text-[10px] tabular-nums text-muted-foreground">{notifCount(resData).on}/{notifCount(resData).total}</span><Switch checked={notifCount(resData).on === notifCount(resData).total} onCheckedChange={(v) => toggleAllNotif(resData, v)} /></div></div>
															<div class="divide-y border-t">
																{#each res.events as evt (evt.key)}
																	<div class="flex items-center justify-between py-1.5 pl-5 pr-2.5">
																		{#if evt.description}
																			<div><p class="text-[11px]">{evt.label}</p><p class="text-[10px] text-muted-foreground">{evt.description}</p></div>
																		{:else}
																			<p class="text-[11px]">{evt.label}</p>
																		{/if}
																		<Switch checked={resData[evt.key]} onCheckedChange={(v) => { resData[evt.key] = v; }} />
																	</div>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								{/if}
								</div>
							{/each}
							</div>
						{/if}
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</div>

		{#if saveError}
			<p class="text-xs text-destructive">{saveError}</p>
		{/if}

		<!-- Footer -->
		<div class="mt-2 flex shrink-0 items-center justify-between gap-2 border-t pt-3">
			{#if method !== 'agent'}
				<Button
					variant="outline"
					size="sm"
					class="h-8 gap-1.5 text-xs"
					onclick={handleTestConnection}
					disabled={testingConnection === 'loading'}
				>
					{#if testingConnection === 'loading'}
						<Loader2 class="size-3 animate-spin" />
					{:else if testingConnection === 'success'}
						<CheckCircle2 class="size-3 text-emerald-500" />
					{:else if testingConnection === 'error'}
						<AlertCircle class="size-3 text-destructive" />
					{:else}
						<Plug class="size-3" />
					{/if}
					{testingConnection === 'loading'
						? 'Testing…'
						: testingConnection === 'success'
							? 'Connected!'
							: testingConnection === 'error'
								? 'Failed'
								: 'Test Connection'}
				</Button>
			{:else}
				<div></div>
			{/if}

			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
					Cancel
				</Button>
				<Button size="sm" class="h-8 text-xs" onclick={handleSubmit} disabled={saving}>
					{#if saving}<Loader2 class="mr-1.5 size-3 animate-spin" />{/if}
					{isEditMode ? 'Update Cluster' : 'Add Cluster'}
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
