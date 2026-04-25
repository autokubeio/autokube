<!--
  Resource Drawer — bottom drawer for viewing and editing any Kubernetes resource manifest.

  Features
  ─────────
  • Slide-up panel from the bottom (drag-handle to resize)
  • YAML tab: CodeMirror editor (view + edit + save)
  • Describe tab: structured section breakdown grouped by top-level keys
  • Copy / Download manifest
  • Refresh (re-fetch from cluster)
  • Works for all K8s resource types (namespaced & cluster-scoped)

  Usage
  ─────
  <ResourceDrawer
    bind:open
    clusterId={activeCluster.id}
    resource={{ resourceType: 'deployment', name: 'nginx', namespace: 'default' }}
    onClose={() => (selectedResource = null)}
  />
-->

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import CodeEditor from '$lib/components/code-editor.svelte';
	import { toast } from 'svelte-sonner';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { MONO_FONTS } from '$lib/theme-utils';
	import {
		X,
		RotateCcw,
		GripHorizontal,
		Copy,
		CheckCheck,
		Download,
		AlertCircle,
		Loader2,
		FileCode,
		AlignLeft,
		ChevronRight,
		ChevronDown as ChevronDownIcon,
		Pencil,
		Save,
		Sun,
		Moon,
		Box,
		Server,
		GitBranch,
		Database,
		Globe,
		Key,
		Shield,
		FileText,
		Package,
		Network,
		Layers
	} from 'lucide-svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	export type K8sResourceType =
		| 'pod'
		| 'deployment'
		| 'service'
		| 'configmap'
		| 'secret'
		| 'ingress'
		| 'daemonset'
		| 'statefulset'
		| 'job'
		| 'cronjob'
		| 'replicaset'
		| 'namespace'
		| 'node'
		| 'persistentvolume'
		| 'persistentvolumeclaim'
		| 'serviceaccount'
		| 'role'
		| 'rolebinding'
		| 'clusterrole'
		| 'clusterrolebinding'
		| 'networkpolicy'
		| 'resourcequota'
		| 'limitrange'
		| 'hpa'
		| 'storageclass'
		| 'ingressclass'
		| 'endpoint'
		| 'endpointslice'
		| 'event'
		| (string & {}); // allow custom types

	export type ResourceRef = {
		resourceType: K8sResourceType;
		name: string;
		namespace?: string;
	};

	type Props = {
		open?: boolean;
		clusterId: number;
		resource: ResourceRef | null;
		readonly?: boolean;
		onClose?: () => void;
		onSuccess?: () => void;
	};

	type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
	type Tab = 'yaml' | 'describe';

	// ── Resource icon/label map ───────────────────────────────────────────────

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const RESOURCE_META: Record<string, { label: string; icon: any }> = {
		pod: { label: 'Pod', icon: Box },
		deployment: { label: 'Deployment', icon: GitBranch },
		service: { label: 'Service', icon: Network },
		configmap: { label: 'ConfigMap', icon: FileText },
		secret: { label: 'Secret', icon: Key },
		ingress: { label: 'Ingress', icon: Globe },
		daemonset: { label: 'DaemonSet', icon: Server },
		statefulset: { label: 'StatefulSet', icon: Database },
		job: { label: 'Job', icon: Package },
		cronjob: { label: 'CronJob', icon: Package },
		replicaset: { label: 'ReplicaSet', icon: Layers },
		namespace: { label: 'Namespace', icon: Box },
		node: { label: 'Node', icon: Server },
		persistentvolume: { label: 'PersistentVolume', icon: Database },
		persistentvolumeclaim: { label: 'PersistentVolumeClaim', icon: Database },
		serviceaccount: { label: 'ServiceAccount', icon: Shield },
		role: { label: 'Role', icon: Shield },
		rolebinding: { label: 'RoleBinding', icon: Shield },
		clusterrole: { label: 'ClusterRole', icon: Shield },
		clusterrolebinding: { label: 'ClusterRoleBinding', icon: Shield },
		networkpolicy: { label: 'NetworkPolicy', icon: Network },
		resourcequota: { label: 'ResourceQuota', icon: FileText },
		limitrange: { label: 'LimitRange', icon: FileText },
		hpa: { label: 'HorizontalPodAutoscaler', icon: GitBranch },
		storageclass: { label: 'StorageClass', icon: Database },
		ingressclass: { label: 'IngressClass', icon: Globe },
		endpoint: { label: 'Endpoint', icon: Network },
		endpointslice: { label: 'EndpointSlice', icon: Network },
		event: { label: 'Event', icon: FileText },
		gateway: { label: 'Gateway', icon: Network },
		gatewayclass: { label: 'GatewayClass', icon: Network },
		httproute: { label: 'HTTPRoute', icon: Globe },
		grpcroute: { label: 'GRPCRoute', icon: Globe },
		referencegrant: { label: 'ReferenceGrant', icon: Shield },
		backendtlspolicy: { label: 'BackendTLSPolicy', icon: Shield },
		backendtrafficpolicy: { label: 'BackendTrafficPolicy', icon: Network }
	};

	// ── Resource readonly set ─────────────────────────────────────────────────

	const ALWAYS_READONLY = new Set(['pod', 'event']);

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		open = $bindable(false),
		clusterId,
		resource,
		readonly,
		onClose,
		onSuccess
	}: Props = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let loadState = $state<LoadState>('idle');
	let loadError = $state('');
	let yamlText = $state('');
	let editedYaml = $state('');
	let isEditing = $state(false);
	let isDirty = $state(false);
	let saving = $state(false);
	let editorResetKey = $state(0);
	let editorTheme = $state<'dark' | 'light'>('dark');
	let activeTab = $state<Tab>('yaml');
	let copied = $state(false);

	// Collapsed sections in Describe tab (array of section header strings)
	let collapsedSections = $state<string[]>([]);

	// Panel dimensions
	const MIN_HEIGHT = 260;
	const MAX_HEIGHT_RATIO = 0.85;
	let panelHeight = $state(620);
	let isDragging = $state(false);

	// Refs
	let panelEl = $state<HTMLElement | null>(null);

	// ── Derived ───────────────────────────────────────────────────────────────

	const isOpen = $derived(open && resource !== null);

	const canEdit = $derived(
		readonly !== undefined ? !readonly : !ALWAYS_READONLY.has(resource?.resourceType ?? '')
	);

	const resourceMeta = $derived(
		resource
			? (RESOURCE_META[resource.resourceType] ?? { label: resource.resourceType, icon: FileCode })
			: null
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ResourceIcon = $derived<any>(resourceMeta?.icon ?? FileCode);

	const editorFontFamily = $derived(
		MONO_FONTS.find((f) => f.id === settingsStore.editorFont)?.family ??
			'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace'
	);

	// Parse YAML into top-level sections for the Describe tab
	const describeSections = $derived.by((): Array<{ header: string; lines: string[] }> => {
		if (!yamlText) return [];
		const sections: Array<{ header: string; lines: string[] }> = [];
		let current: { header: string; lines: string[] } | null = null;

		for (const line of yamlText.split('\n')) {
			// Top-level key: starts at column 0, contains ':'
			if (/^[a-zA-Z]/.test(line) && line.includes(':')) {
				if (current) sections.push(current);
				const header = line.split(':')[0].trim();
				current = { header, lines: [line] };
			} else if (line === '---' || line === '...') {
				// YAML document markers — skip or start fresh
				if (current) sections.push(current);
				current = null;
			} else if (current) {
				current.lines.push(line);
			}
		}
		if (current) sections.push(current);
		return sections;
	});

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	$effect(() => {
		if (isOpen) {
			untrack(() => {
				activeTab = 'yaml';
				collapsedSections = [];
				isEditing = false;
				isDirty = false;
				fetchYaml();
			});
		} else {
			untrack(() => {
				yamlText = '';
				editedYaml = '';
				isEditing = false;
				isDirty = false;
				loadState = 'idle';
				loadError = '';
			});
		}
	});

	onDestroy(() => {
		yamlText = '';
		editedYaml = '';
	});

	// ── Fetch ─────────────────────────────────────────────────────────────────

	async function fetchYaml() {
		if (!resource || !clusterId) return;

		loadState = 'loading';
		loadError = '';

		try {
			let url = `/api/k8s/yaml?cluster=${encodeURIComponent(clusterId)}&resourceType=${encodeURIComponent(resource.resourceType)}&name=${encodeURIComponent(resource.name)}`;
			if (resource.namespace) url += `&namespace=${encodeURIComponent(resource.namespace)}`;

			const res = await fetch(url);
			const data = await res.json();

			if (data.success && data.yaml) {
				yamlText = data.yaml;
				editedYaml = data.yaml;
				isDirty = false;
				editorResetKey++;
				loadState = 'loaded';
			} else {
				loadError = data.error ?? 'Failed to load manifest';
				loadState = 'error';
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load manifest';
			loadState = 'error';
		}
	}

	async function saveYaml() {
		if (!resource || !clusterId || !editedYaml.trim()) return;
		saving = true;

		try {
			let url = `/api/k8s/yaml?cluster=${encodeURIComponent(clusterId)}&resourceType=${encodeURIComponent(resource.resourceType)}&name=${encodeURIComponent(resource.name)}`;
			if (resource.namespace) url += `&namespace=${encodeURIComponent(resource.namespace)}`;

			const res = await fetch(url, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ yaml: editedYaml })
			});
			const data = await res.json();

			if (data.success) {
				yamlText = editedYaml;
				isDirty = false;
				isEditing = false;
				const label = resource.namespace
					? `${resource.resourceType} "${resource.name}" in "${resource.namespace}"`
					: `${resource.resourceType} "${resource.name}"`;
				if (data.warning) {
					toast.warning(data.warning);
				} else {
					toast.success(`Successfully updated ${label}`);
				}
				onSuccess?.();
			} else {
				const msg = data.error ?? `Failed to update ${resource.resourceType}`;
				toast.error(msg);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Save failed');
		} finally {
			saving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	async function copyManifest() {
		if (!yamlText) return;
		await navigator.clipboard.writeText(isEditing ? editedYaml : yamlText);
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}

	function downloadManifest() {
		if (!yamlText || !resource) return;
		const blob = new Blob([yamlText], { type: 'text/yaml' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${resource.resourceType}-${resource.name}.yaml`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function toggleSection(header: string) {
		if (collapsedSections.includes(header)) {
			collapsedSections = collapsedSections.filter((h) => h !== header);
		} else {
			collapsedSections = [...collapsedSections, header];
		}
	}

	// ── YAML Syntax Highlighting ──────────────────────────────────────────────

	type Seg = { text: string; cls: string };

	function colorizeValue(val: string): Seg[] {
		if (!val.trim()) return [{ text: val, cls: 'text-zinc-400' }];
		const v = val.trim();
		const leading = val.slice(0, val.indexOf(v));
		const seg = (cls: string): Seg[] => [
			...(leading ? [{ text: leading, cls: '' }] : []),
			{ text: v, cls }
		];
		if (v === 'true' || v === 'false') return seg('text-violet-400');
		if (v === 'null' || v === '~') return seg('text-zinc-500 italic');
		if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return seg('text-emerald-400');
		if (v === '|' || v === '>' || v === '|-' || v === '>-') return seg('text-zinc-400');
		if (v.startsWith('"') || v.startsWith("'")) return seg('text-amber-300');
		if (v.startsWith('http://') || v.startsWith('https://')) return seg('text-sky-300 underline');
		return seg('text-zinc-200');
	}

	function tokenizeLine(line: string): Seg[] {
		// Comment
		if (line.trim().startsWith('#')) return [{ text: line, cls: 'text-zinc-500 italic' }];
		// YAML document separators
		if (/^---/.test(line.trim()) || /^\.\.\./.test(line.trim()))
			return [{ text: line, cls: 'text-zinc-600' }];

		const segs: Seg[] = [];

		// Preserve leading whitespace
		const indentMatch = /^(\s*)(.*)$/.exec(line);
		const indent = indentMatch?.[1] ?? '';
		let rest = indentMatch?.[2] ?? '';
		if (indent) segs.push({ text: indent, cls: '' });

		// Array item dash
		let isArrayItem = false;
		if (rest.startsWith('- ')) {
			segs.push({ text: '- ', cls: 'text-zinc-500' });
			rest = rest.slice(2);
			isArrayItem = true;
		} else if (rest === '-') {
			return [...segs, { text: '-', cls: 'text-zinc-500' }];
		}

		// key: value  or  key:
		const kv = /^([\w.\-/]+)(\s*:\s?)(.*)$/.exec(rest);
		if (kv) {
			segs.push({ text: kv[1], cls: isArrayItem ? 'text-sky-300' : 'text-sky-400' });
			segs.push({ text: kv[2], cls: 'text-zinc-600' });
			segs.push(...colorizeValue(kv[3]));
		} else {
			// Plain value line (continuation of block scalar, etc.)
			segs.push(...colorizeValue(rest));
		}
		return segs;
	}

	// ── Section header colours ────────────────────────────────────────────────

	const SECTION_COLORS: Record<string, string> = {
		apiVersion: 'text-violet-400  border-violet-700/40 bg-violet-950/30',
		kind: 'text-sky-300     border-sky-700/40    bg-sky-950/30',
		metadata: 'text-amber-300   border-amber-700/40  bg-amber-950/20',
		spec: 'text-emerald-300 border-emerald-700/40 bg-emerald-950/20',
		status: 'text-blue-300    border-blue-700/40   bg-blue-950/20',
		data: 'text-teal-300    border-teal-700/40   bg-teal-950/20',
		stringData: 'text-teal-300    border-teal-700/40   bg-teal-950/20',
		rules: 'text-orange-300  border-orange-700/40 bg-orange-950/20',
		roleRef: 'text-orange-300  border-orange-700/40 bg-orange-950/20',
		subjects: 'text-orange-300  border-orange-700/40 bg-orange-950/20'
	};

	function sectionColor(header: string): string {
		return SECTION_COLORS[header] ?? 'text-zinc-300 border-zinc-700/40 bg-zinc-900/30';
	}

	// ── Drag-to-resize ────────────────────────────────────────────────────────

	function onHandlePointerDown(e: PointerEvent) {
		isDragging = true;
		const startY = e.clientY;
		const startH = panelHeight;

		function onMove(me: PointerEvent) {
			const delta = startY - me.clientY;
			const maxH = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
			panelHeight = Math.max(MIN_HEIGHT, Math.min(maxH, startH + delta));
		}

		function onUp() {
			requestAnimationFrame(() => (isDragging = false));
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		}

		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}
</script>

<!-- ── Overlay backdrop ───────────────────────────────────────────────────── -->
{#if isOpen}
	<div
		class="pointer-events-none fixed inset-0 z-40"
		style="background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.25) 100%)"
	></div>
{/if}

<!-- ── Panel ──────────────────────────────────────────────────────────────── -->
<div
	bind:this={panelEl}
	class={cn(
		'fixed right-0 bottom-0 left-0 z-50 flex flex-col',
		'border-t border-zinc-700/60 bg-zinc-950 shadow-2xl shadow-black/60',
		'transition-transform duration-300 ease-out',
		isOpen ? 'translate-y-0' : 'translate-y-full'
	)}
	style="height: {panelHeight}px"
>
	<!-- ── Drag handle ──────────────────────────────────────────────────── -->
	<div
		class={cn(
			'flex h-5 shrink-0 cursor-ns-resize items-center justify-center',
			'border-b border-zinc-700/40 bg-zinc-900/80 hover:bg-zinc-800/80',
			isDragging && 'bg-zinc-800/80'
		)}
		onpointerdown={onHandlePointerDown}
		role="separator"
		aria-orientation="horizontal"
		aria-label="Drag to resize resource panel"
	>
		<GripHorizontal class="size-3.5 text-zinc-500" />
	</div>

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center gap-2 border-b border-zinc-700/40 bg-zinc-900/60 px-3 py-1.5"
	>
		<!-- Icon + resource kind + name -->
		<ResourceIcon class="size-3.5 shrink-0 text-zinc-400" />
		<span class="font-mono text-[11px] font-medium text-zinc-400">
			{resourceMeta?.label ?? resource?.resourceType ?? ''}
		</span>
		<span class="max-w-50 truncate font-mono text-xs font-semibold text-zinc-200">
			{resource?.name ?? ''}
		</span>
		{#if resource?.namespace}
			<Badge
				variant="outline"
				class="h-4 shrink-0 border-zinc-600 px-1 py-0 font-mono text-[10px] text-zinc-400"
			>
				{resource.namespace}
			</Badge>
		{/if}

		<div class="flex-1"></div>

		<!-- Tabs -->
		<div class="flex items-center gap-0.5 rounded-md border border-zinc-700/60 bg-zinc-900 p-0.5">
			<button
				class={cn(
					'flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
					activeTab === 'yaml' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
				)}
				onclick={() => (activeTab = 'yaml')}
			>
				<FileCode class="size-3" />
				YAML
			</button>
			<button
				class={cn(
					'flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
					activeTab === 'describe'
						? 'bg-zinc-700 text-zinc-100'
						: 'text-zinc-500 hover:text-zinc-300'
				)}
				onclick={() => (activeTab = 'describe')}
			>
				<AlignLeft class="size-3" />
				Describe
			</button>
		</div>

		<!-- Controls -->
		<div class="flex items-center gap-0.5">
			<!-- Edit / Save buttons (YAML tab only) -->
			{#if activeTab === 'yaml' && loadState === 'loaded'}
				{#if isEditing}
					<!-- Cancel edit -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
								onclick={() => {
									editedYaml = yamlText;
									isDirty = false;
									isEditing = false;
									editorResetKey++;
								}}
								disabled={saving}
							>
								<X class="size-3.5" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Discard changes</Tooltip.Content>
					</Tooltip.Root>
					<!-- Save -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-emerald-400 hover:bg-zinc-800 hover:text-emerald-300"
								onclick={saveYaml}
								disabled={saving || !isDirty}
							>
								{#if saving}
									<Loader2 class="size-3.5 animate-spin" />
								{:else}
									<Save class="size-3.5" />
								{/if}
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Save to cluster</Tooltip.Content>
					</Tooltip.Root>
				{:else if canEdit}
					<!-- Edit toggle -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
								onclick={() => (isEditing = true)}
							>
								<Pencil class="size-3.5" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Edit manifest</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/if}

			<!-- Theme toggle (YAML tab only) -->
			{#if activeTab === 'yaml' && loadState === 'loaded'}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<Button
							variant="ghost"
							size="icon"
							class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							onclick={() => (editorTheme = editorTheme === 'dark' ? 'light' : 'dark')}
						>
							{#if editorTheme === 'dark'}
								<Sun class="size-3.5" />
							{:else}
								<Moon class="size-3.5" />
							{/if}
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content
						>{editorTheme === 'dark'
							? 'Switch to light theme'
							: 'Switch to dark theme'}</Tooltip.Content
					>
				</Tooltip.Root>
			{/if}

			<!-- Refresh -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={fetchYaml}
						disabled={loadState === 'loading'}
					>
						{#if loadState === 'loading'}
							<Loader2 class="size-3.5 animate-spin" />
						{:else}
							<RotateCcw class="size-3.5" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Refresh manifest</Tooltip.Content>
			</Tooltip.Root>

			<!-- Copy -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={copyManifest}
						disabled={!yamlText}
					>
						{#if copied}
							<CheckCheck class="size-3.5 text-emerald-400" />
						{:else}
							<Copy class="size-3.5" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Copy manifest</Tooltip.Content>
			</Tooltip.Root>

			<!-- Download -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={downloadManifest}
						disabled={!yamlText}
					>
						<Download class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Download manifest</Tooltip.Content>
			</Tooltip.Root>

			<!-- Close -->
			<Button
				variant="ghost"
				size="icon"
				class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
				onclick={handleClose}
			>
				<X class="size-3.5" />
			</Button>
		</div>
	</div>

	<!-- ── Content ────────────────────────────────────────────────────────── -->
	<div class="relative flex-1 overflow-hidden">
		<!-- Loading state -->
		{#if loadState === 'loading'}
			<div class="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
				<Loader2 class="size-4 animate-spin" />
				<span>Loading manifest…</span>
			</div>

			<!-- Error state -->
		{:else if loadState === 'error'}
			<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
				<div class="flex size-10 items-center justify-center rounded-full bg-red-500/10">
					<AlertCircle class="size-5 text-red-400" />
				</div>
				<div>
					<p class="text-sm font-medium text-zinc-200">Failed to load manifest</p>
					<p class="mt-1 max-w-sm text-xs text-zinc-500">{loadError}</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700"
					onclick={fetchYaml}
				>
					<RotateCcw class="mr-1.5 size-3" />
					Retry
				</Button>
			</div>

			<!-- Idle placeholder -->
		{:else if loadState === 'idle'}
			<div class="flex h-full items-center justify-center text-xs text-zinc-600">
				Select a resource to view its manifest
			</div>

			<!-- ── YAML Tab ────────────────────────────────────────────────── -->
		{:else if activeTab === 'yaml'}
			<div class="flex h-full flex-col overflow-hidden">
				{#if isEditing}
					<div
						class="flex shrink-0 items-center gap-2 border-b border-amber-500/20 bg-amber-950/20 px-3 py-1"
					>
						<Pencil class="size-3 shrink-0 text-amber-400" />
						<span class="text-[11px] text-amber-300"
							>Editing — changes will be applied directly to the cluster</span
						>
						{#if isDirty}
							<span class="ml-auto text-[10px] text-amber-400/70">Unsaved changes</span>
						{/if}
					</div>
				{/if}
				<CodeEditor
					value={editedYaml}
					resetKey={editorResetKey}
					language="yaml"
					theme={editorTheme}
					readonly={!isEditing}
					fontFamily={editorFontFamily}
					onchange={(v) => {
						editedYaml = v;
						isDirty = v !== yamlText;
					}}
					class="flex-1 overflow-hidden"
				/>
			</div>

			<!-- ── Describe Tab ────────────────────────────────────────────── -->
		{:else}
			<div class="h-full overflow-auto bg-zinc-950 px-3 py-2">
				{#if describeSections.length === 0}
					<p class="text-xs text-zinc-600">No content to describe.</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each describeSections as section (section.header)}
							{@const collapsed = collapsedSections.includes(section.header)}
							{@const colorCls = sectionColor(section.header)}

							<!-- Section card -->
							<div class={cn('rounded-md border', colorCls.split(' ').slice(1).join(' '))}>
								<!-- Section header / toggle -->
								<button
									class={cn(
										'flex w-full items-center gap-1.5 px-3 py-1.5 text-left',
										'rounded-md text-[11px] font-semibold tracking-wide transition-colors',
										'hover:bg-white/5',
										colorCls.split(' ')[0]
									)}
									onclick={() => toggleSection(section.header)}
								>
									{#if collapsed}
										<ChevronRight class="size-3 shrink-0 opacity-60" />
									{:else}
										<ChevronDownIcon class="size-3 shrink-0 opacity-60" />
									{/if}
									{section.header}
									<span class="ml-auto font-mono text-[10px] font-normal opacity-40">
										{section.lines.length} line{section.lines.length !== 1 ? 's' : ''}
									</span>
								</button>

								<!-- Section body -->
								{#if !collapsed}
									<div
										class="overflow-x-auto border-t border-white/5 px-1 pt-0.5 pb-1 font-mono"
										style="font-size: 12px; line-height: 1.6;"
									>
										{#each section.lines as line, li (li)}
											{@const segs = tokenizeLine(line)}
											<div class="flex items-baseline rounded px-1 py-px hover:bg-white/5">
												<span class="flex-1 whitespace-pre">
													{#each segs as seg, si (si)}
														<span class={seg.cls}>{seg.text}</span>
													{/each}
												</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ── Status bar ─────────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center justify-between border-t border-zinc-800/60 bg-zinc-900/50 px-3 py-0.5"
	>
		<span class="font-mono text-[10px] text-zinc-600">
			{#if loadState === 'loaded'}
				{yamlText.split('\n').length} lines · {(
					new TextEncoder().encode(yamlText).length / 1024
				).toFixed(1)} kB
				{#if isDirty}<span class="ml-2 text-amber-400/80">· unsaved changes</span>{/if}
			{:else if loadState === 'loading'}
				Loading…
			{:else if loadState === 'error'}
				Error
			{:else}
				—
			{/if}
		</span>
		<span class="font-mono text-[10px] text-zinc-700">
			{resource?.resourceType ?? ''}
			{resource?.name ? ` · ${resource.name}` : ''}
			{resource?.namespace ? ` · ${resource.namespace}` : ''}
		</span>
	</div>
</div>

<!-- Cursor override while dragging -->
{#if isDragging}
	<div class="fixed inset-0 z-9999 cursor-ns-resize"></div>
{/if}
