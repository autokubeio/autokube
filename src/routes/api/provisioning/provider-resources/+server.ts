/**
 * Fetch available server types and locations from a cloud provider API.
 * Accepts an optional token in the request body; falls back to the saved
 * settings token if not supplied.
 *
 * POST /api/provisioning/provider-resources
 * Body: { provider: string; token?: string }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { getSetting } from '$lib/server/queries/settings';
import { decrypt } from '$lib/server/helpers/encryption';

// ── Hetzner Cloud API helpers ─────────────────────────────────────────────────

const HETZNER_API = 'https://api.hetzner.cloud/v1';

interface HetznerServerType {
	id: number;
	name: string;
	description: string;
	cores: number;
	memory: number;
	disk: number;
	cpu_type: 'shared' | 'dedicated';
	architecture: string;
	deprecated: boolean | null;
	deprecation?: { unavailable_after: string } | null;
}

interface HetznerLocation {
	id: number;
	name: string;
	description: string;
	city: string;
	country: string;
}

async function fetchHetzner<T>(path: string, token: string): Promise<T> {
	const res = await fetch(`${HETZNER_API}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Hetzner API ${path} returned ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

async function getHetznerResources(token: string) {
	const [stRes, locRes] = await Promise.all([
		fetchHetzner<{ server_types: HetznerServerType[] }>('/server_types', token),
		fetchHetzner<{ locations: HetznerLocation[] }>('/locations', token)
	]);

	// Filter out deprecated types and sort by cores then memory
	const serverTypes = stRes.server_types
		.filter((t) => !t.deprecated && !t.deprecation?.unavailable_after)
		.sort((a, b) => a.cores - b.cores || a.memory - b.memory)
		.map((t) => ({
			value: t.name,
			label: t.description || t.name.toUpperCase(),
			cores: t.cores,
			mem: t.memory,
			disk: t.disk,
			cpuType: t.cpu_type,
			arch: t.architecture
		}));

	const locations = locRes.locations
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((l) => ({
			value: l.name,
			label: l.city || l.description,
			region: l.country,
			flag: countryFlag(l.country)
		}));

	return { serverTypes, locations };
}

function countryFlag(code: string): string {
	// Convert country code to emoji flag
	return [...code.toUpperCase()]
		.map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
		.join('');
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	let provider: string;
	let token: string | undefined;

	try {
		const body = await request.json();
		provider = body.provider;
		token = body.token || undefined;
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!provider) {
		return json({ error: 'provider is required' }, { status: 400 });
	}

	// Resolve token: prefer explicit token from body, fall back to saved settings
	if (!token) {
		const raw = (await getSetting(`provider_token_${provider}`)) as string | null;
		token = raw ? decrypt(raw) ?? undefined : undefined;
	}

	if (!token) {
		return json({ error: 'No provider token available. Save one in Settings or enter it in the wizard.' }, { status: 422 });
	}

	try {
		if (provider === 'hetzner') {
			const resources = await getHetznerResources(token);
			return json(resources);
		}
		return json({ error: `Provider "${provider}" is not supported yet.` }, { status: 400 });
	} catch (err) {
		console.error('[API/provisioning/provider-resources] Fetch failed:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch provider resources';
		return json({ error: message }, { status: 502 });
	}
};
