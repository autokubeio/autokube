/**
 * Provisioning orchestrator — the main entry point called by the start API
 * route. Coordinates workspace creation, Terraform execution, kubeconfig
 * retrieval, and cluster registration.
 *
 * startProvisioning() returns immediately after launching the background job;
 * progress is streamed via the SSE event bus.
 */

import { randomBytes, createPublicKey } from 'node:crypto';
import { getProvisionedCluster, updateProvisionedClusterStatus } from '$lib/server/queries/provisioned-clusters';
import { addProvisioningLog, type LogLevel } from '$lib/server/queries/provisioned-cluster-logs';
import { insertCluster, patchCluster } from '$lib/server/queries/clusters';
import { findSshKey } from '$lib/server/queries/ssh-keys';
import { getSetting } from '$lib/server/queries/settings';
import { decrypt } from '$lib/server/helpers/encryption';
import { getProviderAdapter } from './providers/index';
// Import all provider adapters to ensure they are registered
import './providers/hetzner/adapter';
import { createWorkspace, writeTfvars, cleanupWorkspace } from './engine/workspace';

/**
 * Convert a stored public key to OpenSSH authorized_keys format.
 * Keys generated before the format fix were stored as SPKI PEM; Hetzner
 * (and ssh-copy-id / authorized_keys) require "ssh-ed25519 <base64>" format.
 */
function normalizePublicKey(raw: string): string {
	const trimmed = raw.trim();
	// Already in OpenSSH format
	if (trimmed.startsWith('ssh-ed25519 ') || trimmed.startsWith('ssh-rsa ') || trimmed.startsWith('ecdsa-sha2-')) {
		return trimmed;
	}
	// SPKI PEM — convert via Node crypto
	try {
		const keyObj = createPublicKey(trimmed);
		const type = keyObj.asymmetricKeyType;
		const spkiDer = keyObj.export({ type: 'spki', format: 'der' }) as Buffer;
		if (type === 'ed25519') {
			// ed25519 SPKI DER: public key bytes are the last 32 bytes
			const pubBytes = spkiDer.subarray(spkiDer.length - 32);
			const typeStr = Buffer.from('ssh-ed25519', 'utf8');
			const blob = Buffer.concat([
				uint32BE(typeStr.length), typeStr,
				uint32BE(pubBytes.length), pubBytes
			]);
			return `ssh-ed25519 ${blob.toString('base64')}`;
		} else if (type === 'rsa') {
			// Export as PKCS#1 DER and use standard ssh-rsa encoding via the
			// existing JWK path — just return the old value if we can't convert
			const jwk = keyObj.export({ format: 'jwk' }) as { n: string; e: string };
			const blob = Buffer.concat([sshString('ssh-rsa'), sshMpint(jwk.e), sshMpint(jwk.n)]);
			return `ssh-rsa ${blob.toString('base64')}`;
		}
	} catch {
		// Fall through — return as-is, Terraform will emit a useful error
	}
	return trimmed;
}

function uint32BE(n: number): Buffer {
	const b = Buffer.allocUnsafe(4);
	b.writeUInt32BE(n, 0);
	return b;
}
function sshString(s: string): Buffer {
	const buf = Buffer.from(s, 'utf8');
	return Buffer.concat([uint32BE(buf.length), buf]);
}
function sshMpint(b64url: string): Buffer {
	const raw = Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	let start = 0;
	while (start < raw.length - 1 && raw[start] === 0) start++;
	const bytes = raw.subarray(start);
	const data = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
	return Buffer.concat([uint32BE(data.length), data]);
}
import { runTerraform, getTerraformOutputs } from './engine/terraform';
import { reconcileHetznerState } from './providers/hetzner/reconcile';
import { fetchKubeconfig } from './engine/kubeconfig';
import { jobManager } from './engine/job-manager';
import { eventBus, DONE_EVENT } from './sse/event-bus';

// ── Background kubeconfig poller ─────────────────────────────────────────────

interface PollKubeconfigOptions {
	clusterId: number;
	clustersRowId: number;
	masterIp: string;
	apiEndpoint: string;
	sshPrivateKey: string;
	onLog: (msg: string, level?: LogLevel) => Promise<void>;
}

/**
 * Fires-and-forgets: polls SSH until K3s is ready, fetches the kubeconfig,
 * writes it to the clusters table, then updates the provisioned cluster status.
 * Runs entirely after the main provisioning job completes so it never blocks
 * or times out the UI.
 */
async function pollKubeconfigAsync(opts: PollKubeconfigOptions): Promise<void> {
	const { clusterId, clustersRowId, masterIp, apiEndpoint, sshPrivateKey, onLog } = opts;
	const maxRetries = 40; // 40 × 15 s = 10 min
	const retryDelay = 15_000;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await onLog(`Fetching kubeconfig (attempt ${attempt}/${maxRetries})…`);
			const kubeconfig = await fetchKubeconfig({ masterIp, apiEndpoint, sshPrivateKey, timeoutSecs: 300 });
			await patchCluster(clustersRowId, { kubeconfig });
			await updateProvisionedClusterStatus(
				clusterId,
				'running',
				`Cluster fully connected. API: https://${apiEndpoint}:6443`
			);
			await onLog('Kubeconfig fetched — cluster is fully connected!', 'success');
			return;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (attempt < maxRetries) {
				await onLog(`K3s not ready yet (${msg}), retrying in ${retryDelay / 1000}s…`, 'info');
				await new Promise((r) => setTimeout(r, retryDelay));
			} else {
				await onLog(`Failed to fetch kubeconfig after ${maxRetries} attempts: ${msg}`, 'error');
				await updateProvisionedClusterStatus(clusterId, 'error', `Kubeconfig fetch failed: ${msg}`);
			}
		}
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Kick off a provisioning job for the given cluster ID.
 * Returns immediately — work proceeds in the background.
 * Throws if the cluster does not exist or is already provisioning.
 */
export async function startProvisioning(clusterId: number): Promise<void> {
	if (jobManager.isRunning(clusterId)) {
		throw new Error('A provisioning job is already running for this cluster.');
	}

	const cluster = await getProvisionedCluster(clusterId);
	if (!cluster) {
		throw new Error(`Provisioned cluster ${clusterId} not found.`);
	}

	// Resolve provider token: prefer per-cluster token, fall back to global settings
	if (!cluster.providerToken) {
		const settingsKey = `provider_token_${cluster.provider}`;
		const raw = (await getSetting(settingsKey)) as string | null;
		const globalToken = raw ? decrypt(raw) : null;
		if (!globalToken) {
			throw new Error(
				`No provider token found for "${cluster.provider}". ` +
				`Either enter a token in the wizard or save one in Settings → Provisioning.`
			);
		}
		// Patch in-memory so the running job can use it without re-reading DB
		(cluster as { providerToken: string }).providerToken = globalToken;
	}

	// Register upfront so the caller knows the job started
	jobManager.register(clusterId);
	await updateProvisionedClusterStatus(clusterId, 'provisioning', 'Provisioning started');

	// Run the rest in the background — do not await
	runJob(clusterId, cluster).catch((err) => {
		console.error(`[provisioning] Unhandled error for cluster ${clusterId}:`, err);
	});
}

// ── Background job ────────────────────────────────────────────────────────────

async function runJob(
	clusterId: number,
	cluster: NonNullable<Awaited<ReturnType<typeof getProvisionedCluster>>>
): Promise<void> {
	let workspace: string | null = null;
	let succeeded = false;
	let lastTerraformError = '';
	/** Persist a log entry and broadcast it to live SSE subscribers. */
	async function log(message: string, level: LogLevel = 'info') {
		const createdAt = new Date().toISOString();
		await addProvisioningLog(clusterId, message, level);
		eventBus.publish(clusterId, { level, message, createdAt });
	}

	try {
		// ── 1. Parse stored JSON config ─────────────────────────────────────────
		const mastersPool = cluster.mastersPoolConfig ? JSON.parse(cluster.mastersPoolConfig) : {};
		const workerPools = cluster.workerPoolsConfig ? JSON.parse(cluster.workerPoolsConfig) : [];
		const networking = cluster.networkingConfig ? JSON.parse(cluster.networkingConfig) : {};

		// ── 2. Resolve SSH key (public + decrypted private) ────────────────────
		const sshKeyId: number | undefined = mastersPool.sshKeyId;
		let sshPublicKey = '';
		let sshPrivateKey = '';
		let sshKeyName = '';

		if (sshKeyId) {
			await log('Resolving SSH key…');
			const sshKey = await findSshKey(sshKeyId);
			if (!sshKey) {
				throw new Error(`SSH key ${sshKeyId} not found in database.`);
			}
			sshPublicKey = normalizePublicKey(sshKey.publicKey);
			sshPrivateKey = sshKey.privateKey; // already decrypted by query layer
			sshKeyName = sshKey.name;
		} else {
			throw new Error('No SSH key ID set on mastersPoolConfig. Cannot provision without an SSH key.');
		}

		// ── 3. Resolve provider adapter ────────────────────────────────────────
		await log(`Loading provider adapter for "${cluster.provider}"…`);
		const adapter = getProviderAdapter(cluster.provider);

		// ── 4. Create isolated workspace ───────────────────────────────────────
		await log('Creating workspace…');
		workspace = await createWorkspace(clusterId, adapter.templatesDir);
		await log(`Workspace ready: ${workspace}`);

		// ── 5. Generate tfvars ─────────────────────────────────────────────────
		await log('Generating Terraform variables…');

		// Generate a random cluster token if not already stored
		const k3sToken = randomBytes(32).toString('hex');

		const tfvars = adapter.buildTfvars({
			clusterName: cluster.clusterName,
			k3sVersion: cluster.k3sVersion ?? 'v1.32.0+k3s1',
			providerToken: cluster.providerToken!,
			sshPublicKey,
			sshKeyName,
			k3sToken,
			mastersPool: {
				count: mastersPool.count ?? 1,
				instanceType: mastersPool.instanceType ?? 'cx22',
				locations: mastersPool.locations ?? ['nbg1'],
				sshKeyId
			},
			workerPools,
			networking: {
				networkZone: networking.networkZone,
				cniPlugin: networking.cniPlugin,
				usePrivateNetwork: networking.usePrivateNetwork ?? false,
				createLoadBalancer: cluster.createLoadBalancer ?? false,
				allowedPorts: networking.allowedPorts ?? []
			}
		});

		await writeTfvars(workspace, tfvars);
		await log('Terraform variables written.');

		// ── 6. terraform init ──────────────────────────────────────────────────
		await log('Running terraform init…');
		await runTerraform(workspace, ['init', '-upgrade'], async (line, isErr) => {
			if (isErr) lastTerraformError = line;
			await log(line, isErr ? 'warning' : 'info');
		});
		await log('Terraform initialised.', 'success');

		// ── 6.5. Reconcile existing cloud resources into state (retry-safe) ────
		if (cluster.provider === 'hetzner') {
			await reconcileHetznerState(
				workspace,
				cluster.clusterName,
				cluster.providerToken!,
				networking.usePrivateNetwork ?? false,
				sshPublicKey,
				sshKeyName,
				async (msg) => await log(msg, 'info')
			);
		}

		// ── 7. terraform apply ─────────────────────────────────────────────────
		await log('Running terraform apply (this may take several minutes)…');
		await runTerraform(workspace, ['apply', '-auto-approve'], async (line, isErr) => {
			if (isErr || line.toLowerCase().includes('error')) lastTerraformError = line;
			await log(line, isErr ? 'warning' : 'k3s');
		});
		await log('Infrastructure created.', 'success');

		// ── 8. Parse outputs ───────────────────────────────────────────────────
		await log('Retrieving Terraform outputs…');
		const outputs = await getTerraformOutputs(workspace);
		await log(`API endpoint: ${outputs.api_endpoint}`);
		await log(`Master IPs: ${outputs.master_ips.join(', ')}`);

		// ── 9. Register cluster immediately (kubeconfig fetched async) ────────
		await log('Registering cluster in AutoKube…');
		const clustersRow = await insertCluster({
			name: cluster.clusterName,
			icon: 'cloud',
			labels: undefined,
			apiServer: `https://${outputs.api_endpoint}:6443`,
			authType: 'kubeconfig',
			kubeconfig: null,
			context: null,
			namespace: 'default',
			bearerToken: null,
			tlsCa: null,
			tlsSkipVerify: false,
			isProvisioned: true,
			provisionedClusterId: clusterId,
			agentUrl: null,
			agentToken: null,
			metricsEnabled: true,
			cpuWarnThreshold: 60,
			cpuCritThreshold: 80,
			memWarnThreshold: 60,
			memCritThreshold: 80,
			scanEnabled: false,
			scannerPreference: 'both'
		});

		// ── 10. Mark provisioned cluster as running right away ─────────────────
		await updateProvisionedClusterStatus(
			clusterId,
			'running',
			`Infrastructure ready. API: https://${outputs.api_endpoint}:6443 — fetching kubeconfig…`,
			outputs.api_endpoint
		);
		await log('Cluster registered! Visible in cluster list now.', 'success');
		await log('Waiting for K3s to become available and fetching kubeconfig in the background…', 'info');

		succeeded = true;
		jobManager.complete(clusterId);

		// ── 11. Background kubeconfig poller ───────────────────────────────────
		// Poll until SSH + K3s are ready, then write the kubeconfig to the DB.
		// Runs after the job completes so it never blocks or times out the UI.
		const clustersRowId = clustersRow.id;
		const masterIp = outputs.master_init_ip || outputs.master_ips[0];
		const apiEndpoint = outputs.api_endpoint;
		pollKubeconfigAsync({
			clusterId,
			clustersRowId,
			masterIp,
			apiEndpoint,
			sshPrivateKey,
			onLog: async (msg, level) => {
				const createdAt = new Date().toISOString();
				await addProvisioningLog(clusterId, msg, level ?? 'info');
				eventBus.publish(clusterId, { level: level ?? 'info', message: msg, createdAt });
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const detail = lastTerraformError ? ` | Last Terraform output: ${lastTerraformError}` : '';
		console.error(`[provisioning] Job ${clusterId} failed: ${message}${detail}`);

		try {
			await log(`Provisioning failed: ${message}`, 'error');
			await updateProvisionedClusterStatus(clusterId, 'error', message);
		} catch (logErr) {
			console.error('[provisioning] Could not persist failure status:', logErr);
		}

		jobManager.fail(clusterId, message);
	} finally {
		// Always publish the sentinel event so SSE clients can close
		eventBus.publish(clusterId, DONE_EVENT);

		// Only clean up workspace on success — preserve it on failure for debugging.
		// Inspect at: /tmp/autokube/provisioning/<clusterId>/
		if (workspace && succeeded) {
			try {
				await cleanupWorkspace(workspace);
			} catch (cleanupErr) {
				console.error('[provisioning] Workspace cleanup failed:', cleanupErr);
			}
		} else if (workspace && !succeeded) {
			console.error(`[provisioning] Workspace preserved for debugging: ${workspace}`);
		}
	}
}
