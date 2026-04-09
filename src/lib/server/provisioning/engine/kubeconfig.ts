/**
 * Kubeconfig retrieval over SSH.
 * After Terraform has provisioned the cluster, this module SSHes into the
 * first master, waits for K3s to be healthy, fetches the kubeconfig and
 * rewrites the server URL to use the public API endpoint.
 */

import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';

// ── Private key format conversion ─────────────────────────────────────────

function uint32BE(n: number): Buffer {
	const b = Buffer.allocUnsafe(4);
	b.writeUInt32BE(n, 0);
	return b;
}
function sshStr(data: string | Buffer): Buffer {
	const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
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
function buildOpensshKey(pubBlob: Buffer, privBlob: Buffer): string {
	const check = Buffer.allocUnsafe(4);
	check.writeUInt32BE(Math.floor(Math.random() * 0xffffffff), 0);
	const privSection = Buffer.concat([check, check, privBlob, sshStr('')]);
	const padLen = (8 - (privSection.length % 8)) % 8;
	const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1));
	const privEncrypted = Buffer.concat([privSection, padding]);

	const body = Buffer.concat([
		Buffer.from('openssh-key-v1\0'),
		sshStr('none'), sshStr('none'), uint32BE(0),
		uint32BE(1),
		sshStr(pubBlob),
		sshStr(privEncrypted)
	]);
	const b64 = body.toString('base64').match(/.{1,70}/g)!.join('\n');
	return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/**
 * Ensure the private key is in a format the `ssh` CLI accepts.
 * Old AutoKube-generated keys are PKCS#8 PEM; `ssh` only accepts OpenSSH format.
 */
function ensureOpenSshFormat(pem: string): string {
	const trimmed = pem.trim();
	// Already OpenSSH or legacy PEM formats that ssh supports
	if (
		trimmed.includes('BEGIN OPENSSH PRIVATE KEY') ||
		trimmed.includes('BEGIN RSA PRIVATE KEY') ||
		trimmed.includes('BEGIN EC PRIVATE KEY')
	) {
		return trimmed + '\n';
	}
	// PKCS#8 — convert to OpenSSH
	if (trimmed.includes('BEGIN PRIVATE KEY')) {
		try {
			const privKeyObj = createPrivateKey(trimmed);
			const type = privKeyObj.asymmetricKeyType;

			if (type === 'ed25519') {
				const privDer = privKeyObj.export({ type: 'pkcs8', format: 'der' }) as Buffer;
				const seed = privDer.subarray(16, 48); // 32-byte seed
				const pubDer = (createPublicKey(privKeyObj).export({ type: 'spki', format: 'der' })) as Buffer;
				const pubBytes = pubDer.subarray(pubDer.length - 32);
				const pubBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(pubBytes)]);
				const privBlob = Buffer.concat([
					sshStr('ssh-ed25519'),
					sshStr(pubBytes),                          // 32-byte public key (required inside private section)
					sshStr(Buffer.concat([seed, pubBytes]))    // 64-byte NaCl secret key
				]);
				return buildOpensshKey(pubBlob, privBlob);
			}

			if (type === 'rsa') {
				const jwk = privKeyObj.export({ format: 'jwk' }) as {
					n: string; e: string; d: string; p: string; q: string; qi: string;
				};
				const pubBlob = Buffer.concat([sshStr('ssh-rsa'), sshMpint(jwk.e), sshMpint(jwk.n)]);
				const privBlob = Buffer.concat([
					sshStr('ssh-rsa'),
					sshMpint(jwk.n), sshMpint(jwk.e), sshMpint(jwk.d),
					sshMpint(jwk.qi), sshMpint(jwk.p), sshMpint(jwk.q)
				]);
				return buildOpensshKey(pubBlob, privBlob);
			}
		} catch (err) {
			console.error('[kubeconfig] Failed to convert PKCS#8 key to OpenSSH format:', err);
		}
	}
	return trimmed + '\n';
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface FetchKubeconfigOptions {
	/** Public IP of the master node to SSH into. */
	masterIp: string;
	/** The API endpoint that clients should use — may be LB IP or same as masterIp. */
	apiEndpoint: string;
	/** Decrypted SSH private key content. */
	sshPrivateKey: string;
	/** Max seconds to wait for K3s to be ready. Default: 600 (10 min). */
	timeoutSecs?: number;
}

/**
 * SSH into the master node and fetch `/etc/rancher/k3s/k3s.yaml`.
 * The `server` URL inside the kubeconfig is rewritten to `https://<apiEndpoint>:6443`.
 *
 * Returns the kubeconfig YAML string.
 */
export async function fetchKubeconfig(opts: FetchKubeconfigOptions): Promise<string> {
	const { masterIp, apiEndpoint, sshPrivateKey, timeoutSecs = 600 } = opts;

	// Write private key to a temp file (required by ssh CLI; 0600 perms)
	const keyPath = join('/tmp', `autokube-key-${randomUUID()}`);
	try {
		// Convert to OpenSSH format if needed — ssh CLI rejects PKCS#8 PEM
		const normalizedKey = ensureOpenSshFormat(sshPrivateKey);
		await writeFile(keyPath, normalizedKey, { mode: 0o600 });

		const sshBase = [
			'ssh',
			'-o', 'StrictHostKeyChecking=no',
			'-o', 'UserKnownHostsFile=/dev/null',
			'-o', 'ConnectTimeout=10',
			'-o', 'BatchMode=yes',
			'-i', keyPath,
			`root@${masterIp}`
		];

		// 1. Poll until SSH is reachable
		await waitForSsh(sshBase, timeoutSecs);

		// 2. Poll until K3s API is healthy
		await waitForK3sApi(sshBase, timeoutSecs);

		// 3. Fetch the kubeconfig
		const raw = await sshCommand(sshBase, 'cat /etc/rancher/k3s/k3s.yaml');

		// 4. Rewrite the internal server address to the public API endpoint
		const kubeconfig = raw.replace(
			/server:\s*https:\/\/127\.0\.0\.1:6443/g,
			`server: https://${apiEndpoint}:6443`
		);

		return kubeconfig;
	} finally {
		if (existsSync(keyPath)) {
			await rm(keyPath, { force: true });
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForSsh(sshBase: string[], timeoutSecs: number): Promise<void> {
	const deadline = Date.now() + timeoutSecs * 1000;
	while (Date.now() < deadline) {
		try {
			await sshCommand(sshBase, 'true');
			return;
		} catch {
			await sleep(10_000);
		}
	}
	throw new Error(`Timed out waiting for SSH on ${sshBase.at(-1)}`);
}

async function waitForK3sApi(sshBase: string[], timeoutSecs: number): Promise<void> {
	const deadline = Date.now() + timeoutSecs * 1000;
	while (Date.now() < deadline) {
		try {
			// K3s writes k3s.yaml as soon as the API server is ready — this is the
			// most reliable signal that works regardless of auth configuration on
			// /healthz or /readyz (newer K3s versions require auth on those endpoints).
			await sshCommand(sshBase, 'test -f /etc/rancher/k3s/k3s.yaml');
			return;
		} catch {
			await sleep(10_000);
		}
	}
	throw new Error('Timed out waiting for K3s API server to become healthy');
}

async function sshCommand(sshBase: string[], command: string): Promise<string> {
	const proc = Bun.spawn([...sshBase, command], {
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`SSH command failed (${exitCode}): ${stderr.trim()}`);
	}

	return stdout;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
