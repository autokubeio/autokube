export type ServiceAccount = {
	id: string;
	name: string;
	namespace: string;
	secrets: number;
	imagePullSecrets: number;
	secretNames: string[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type ServiceAccountWithAge = ServiceAccount & { age: string };
