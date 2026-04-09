<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import {
		Cloud,
		Settings2,
		Server,
		Shield,
		Plug,
		CheckCircle2,
		ChevronRight,
		ChevronLeft,
		Loader2,
		AlertTriangle
	} from 'lucide-svelte';
	import StepProvider from './step-provider.svelte';
	import StepGeneral from './step-general.svelte';
	import StepNodes from './step-nodes.svelte';
	import StepNetworking from './step-networking.svelte';
	import StepConnection from './step-connection.svelte';
	import StepReview from './step-review.svelte';
	import { provisionedClustersStore } from '$lib/stores/provisioned-clusters.svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	export interface WizardData {
		// Step 1 – Provider
		provider: string;
		// Step 2 – General
		clusterName: string;
		k3sVersion: string;
		labels: string[];
		sshKeyId: number | null;
		// Step 3 – Nodes
		masterCount: number;
		masterInstanceType: string;
		masterLocation: string;
		workerPools: WorkerPool[];
		// Step 4 – Networking
		networkZone: string;
		cniPlugin: string;
		usePrivateNetwork: boolean;
		createLoadBalancer: boolean;
		firewallRules: FirewallRule[];
		// Step 5 – Connection
		connectionType: 'kubeconfig' | 'agent' | 'bearer-token';
		apiServer: string;
		bearerToken: string;
		// Meta
		providerToken: string;
		protectAgainstDeletion: boolean;
	}

	export interface WorkerPool {
		id: string;
		name: string;
		count: number;
		instanceType: string;
		location: string;
	}

	export interface FirewallRule {
		id: string;
		port: string;
		protocol: 'tcp' | 'udp' | 'icmp';
		direction: 'inbound' | 'outbound';
		description: string;
		sourceIps: string;
	}

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		open = $bindable(false),
		onSuccess
	}: {
		open?: boolean;
		onSuccess?: (id: number) => void;
	} = $props();

	// ── Steps ─────────────────────────────────────────────────────────────────

	const STEPS = [
		{ id: 'provider', label: 'Provider', Icon: Cloud },
		{ id: 'general', label: 'General', Icon: Settings2 },
		{ id: 'nodes', label: 'Nodes', Icon: Server },
		{ id: 'networking', label: 'Networking', Icon: Shield },
		{ id: 'connection', label: 'Connection', Icon: Plug },
		{ id: 'review', label: 'Review', Icon: CheckCircle2 }
	] as const;

	type StepId = (typeof STEPS)[number]['id'];

	let currentStep = $state<StepId>('provider');
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});

	const currentStepIndex = $derived(STEPS.findIndex((s) => s.id === currentStep));
	const isFirstStep = $derived(currentStepIndex === 0);
	const isLastStep = $derived(currentStepIndex === STEPS.length - 1);

	// ── Wizard Data ───────────────────────────────────────────────────────────

	let data = $state<WizardData>({
		provider: 'hetzner',
		clusterName: '',
		k3sVersion: 'v1.32.0+k3s1',
		labels: [],
		sshKeyId: null,
		masterCount: 1,
		masterInstanceType: 'cx22',
		masterLocation: 'nbg1',
		workerPools: [
			{
				id: crypto.randomUUID(),
				name: 'worker-pool-1',
				count: 2,
				instanceType: 'cx22',
				location: 'nbg1'
			}
		],
		networkZone: 'eu-central',
		cniPlugin: 'flannel',
		usePrivateNetwork: true,
		createLoadBalancer: false,
		firewallRules: [
			{
				id: crypto.randomUUID(),
				port: '6443',
				protocol: 'tcp',
				direction: 'inbound',
				description: 'Kubernetes API server',
				sourceIps: '0.0.0.0/0'
			},
			{
				id: crypto.randomUUID(),
				port: '22',
				protocol: 'tcp',
				direction: 'inbound',
				description: 'SSH access',
				sourceIps: '0.0.0.0/0'
			}
		],
		connectionType: 'kubeconfig',
		apiServer: '',
		bearerToken: '',
		providerToken: '',
		protectAgainstDeletion: true
	});

	// ── Navigation ────────────────────────────────────────────────────────────

	function validateStep(stepId: StepId): Record<string, string> {
		const e: Record<string, string> = {};
		if (stepId === 'general') {
			if (!data.clusterName.trim()) e.clusterName = 'Cluster name is required.';
			if (!data.sshKeyId) e.sshKeyId = 'An SSH key is required.';
		}
		return e;
	}

	function next() {
		const stepErrors = validateStep(currentStep);
		if (Object.keys(stepErrors).length > 0) {
			errors = stepErrors;
			return;
		}
		errors = {};
		const idx = currentStepIndex;
		if (idx < STEPS.length - 1) {
			currentStep = STEPS[idx + 1].id;
		}
	}

	function prev() {
		errors = {};
		const idx = currentStepIndex;
		if (idx > 0) {
			currentStep = STEPS[idx - 1].id;
		}
	}

	function goToStep(id: StepId) {
		const targetIdx = STEPS.findIndex((s) => s.id === id);
		// Only allow going back or to completed steps
		if (targetIdx <= currentStepIndex) {
			currentStep = id;
		}
	}

	function resetWizard() {
		currentStep = 'provider';
		saving = false;
		errors = {};
		data = {
			provider: 'hetzner',
			clusterName: '',
			k3sVersion: 'v1.32.0+k3s1',
			labels: [],
			sshKeyId: null,
			masterCount: 1,
			masterInstanceType: 'cx22',
			masterLocation: 'nbg1',
			workerPools: [
				{
					id: crypto.randomUUID(),
					name: 'worker-pool-1',
					count: 2,
					instanceType: 'cx22',
					location: 'nbg1'
				}
			],
			networkZone: 'eu-central',
			cniPlugin: 'flannel',
			usePrivateNetwork: true,
			createLoadBalancer: false,
			firewallRules: [
				{
					id: crypto.randomUUID(),
					port: '6443',
					protocol: 'tcp',
					direction: 'inbound',
					description: 'Kubernetes API server',
					sourceIps: '0.0.0.0/0'
				},
				{
					id: crypto.randomUUID(),
					port: '22',
					protocol: 'tcp',
					direction: 'inbound',
					description: 'SSH access',
					sourceIps: '0.0.0.0/0'
				}
			],
			connectionType: 'kubeconfig',
			apiServer: '',
			bearerToken: '',
			providerToken: '',
			protectAgainstDeletion: true
		};
	}

	$effect(() => {
		if (!open) resetWizard();
	});

	// ── Submit ────────────────────────────────────────────────────────────────

	async function handleCreate() {
		saving = true;
		try {
			const mastersPoolConfig = {
				count: data.masterCount,
				instanceType: data.masterInstanceType,
				location: data.masterLocation
			};

			const workerPoolsConfig = data.workerPools.map((p) => ({
				name: p.name,
				count: p.count,
				instanceType: p.instanceType,
				location: p.location
			}));

			const networkingConfig = {
				networkZone: data.networkZone,
				cniPlugin: data.cniPlugin,
				usePrivateNetwork: data.usePrivateNetwork,
				allowedPorts: data.firewallRules.map((r) => ({
					port: r.port,
					protocol: r.protocol,
					direction: r.direction,
					description: r.description,
					sourceIps: r.sourceIps
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				}))
			};

			const cluster = await provisionedClustersStore.create({
				clusterName: data.clusterName,
				provider: data.provider,
				k3sVersion: data.k3sVersion,
				providerToken: data.providerToken || undefined,
				protectAgainstDeletion: data.protectAgainstDeletion,
				createLoadBalancer: data.createLoadBalancer,
				networkingConfig,
				mastersPoolConfig,
				workerPoolsConfig
			});

			toast.success(`Cluster "${data.clusterName}" created successfully`);
			open = false;
			onSuccess?.(cluster.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create cluster');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-3xl p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
		<!-- Header -->
		<Dialog.Header class="px-6 pt-5 pb-4 border-b border-border">
			<Dialog.Title class="text-base font-semibold">Provision New Cluster</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				Set up a new Kubernetes (K3s) cluster on a cloud provider.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-1 min-h-0">
			<!-- Sidebar / Step Navigator -->
			<aside class="w-48 shrink-0 border-r border-border bg-muted/30 px-3 py-4 flex flex-col gap-1">
				{#each STEPS as step, i}
					{@const completed = i < currentStepIndex}
					{@const active = step.id === currentStep}
					<button
						type="button"
						onclick={() => goToStep(step.id)}
						disabled={i > currentStepIndex}
						class={cn(
							'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors text-left w-full',
							active
								? 'bg-primary text-primary-foreground'
								: completed
									? 'text-foreground hover:bg-accent cursor-pointer'
									: 'text-muted-foreground cursor-not-allowed'
						)}
					>
						<span
							class={cn(
								'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
								active
									? 'border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground'
									: completed
										? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
										: 'border-border bg-background text-muted-foreground'
							)}
						>
							{#if completed}
								<CheckCircle2 class="size-3" />
							{:else}
								{i + 1}
							{/if}
						</span>
						{step.label}
					</button>
				{/each}
			</aside>

			<!-- Step Content -->
			<div class="flex-1 overflow-y-auto px-6 py-4">
				{#if currentStep === 'provider'}
					<StepProvider bind:data />
				{:else if currentStep === 'general'}
					<StepGeneral bind:data {errors} />
				{:else if currentStep === 'nodes'}
					<StepNodes bind:data />
				{:else if currentStep === 'networking'}
					<StepNetworking bind:data />
				{:else if currentStep === 'connection'}
					<StepConnection bind:data />
				{:else if currentStep === 'review'}
					<StepReview {data} />
				{/if}
			</div>
		</div>

		<!-- Footer / Navigation -->
		<div class="flex items-center justify-between border-t border-border px-6 py-3 bg-muted/20">
			<Button variant="outline" size="sm" onclick={prev} disabled={isFirstStep || saving}>
				<ChevronLeft class="size-3.5 mr-1" />
				Back
			</Button>
			<div class="flex items-center gap-2">
				{#each STEPS as step, i}
					<div
						class={cn(
							'h-1.5 rounded-full transition-all',
							i === currentStepIndex
								? 'w-4 bg-primary'
								: i < currentStepIndex
									? 'w-1.5 bg-emerald-500'
									: 'w-1.5 bg-border'
						)}
					></div>
				{/each}
			</div>
			{#if isLastStep}
				<Button size="sm" onclick={handleCreate} disabled={saving}>
					{#if saving}
						<Loader2 class="size-3.5 mr-1.5 animate-spin" />
						Creating...
					{:else}
						<CheckCircle2 class="size-3.5 mr-1.5" />
						Create Cluster
					{/if}
				</Button>
			{:else}
				<Button size="sm" onclick={next} disabled={saving}>
					Next
					<ChevronRight class="size-3.5 ml-1" />
				</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
