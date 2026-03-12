export type ClusterRoleBinding = {
	id: string;
	name: string;
	roleRef: {
		apiGroup?: string;
		kind?: string;
		name?: string;
	};
	subjects: Array<{
		kind?: string;
		name?: string;
		namespace?: string;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type ClusterRoleBindingWithAge = ClusterRoleBinding & { age: string };

/**
 * Format subjects for compact display
 */
export function formatSubjects(subjects: ClusterRoleBinding['subjects']): string {
	if (!subjects || subjects.length === 0) return 'None';
	return subjects
		.map((s) => {
			const kind = s.kind || 'Unknown';
			const name = s.name || 'unknown';
			return `${kind}:${name}`;
		})
		.join(', ');
}
