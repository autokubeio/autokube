export interface SshKeyPublic {
	id: number;
	name: string;
	description?: string | null;
	keyType: 'ed25519' | 'rsa';
	publicKey: string;
	fingerprint: string;
	hasPrivateKey: boolean;
	createdAt: string;
	updatedAt: string;
}

let keys = $state<SshKeyPublic[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

export const sshKeysStore = {
	get keys() {
		return keys;
	},
	get loading() {
		return loading;
	},
	get error() {
		return error;
	},

	async fetch() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/ssh-keys');
			if (!res.ok) throw new Error('Failed to fetch SSH keys');
			const data = await res.json();
			keys = data.sshKeys ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	},

	async createPrivate(input: { name: string; description?: string; privateKey: string; publicKey?: string }) {
		const res = await fetch('/api/ssh-keys', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to create SSH key');
		}
		await sshKeysStore.fetch();
	},

	async importPublic(input: { name: string; description?: string; publicKey: string }) {
		const res = await fetch('/api/ssh-keys', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to import SSH key');
		}
		await sshKeysStore.fetch();
	},

	async generate(keyType: 'ed25519' | 'rsa') {
		const res = await fetch('/api/ssh-keys/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ keyType })
		});
		if (!res.ok) throw new Error('Failed to generate SSH key');
		return res.json() as Promise<{
			publicKey: string;
			privateKey: string;
			fingerprint: string;
			keyType: 'ed25519' | 'rsa';
		}>;
	},

	async delete(id: number) {
		const res = await fetch(`/api/ssh-keys/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to delete SSH key');
		}
		keys = keys.filter((k) => k.id !== id);
	}
};
