export type Secret = {
	id: string;
	name: string;
	namespace: string;
	type: string;
	dataCount: number;
	data: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type SecretWithAge = Secret & { age: string };

/**
 * Secret type color mapping
 */
export function getTypeColor(type: string): string {
	const map: Record<string, string> = {
		'Opaque': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
		'kubernetes.io/tls': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
		'kubernetes.io/dockerconfigjson': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
		'kubernetes.io/service-account-token': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
		'kubernetes.io/basic-auth': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
		'kubernetes.io/ssh-auth': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
		'bootstrap.kubernetes.io/token': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300'
	};
	return map[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/**
 * Get short display name for secret type
 */
export function getTypeShortName(type: string): string {
	const map: Record<string, string> = {
		'Opaque': 'Opaque',
		'kubernetes.io/tls': 'TLS',
		'kubernetes.io/dockerconfigjson': 'Docker Config',
		'kubernetes.io/service-account-token': 'SA Token',
		'kubernetes.io/basic-auth': 'Basic Auth',
		'kubernetes.io/ssh-auth': 'SSH Auth',
		'bootstrap.kubernetes.io/token': 'Bootstrap'
	};
	return map[type] || type;
}
