export type EndpointSlice = {
	id: string;
	name: string;
	namespace: string;
	addressType: string;
	endpoints: Array<{
		addresses?: string[];
		conditions?: {
			ready?: boolean;
		};
	}>;
	ports: Array<{
		name?: string;
		port?: number;
		protocol?: string;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type EndpointSliceWithAge = EndpointSlice & { age: string };

/**
 * Count total addresses across all endpoints
 */
export function getEndpointCount(endpoints: EndpointSlice['endpoints']): number {
	if (!endpoints || endpoints.length === 0) return 0;
	let count = 0;
	for (const ep of endpoints) {
		count += ep.addresses?.length ?? 0;
	}
	return count;
}

/**
 * Get all addresses from endpoints
 */
export function getAddresses(endpoints: EndpointSlice['endpoints']): string[] {
	if (!endpoints || endpoints.length === 0) return [];
	const addresses: string[] = [];
	for (const ep of endpoints) {
		if (ep.addresses) {
			addresses.push(...ep.addresses);
		}
	}
	return addresses;
}

/**
 * Format addresses for display
 */
export function formatAddresses(endpoints: EndpointSlice['endpoints']): string {
	const addrs = getAddresses(endpoints);
	if (addrs.length === 0) return '—';
	if (addrs.length <= 3) return addrs.join(', ');
	return `${addrs.slice(0, 3).join(', ')} +${addrs.length - 3} more`;
}

/**
 * Format ports for display
 */
export function formatPorts(ports: EndpointSlice['ports']): string {
	if (!ports || ports.length === 0) return '—';
	return ports.map((p) => `${p.port}/${p.protocol || 'TCP'}`).join(', ');
}

/**
 * Get address type badge color
 */
export function getAddressTypeColor(addressType: string): string {
	switch (addressType) {
		case 'IPv4':
			return 'bg-blue-500/15 text-blue-700 dark:text-blue-400';
		case 'IPv6':
			return 'bg-purple-500/15 text-purple-700 dark:text-purple-400';
		case 'FQDN':
			return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
		default:
			return 'bg-gray-500/15 text-gray-700 dark:text-gray-400';
	}
}
