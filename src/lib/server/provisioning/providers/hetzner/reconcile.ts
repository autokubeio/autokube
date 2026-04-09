/**
 * Pre-apply state reconciliation for the Hetzner Cloud provider.
 *
 * When a previous provisioning attempt partially created infrastructure and
 * then failed (e.g. during the SSH/kubeconfig phase), cloud resources exist
 * in Hetzner but may not be in the Terraform state file.  Running `apply`
 * again would fail with 409 uniqueness errors.
 *
 * This module queries the Hetzner API for any resources that match the
 * expected naming convention and imports them into state before `apply` runs.
 */

import { terraformImport } from '../../engine/terraform';
import { createHash } from 'node:crypto';

const HETZNER_API = 'https://api.hetzner.cloud/v1';

async function hetznerGet<T>(path: string, token: string): Promise<T> {
	const res = await fetch(`${HETZNER_API}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`Hetzner API ${path} → ${res.status}`);
	return res.json() as Promise<T>;
}

/**
 * Ensure all named Hetzner resources are tracked in Terraform state.
 * Silently skips anything already in state or not yet existing in Hetzner.
 */
export async function reconcileHetznerState(
	workspace: string,
	clusterName: string,
	token: string,
	usePrivateNetwork: boolean,
	sshPublicKey: string,
	sshKeyName: string,
	onLog: (msg: string) => void
): Promise<void> {
	onLog('Checking for existing Hetzner resources to reconcile into state…');

	// Run imports SEQUENTIALLY — Terraform cannot safely write to the same
	// state file from multiple concurrent processes.
	await reconcileSshKey(workspace, sshKeyName, token, sshPublicKey, onLog);
	await reconcileFirewall(workspace, clusterName, token, onLog);
	if (usePrivateNetwork) {
		await reconcileNetwork(workspace, clusterName, token, onLog);
	}
}

/** Compute the MD5 fingerprint Hetzner uses for SSH key lookups. */
function sshKeyFingerprint(publicKey: string): string | null {
	try {
		const parts = publicKey.trim().split(/\s+/);
		if (parts.length < 2) return null;
		const keyBytes = Buffer.from(parts[1], 'base64');
		const md5 = createHash('md5').update(keyBytes).digest('hex');
		return md5.match(/.{2}/g)!.join(':');
	} catch {
		return null;
	}
}

async function reconcileSshKey(
	workspace: string,
	sshKeyName: string,
	token: string,
	sshPublicKey: string,
	onLog: (msg: string) => void
): Promise<void> {
	// Hetzner SSH key uniqueness is by public key fingerprint, not just name.
	// Try by expected name first; fall back to fingerprint search so we also
	// catch keys that were created under an older naming convention.
	let keyId: number | null = null;
	let keyName = '';

	// 1. Search by expected name
	const byName = await hetznerGet<{ ssh_keys: { id: number; name: string }[] }>(
		`/ssh_keys?name=${encodeURIComponent(sshKeyName)}`,
		token
	);
	if (byName.ssh_keys.length > 0) {
		keyId = byName.ssh_keys[0].id;
		keyName = byName.ssh_keys[0].name;
	}

	// 2. Fallback: search by fingerprint (catches renamed / legacy keys)
	if (keyId === null && sshPublicKey) {
		const fingerprint = sshKeyFingerprint(sshPublicKey);
		if (fingerprint) {
			const byFp = await hetznerGet<{ ssh_keys: { id: number; name: string }[] }>(
				`/ssh_keys?fingerprint=${encodeURIComponent(fingerprint)}`,
				token
			);
			if (byFp.ssh_keys.length > 0) {
				keyId = byFp.ssh_keys[0].id;
				keyName = byFp.ssh_keys[0].name;
			}
		}
	}

	if (keyId !== null) {
		onLog(`Importing existing SSH key "${keyName}" (id: ${keyId}) into state…`);
		await terraformImport(workspace, 'hcloud_ssh_key.cluster', String(keyId));
		onLog(`SSH key "${keyName}" imported successfully.`);
	}
}

async function reconcileFirewall(
	workspace: string,
	clusterName: string,
	token: string,
	onLog: (msg: string) => void
): Promise<void> {
	const data = await hetznerGet<{ firewalls: { id: number; name: string }[] }>(
		`/firewalls?name=${encodeURIComponent(`${clusterName}-fw`)}`,
		token
	);
	if (data.firewalls.length > 0) {
		const fw = data.firewalls[0];
		onLog(`Importing existing firewall "${fw.name}" (id: ${fw.id}) into state…`);
		await terraformImport(workspace, 'hcloud_firewall.cluster', String(fw.id));
		onLog(`Firewall "${fw.name}" imported successfully.`);
	}
}

async function reconcileNetwork(
	workspace: string,
	clusterName: string,
	token: string,
	onLog: (msg: string) => void
): Promise<void> {
	const data = await hetznerGet<{ networks: { id: number; name: string; subnets: { ip_range: string; id?: number; network_id?: number }[] }[] }>(
		`/networks?name=${encodeURIComponent(`${clusterName}-network`)}`,
		token
	);
	if (data.networks.length > 0) {
		const net = data.networks[0];
		onLog(`Importing existing network "${net.name}" (id: ${net.id}) into state…`);
		await terraformImport(workspace, 'hcloud_network.cluster[0]', String(net.id));

		// Import the first subnet if it exists
		if (net.subnets?.length > 0) {
			const subnet = net.subnets[0];
			const subnetRef = `${net.id}-${subnet.ip_range}`;
			onLog(`Importing existing network subnet (${subnet.ip_range}) into state…`);
			await terraformImport(workspace, 'hcloud_network_subnet.cluster[0]', subnetRef);
			onLog(`Network subnet imported successfully.`);
		}
	}
}
