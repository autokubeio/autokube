/**
 * Provider adapter interface — every cloud provider must implement this.
 * The adapter transforms AutoKube's internal WizardData/DB config into
 * a provider-specific `terraform.tfvars.json` object.
 */

import type { FirewallRule } from '$lib/server/queries/provisioned-clusters';

// ── Shared input types ────────────────────────────────────────────────────────

export interface MastersPoolInput {
	count: number;
	instanceType: string;
	locations: string[];
	sshKeyId?: number;
}

export interface WorkerPoolInput {
	name: string;
	count: number;
	instanceType: string;
	location: string;
	autoscaling?: { enabled: boolean; minInstances: number; maxInstances: number };
}

export interface NetworkingInput {
	networkZone?: string;
	cniPlugin?: string;
	usePrivateNetwork?: boolean;
	createLoadBalancer?: boolean;
	allowedPorts?: FirewallRule[];
}

export interface ProviderAdapterInput {
	clusterName: string;
	k3sVersion: string;
	providerToken: string;
	sshPublicKey: string;
	sshKeyName: string;
	/** Decrypted SSH private key — used by kubeconfig retrieval (not passed to Terraform). */
	sshPrivateKey: string;
	k3sToken: string;
	mastersPool: MastersPoolInput;
	workerPools: WorkerPoolInput[];
	networking: NetworkingInput;
}

// ── Provider adapter contract ────────────────────────────────────────────────

export interface ProviderAdapter {
	/** Identifier matching the `provider` column in `provisioned_clusters`. */
	readonly id: string;
	/** Human-readable display name. */
	readonly name: string;
	/** Absolute path to the directory containing this provider's .tf templates. */
	readonly templatesDir: string;
	/**
	 * Transform the AutoKube provisioning input into a key-value object that
	 * becomes `terraform.tfvars.json` inside the job workspace.
	 * Note: sshPrivateKey must NOT be written to tfvars — it is only used
	 * post-apply by the engine to fetch the kubeconfig over SSH.
	 */
	buildTfvars(input: Omit<ProviderAdapterInput, 'sshPrivateKey'>): Record<string, unknown>;
}

// ── Provider registry ────────────────────────────────────────────────────────

const registry = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
	registry.set(adapter.id, adapter);
}

export function getProviderAdapter(providerId: string): ProviderAdapter {
	const adapter = registry.get(providerId);
	if (!adapter) {
		throw new Error(`No provider adapter registered for "${providerId}". Available: ${[...registry.keys()].join(', ')}`);
	}
	return adapter;
}

export function listProviders(): ProviderAdapter[] {
	return [...registry.values()];
}
