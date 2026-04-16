export type Ingress = {
	name: string;
	namespace: string;
	hosts: string[];
	paths: Array<{
		path: string;
		pathType: string;
		host: string;
		backend: { service: string; port: string | number };
	}>;
	tls: Array<{ hosts: string[]; secretName?: string }>;
	ingressClass?: string;
	addresses: string[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type IngressWithAge = Ingress & { age: string; id: string };

/**
 * Format hosts for display
 */
export function formatHosts(hosts: string[]): string {
	if (!hosts || hosts.length === 0) return '*';
	if (hosts.length <= 2) return hosts.join(', ');
	return `${hosts.slice(0, 2).join(', ')} +${hosts.length - 2} more`;
}

/**
 * Format addresses for display
 */
export function formatAddresses(addresses: string[]): string {
	if (!addresses || addresses.length === 0) return '—';
	if (addresses.length <= 2) return addresses.join(', ');
	return `${addresses.slice(0, 2).join(', ')} +${addresses.length - 2} more`;
}

/**
 * Check if TLS is enabled
 */
export function hasTls(tls: Ingress['tls']): boolean {
	return tls && tls.length > 0;
}

/**
 * Format path for display: host + path -> backend
 */
export function formatPath(p: Ingress['paths'][number]): string {
	const host = p.host === '*' ? '' : p.host;
	const port = p.backend.port ? `:${p.backend.port}` : '';
	return `${host}${p.path} → ${p.backend.service}${port}`;
}
