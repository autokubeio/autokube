import { CheckCircle2, Globe, Server, HelpCircle, Network } from 'lucide-svelte';

export type Service = {
	name: string;
	namespace: string;
	type: string;
	clusterIP: string;
	externalIPs: string[];
	ports: Array<{
		name?: string;
		port: number;
		targetPort: string | number;
		protocol: string;
		nodePort?: number;
	}>;
	selector: Record<string, string>;
	sessionAffinity: string;
	loadBalancerIP?: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type ServiceWithAge = Service & { age: string };

/**
 * Service type color mapping
 */
export function getTypeColor(type: string): string {
	const map: Record<string, string> = {
		ClusterIP: 'bg-blue-500/15 text-blue-400 border-transparent',
		NodePort: 'bg-purple-500/15 text-purple-400 border-transparent',
		LoadBalancer: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		ExternalName: 'bg-yellow-500/15 text-yellow-400 border-transparent'
	};
	return map[type] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Service type icon mapping
 */
export function getTypeIcon(type: string) {
	const map: Record<string, typeof CheckCircle2> = {
		ClusterIP: Server,
		NodePort: Network,
		LoadBalancer: Globe,
		ExternalName: Globe
	};
	return map[type] ?? HelpCircle;
}

/**
 * Format ports for display: "80:8080/TCP, 443:8443/TCP"
 */
export function formatPorts(ports: Service['ports']): string {
	if (!ports || ports.length === 0) return '—';
	return ports
		.map((p) => {
			let str = `${p.port}`;
			if (p.targetPort && p.targetPort !== p.port) str += `:${p.targetPort}`;
			if (p.nodePort) str += `:${p.nodePort}`;
			str += `/${p.protocol}`;
			return str;
		})
		.join(', ');
}

/**
 * Format external IPs for display
 */
export function formatExternalIPs(ips: string[]): string {
	if (!ips || ips.length === 0) return '—';
	return ips.join(', ');
}
