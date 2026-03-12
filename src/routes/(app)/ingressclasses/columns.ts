export type IngressClass = {
	name: string;
	controller: string;
	parameters?: {
		apiGroup?: string;
		kind?: string;
		name?: string;
	};
	isDefault: boolean;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type IngressClassWithAge = IngressClass & { age: string };
