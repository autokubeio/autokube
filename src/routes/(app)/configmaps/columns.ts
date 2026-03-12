export type ConfigMap = {
	id: string;
	name: string;
	namespace: string;
	dataCount: number;
	data: Record<string, string>;
	binaryData: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type ConfigMapWithAge = ConfigMap & { age: string };
