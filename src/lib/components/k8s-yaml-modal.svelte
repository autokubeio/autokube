<!--
	Universal Kubernetes Resource YAML Editor Modal
	
	A general-purpose modal for viewing and editing YAML for any Kubernetes resource.
	
	Features:
	- Supports all K8s resource types (pods, deployments, services, etc.)
	- Auto-determines editability (pods read-only, deployments editable, etc.)
	- Dark/light theme toggle
	- Dirty state tracking with confirmation on close
	- Resource-specific error messages
	
	Usage Example (Pods):
		<K8sResourceYamlModal
			bind:open={showYamlDialog}
			clusterId={cluster.id}
			resourceType="pod"
			resourceName={podName}
			namespace={namespace}
			readonly={false}  // Optional: override default readonly behavior
			onClose={handleClose}
			onSuccess={handleSuccess}
		/>
	
	Usage Example (Deployments):
		<K8sResourceYamlModal
			bind:open={showYamlDialog}
			clusterId={cluster.id}
			resourceType="deployment"
			resourceName={deploymentName}
			namespace={namespace}
			onClose={handleClose}
			onSuccess={handleSuccess}
		/>
	
	Usage Example (Cluster-scoped resources like Nodes):
		<K8sResourceYamlModal
			bind:open={showYamlDialog}
			clusterId={cluster.id}
			resourceType="node"
			resourceName={nodeName}
			onClose={handleClose}
			onSuccess={handleSuccess}
		/>
-->

<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Alert from '$lib/components/ui/alert';
	import CodeEditor from '$lib/components/code-editor.svelte';
	import { toast } from 'svelte-sonner';
	import {
		FileCode,
		Sun,
		Moon,
		Loader2,
		AlertCircle,
		RefreshCw,
		Save,
		X,
		Box,
		Play,
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

	// Resource type definition
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
		| 'event';

	interface Props {
		open: boolean;
		clusterId: number;
		resourceType: K8sResourceType;
		resourceName: string;
		namespace?: string;
		readonly?: boolean;
		onClose: () => void;
		onSuccess?: () => void;
	}

	let {
		open = $bindable(),
		clusterId,
		resourceType,
		resourceName,
		namespace,
		readonly,
		onClose,
		onSuccess
	}: Props = $props();

	// Resource metadata configuration
	const resourceConfig: Record<
		K8sResourceType,
		{
			displayName: string;
			icon: any;
			apiPath: string;
			defaultReadonly: boolean;
			immutabilityMessage?: string;
		}
	> = {
		pod: {
			displayName: 'Pod',
			icon: Box,
			apiPath: 'pods',
			defaultReadonly: true,
			immutabilityMessage: 'pod-immutable'
		},
		deployment: {
			displayName: 'Deployment',
			icon: GitBranch,
			apiPath: 'deployments',
			defaultReadonly: false
		},
		service: {
			displayName: 'Service',
			icon: Network,
			apiPath: 'services',
			defaultReadonly: false
		},
		configmap: {
			displayName: 'ConfigMap',
			icon: FileText,
			apiPath: 'configmaps',
			defaultReadonly: false
		},
		secret: {
			displayName: 'Secret',
			icon: Key,
			apiPath: 'secrets',
			defaultReadonly: false
		},
		ingress: {
			displayName: 'Ingress',
			icon: Globe,
			apiPath: 'ingresses',
			defaultReadonly: false
		},
		daemonset: {
			displayName: 'DaemonSet',
			icon: Server,
			apiPath: 'daemonsets',
			defaultReadonly: false
		},
		statefulset: {
			displayName: 'StatefulSet',
			icon: Database,
			apiPath: 'statefulsets',
			defaultReadonly: false
		},
		job: {
			displayName: 'Job',
			icon: Package,
			apiPath: 'jobs',
			defaultReadonly: false
		},
		cronjob: {
			displayName: 'CronJob',
			icon: Package,
			apiPath: 'cronjobs',
			defaultReadonly: false
		},
		replicaset: {
			displayName: 'ReplicaSet',
			icon: Layers,
			apiPath: 'replicasets',
			defaultReadonly: false
		},
		namespace: {
			displayName: 'Namespace',
			icon: Box,
			apiPath: 'namespaces',
			defaultReadonly: false
		},
		node: {
			displayName: 'Node',
			icon: Server,
			apiPath: 'nodes',
			defaultReadonly: false
		},
		persistentvolume: {
			displayName: 'PersistentVolume',
			icon: Database,
			apiPath: 'persistentvolumes',
			defaultReadonly: false
		},
		persistentvolumeclaim: {
			displayName: 'PersistentVolumeClaim',
			icon: Database,
			apiPath: 'persistentvolumeclaims',
			defaultReadonly: false
		},
		serviceaccount: {
			displayName: 'ServiceAccount',
			icon: Shield,
			apiPath: 'serviceaccounts',
			defaultReadonly: false
		},
		role: {
			displayName: 'Role',
			icon: Shield,
			apiPath: 'roles',
			defaultReadonly: false
		},
		rolebinding: {
			displayName: 'RoleBinding',
			icon: Shield,
			apiPath: 'rolebindings',
			defaultReadonly: false
		},
		clusterrole: {
			displayName: 'ClusterRole',
			icon: Shield,
			apiPath: 'clusterroles',
			defaultReadonly: false
		},
		clusterrolebinding: {
			displayName: 'ClusterRoleBinding',
			icon: Shield,
			apiPath: 'clusterrolebindings',
			defaultReadonly: false
		},
		networkpolicy: {
			displayName: 'NetworkPolicy',
			icon: Network,
			apiPath: 'networkpolicies',
			defaultReadonly: false
		},
		resourcequota: {
			displayName: 'ResourceQuota',
			icon: FileText,
			apiPath: 'resourcequotas',
			defaultReadonly: false
		},
		limitrange: {
			displayName: 'LimitRange',
			icon: FileText,
			apiPath: 'limitranges',
			defaultReadonly: false
		},
		hpa: {
			displayName: 'HorizontalPodAutoscaler',
			icon: GitBranch,
			apiPath: 'hpas',
			defaultReadonly: false
		},
		storageclass: {
			displayName: 'StorageClass',
			icon: Database,
			apiPath: 'storageclasses',
			defaultReadonly: false
		},
		ingressclass: {
			displayName: 'IngressClass',
			icon: Globe,
			apiPath: 'ingressclasses',
			defaultReadonly: false
		},
		endpoint: {
			displayName: 'Endpoint',
			icon: Network,
			apiPath: 'endpoints',
			defaultReadonly: false
		},
		endpointslice: {
			displayName: 'EndpointSlice',
			icon: Network,
			apiPath: 'endpointslices',
			defaultReadonly: false
		},
		event: {
			displayName: 'Event',
			icon: FileText,
			apiPath: 'events',
			defaultReadonly: true
		}
	};

	// Derived values
	const config = $derived(resourceConfig[resourceType]);
	const isReadonly = $derived(readonly ?? config.defaultReadonly);
	const ResourceIcon = $derived(config.icon);

	// State
	let yamlContent = $state('');
	let originalYamlContent = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let editorTheme = $state<'light' | 'dark'>('dark');
	let isDirty = $state(false);
	let showConfirmClose = $state(false);
	// Increment to force-reset editor content (only on explicit load, not on every keystroke)
	let editorResetKey = $state(0);

	// Load YAML when dialog opens
	$effect(() => {
		if (open && clusterId && resourceName) {
			loadYaml();
			editorTheme =
				typeof document !== 'undefined' &&
				document.documentElement.classList.contains('dark')
					? 'dark'
					: 'light';
		}
	});

	async function loadYaml() {
		loading = true;
		error = null;

		try {
			// Build URL parameters
			const params = new URLSearchParams({
				cluster: String(clusterId),
				resourceType,
				name: resourceName
			});

			if (namespace) {
				params.set('namespace', namespace);
			}

			const response = await fetch(`/api/k8s/yaml?${params}`);
			const result = await response.json();

			if (result.success && result.yaml) {
				yamlContent = result.yaml;
				originalYamlContent = result.yaml;
				isDirty = false;
				error = null;
				editorResetKey++; // Tell the editor to reset its content
			} else {
				error = result.error || `Failed to fetch ${config.displayName} YAML`;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : `Failed to fetch ${config.displayName} YAML`;
		} finally {
			loading = false;
		}
	}

	async function saveYaml(keepOpen: boolean = false) {
		saving = true;
		error = null;

		try {
			// Build URL parameters
			const params = new URLSearchParams({
				cluster: String(clusterId),
				resourceType,
				name: resourceName
			});

			if (namespace) {
				params.set('namespace', namespace);
			}

			const response = await fetch(`/api/k8s/yaml?${params}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ yaml: yamlContent })
			});

			const result = await response.json();

			if (result.success) {
				isDirty = false;

				// Save resource info for toast before closing (handleClose resets these values)
				const resourceDisplay = namespace
					? `${config.displayName} "${resourceName}" in namespace "${namespace}"`
					: `${config.displayName} "${resourceName}"`;

				handleClose();
				onSuccess?.();

				if (result.warning) {
					// Some fields were silently reverted by Kubernetes
					toast.warning(result.warning);
				} else {
					toast.success(`Successfully updated ${resourceDisplay}`);
				}
			} else {
				// Parse Kubernetes error for better messaging
				const errorMsg = result.error || `Failed to update ${config.displayName}`;

				// Show resource-specific immutability message if configured
				if (
					config.immutabilityMessage &&
					(errorMsg.includes('Forbidden') ||
						errorMsg.includes('may not change fields') ||
						errorMsg.includes('422'))
				) {
					error = config.immutabilityMessage;
					toast.error(config.immutabilityMessage);
				} else if (errorMsg.includes('422') || errorMsg.includes('Invalid')) {
					// Remove warning emoji if present
					error = errorMsg.replace(/^⚠️\s*/, '');
					toast.error(error || 'Validation error');
				} else {
					error = errorMsg;
					toast.error(errorMsg);
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : `Failed to update ${config.displayName}`;
		} finally {
			saving = false;
		}
	}

	function handleClose() {
		yamlContent = '';
		originalYamlContent = '';
		isDirty = false;
		error = null;
		editorTheme = 'dark';
		onClose();
	}

	function handleYamlChange(newContent: string) {
		yamlContent = newContent;
		isDirty = newContent !== originalYamlContent;
		if (error) error = null;
	}

	function toggleTheme() {
		editorTheme = editorTheme === 'light' ? 'dark' : 'light';
	}

	function tryClose() {
		if (isDirty && !isReadonly) {
			showConfirmClose = true;
		} else {
			handleClose();
		}
	}

	function discardAndClose() {
		showConfirmClose = false;
		handleClose();
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(isOpen) => {
		if (!isOpen) handleClose();
	}}
>
	<Dialog.Content class="max-w-5xl h-[85vh] flex flex-col p-0" showCloseButton={false}>
		<Dialog.Header class="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2">
						<div class="p-1.5 rounded-md bg-zinc-200 dark:bg-zinc-700">
							<ResourceIcon class="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
						</div>
						<div>
							<Dialog.Title class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
								{isReadonly ? `View ${config.displayName} YAML` : `Edit ${config.displayName} YAML`}
							</Dialog.Title>
							<Dialog.Description class="text-xs text-zinc-500 dark:text-zinc-400">
								{#if namespace}
									{namespace}/{resourceName}
								{:else}
									{resourceName}
								{/if}
							</Dialog.Description>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<!-- Theme toggle -->
					<button
						type="button"
						onclick={toggleTheme}
						tabindex="-1"
						class="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
						title={editorTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
					>
						{#if editorTheme === 'light'}
							<Moon class="w-4 h-4" />
						{:else}
							<Sun class="w-4 h-4" />
						{/if}
					</button>

					<!-- Close button -->
					<button
						type="button"
						onclick={tryClose}
						tabindex="-1"
						class="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
					>
						<X class="w-4 h-4" />
					</button>
				</div>
			</div>
		</Dialog.Header>

		{#if loading}
			<div class="flex-1 flex items-center justify-center px-6 pb-6">
				<div class="flex flex-col items-center gap-2">
					<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
					<p class="text-sm text-muted-foreground">Loading YAML...</p>
				</div>
			</div>
		{:else if error && !yamlContent}
			<div class="flex-1 flex items-center justify-center px-6 pb-6">
				<div class="flex flex-col items-center gap-2">
					<AlertCircle class="w-6 h-6 text-destructive" />
					<p class="text-sm text-destructive font-medium">Failed to load YAML</p>
					<p class="text-xs text-muted-foreground text-center max-w-md">{error}</p>
					<Button size="sm" variant="outline" onclick={loadYaml} class="mt-2">
						<RefreshCw class="w-3 h-3 mr-1.5" />
						Retry
					</Button>
				</div>
			</div>
		{:else}
			<div class="flex-1 min-h-0 overflow-hidden px-6 py-4 flex flex-col gap-3">
				{#if error}
					{#if error === 'pod-immutable'}
						<!-- Pod-specific immutability warning -->
						<Alert.Root class="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
							<AlertCircle class="h-4 w-4 text-amber-600 dark:text-amber-500" />
							<Alert.Title class="text-sm font-semibold text-amber-900 dark:text-amber-200"
								>Pods are mostly immutable</Alert.Title
							>
							<Alert.Description class="text-sm text-amber-800 dark:text-amber-300 mt-2 space-y-2">
								<p class="font-medium">Most Pod fields cannot be changed after creation.</p>
								<div class="space-y-1">
									<p class="text-xs font-semibold">Editable fields:</p>
									<ul class="text-xs space-y-0.5 ml-4 list-disc">
										<li><code class="px-1 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/30">spec.containers[*].image</code></li>
										<li><code class="px-1 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/30">spec.activeDeadlineSeconds</code></li>
										<li><code class="px-1 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/30">spec.tolerations</code></li>
									</ul>
								</div>
								<div class="pt-1">
									<p class="text-xs">
										💡 <strong>Tip:</strong> To modify other fields (like command, args, ports, env), edit the parent
										<strong>Deployment</strong> or <strong>ReplicaSet</strong> instead.
									</p>
								</div>
							</Alert.Description>
						</Alert.Root>
					{:else}
						<!-- Generic error -->
						<Alert.Root class="border-destructive/50 bg-destructive/10">
							<AlertCircle class="h-4 w-4 text-destructive" />
							<Alert.Title class="text-sm font-semibold text-destructive"
								>Failed to update {config.displayName}</Alert.Title
							>
							<Alert.Description class="text-sm text-destructive/90 mt-2">
								{error}
							</Alert.Description>
						</Alert.Root>
					{/if}
				{/if}
				<CodeEditor
					value={yamlContent}
					resetKey={editorResetKey}
					language="yaml"
					theme={editorTheme}
					readonly={isReadonly}
					onchange={handleYamlChange}
					class="flex-1 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700"
				/>
			</div>
			{#if !isReadonly}
				<!-- Footer -->
				<div
					class="px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0 gap-3"
				>
					<div class="text-xs text-zinc-500 dark:text-zinc-400">
						{#if isDirty}
							<span class="text-amber-600 dark:text-amber-500">Unsaved changes</span>
						{:else}
							No changes
						{/if}
					</div>

					<div class="flex items-center gap-2">
						<Button variant="outline" size="sm" onclick={tryClose} disabled={saving}>
							Cancel
						</Button>

						<Button
							variant="outline"
							size="sm"
							class="w-20"
							onclick={() => saveYaml(false)}
							disabled={saving || !yamlContent.trim()}
						>
							{#if saving}
								<Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />
								Saving...
							{:else}
								<Save class="w-3.5 h-3.5 mr-1.5" />
								Save
							{/if}
						</Button>

						<Button size="sm" onclick={() => saveYaml(true)} disabled={saving || !yamlContent.trim()}>
							{#if saving}
								<Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />
								Applying...
							{:else}
								<Play class="w-3.5 h-3.5 mr-1.5" />
								Save & Apply
							{/if}
						</Button>
					</div>
				</div>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Unsaved changes confirmation dialog -->
<Dialog.Root bind:open={showConfirmClose}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Unsaved changes</Dialog.Title>
			<Dialog.Description>
				You have unsaved changes. Are you sure you want to close without saving?
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex justify-end gap-1.5 mt-4">
			<Button variant="outline" size="sm" onclick={() => (showConfirmClose = false)}>
				Continue editing
			</Button>
			<Button variant="destructive" size="sm" onclick={discardAndClose}>
				Discard changes
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
