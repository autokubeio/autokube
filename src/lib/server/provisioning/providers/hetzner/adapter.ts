/**
 * Hetzner Cloud provider adapter.
 * Transforms AutoKube provisioning config into terraform.tfvars.json
 * for the Hetzner K3s Terraform templates.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerProvider, type ProviderAdapter, type ProviderAdapterInput } from '../index';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const hetznerAdapter: ProviderAdapter = {
	id: 'hetzner',
	name: 'Hetzner Cloud',
	templatesDir: join(__dirname, 'templates'),

	buildTfvars(input: Omit<ProviderAdapterInput, 'sshPrivateKey'>): Record<string, unknown> {
		const { clusterName, k3sVersion, providerToken, sshPublicKey, sshKeyName, k3sToken, mastersPool, workerPools, networking } = input;

		// Flatten worker pools — autoscaling uses minInstances as the static count
		const workerPoolsTf = workerPools.map((p) => ({
			name: p.name,
			count: p.autoscaling?.enabled ? p.autoscaling.minInstances : p.count,
			instance_type: p.instanceType,
			location: p.location
		}));

		// Flatten extra firewall rules from the networking config
		const extraFirewallRules = (networking.allowedPorts ?? []).map((r) => ({
			port: r.port,
			protocol: r.protocol,
			source_ips: Array.isArray(r.sourceIps)
				? r.sourceIps
				: typeof r.sourceIps === 'string'
					? (r.sourceIps as string)
						.split(',')
						.map((s: string) => s.trim())
						.filter(Boolean)
					: []
		}));

		return {
			hcloud_token: providerToken,
			cluster_name: clusterName,
			k3s_version: k3sVersion,
			k3s_token: k3sToken,
			ssh_public_key: sshPublicKey,
			ssh_key_name: sshKeyName,
			master_count: mastersPool.count,
			master_instance_type: mastersPool.instanceType,
			master_locations: mastersPool.locations.length > 0 ? mastersPool.locations : ['nbg1'],
			worker_pools: workerPoolsTf,
			network_zone: networking.networkZone ?? 'eu-central',
			use_private_network: networking.usePrivateNetwork ?? false,
			create_load_balancer: networking.createLoadBalancer ?? false,
			extra_firewall_rules: extraFirewallRules
		};
	}
};

// Auto-register on import
registerProvider(hetznerAdapter);
