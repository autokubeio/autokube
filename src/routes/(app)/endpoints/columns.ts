import { Network } from 'lucide-svelte';

export type Endpoint = {
	id: string;
	name: string;
	namespace: string;
	subsets: Array<{
		addresses?: Array<{
			ip?: string;
			nodeName?: string;
		}>;
		ports?: Array<{
			name?: string;
			port?: number;
			protocol?: string;
		}>;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type EndpointWithAge = Endpoint & { age: string };

/**
 * Extract all addresses from subsets
 */
export function getAddresses(subsets: Endpoint['subsets']): string[] {
	if (!subsets || subsets.length === 0) return [];
	const addresses: string[] = [];
	for (const subset of subsets) {
		if (subset.addresses) {
			for (const addr of subset.addresses) {
				if (addr.ip) addresses.push(addr.ip);
			}
		}
	}
	return addresses;
}

/**
 * Format addresses for display
 */
export function formatAddresses(subsets: Endpoint['subsets']): string {
	const addrs = getAddresses(subsets);
	if (addrs.length === 0) return '—';
	if (addrs.length <= 3) return addrs.join(', ');
	return `${addrs.slice(0, 3).join(', ')} +${addrs.length - 3} more`;
}

/**
 * Extract all ports from subsets
 */
export function getPorts(subsets: Endpoint['subsets']): Array<{ port: number; protocol: string; name?: string }> {
	if (!subsets || subsets.length === 0) return [];
	const ports: Array<{ port: number; protocol: string; name?: string }> = [];
	const seen = new Set<string>();
	for (const subset of subsets) {
		if (subset.ports) {
			for (const p of subset.ports) {
				const key = `${p.port}/${p.protocol}`;
				if (!seen.has(key)) {
					seen.add(key);
					ports.push({
						port: p.port || 0,
						protocol: p.protocol || 'TCP',
						name: p.name
					});
				}
			}
		}
	}
	return ports;
}

/**
 * Format ports for display: "80/TCP, 443/TCP"
 */
export function formatPorts(subsets: Endpoint['subsets']): string {
	const ports = getPorts(subsets);
	if (ports.length === 0) return '—';
	return ports.map((p) => `${p.port}/${p.protocol}`).join(', ');
}
