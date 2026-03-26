/**
 * Image Security Scanner Service
 *
 * All scanning runs **in-cluster** — a Grype or Trivy Job is created inside the
 * Kubernetes cluster so the scan accesses images from within the cluster network.
 * Private registries are reachable and images are never re-pulled to the server.
 * Works for all connection types (kubeconfig, bearer-token, agent) via makeClusterRequest.
 *
 * Workflow:
 *  1. Extract images from K8s workloads via the cluster connection
 *  2. Create a scan Job (Grype, Trivy, or both with fallback) inside the cluster
 *  3. Parse JSON output into structured vulnerability data
 *  4. Store results in the database
 */

import {
	insertImageScan,
	updateImageScan,
	insertVulnerabilities
} from '../queries/image-scans';
import type { VulnerabilitySummary } from '../queries/image-scans';
import type { ImageScan } from '../db/schema';
import { existsSync, mkdirSync, unlinkSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeClusterRequest } from './kubernetes/utils';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScanVulnerability {
	VulnerabilityID: string;
	PkgName: string;
	InstalledVersion: string;
	FixedVersion?: string;
	Severity: string;
	Title?: string;
	Description?: string;
	PrimaryURL?: string;
	CVSS?: Record<string, { V3Score?: number }>;
}

export interface ScanResult {
	Target: string;
	Type: string;
	Vulnerabilities?: ScanVulnerability[];
}

export interface ScanOutput {
	Results?: ScanResult[];
	SchemaVersion?: number;
	ArtifactName?: string;
}

export interface ScanRequest {
	image: string;
	tag?: string;
	clusterId?: number;
	resource?: string;
	resourceNamespace?: string;
	trigger?: 'manual' | 'scheduled';
	scannerPreference?: 'grype' | 'trivy' | 'both';
}

export interface WorkloadImage {
	image: string;
	tag?: string;
	resource: string;
	resourceNamespace: string;
}

export type ScannerId = 'grype' | 'trivy';

// ── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = Bun.env.DATA_DIR ?? './data';
export const SCANNERS_DIR = join(DATA_DIR, 'scanners');

/** Get the binary path for a scanner */
export function getScannerBinPath(id: ScannerId): string {
	return join(SCANNERS_DIR, id);
}

/** Ensure scanners directory exists */
function ensureScannersDir() {
	if (!existsSync(SCANNERS_DIR)) {
		mkdirSync(SCANNERS_DIR, { recursive: true });
	}
}

// ── Scanner Installation ────────────────────────────────────────────────────

function getPlatformInfo(): { os: string; arch: string } {
	const platform = typeof Bun !== 'undefined' ? (Bun.env.OS_TYPE ?? process.platform) : process.platform;
	const rawArch = typeof Bun !== 'undefined' ? (Bun.env.ARCH_TYPE ?? process.arch) : process.arch;

	let os: string;
	if (platform === 'darwin' || platform.includes('Darwin')) os = 'darwin';
	else if (platform === 'win32' || platform.includes('Windows')) os = 'windows';
	else os = 'linux';

	let arch: string;
	if (rawArch === 'arm64' || rawArch === 'aarch64') arch = 'arm64';
	else arch = 'amd64';

	return { os, arch };
}

/**
 * Download and install a scanner binary.
 * Both Grype and Trivy provide official install scripts that work cross-platform.
 */
export async function installScanner(id: ScannerId): Promise<void> {
	ensureScannersDir();
	const binPath = getScannerBinPath(id);
	const { os, arch } = getPlatformInfo();

	console.log(`[ImageScanner] Installing ${id} for ${os}/${arch} to ${binPath}`);

	if (id === 'grype') {
		// Use Grype's official install script
		const proc = Bun.spawn(
			['sh', '-c', `curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b "${SCANNERS_DIR}"`],
			{ stdout: 'pipe', stderr: 'pipe', env: Bun.env as Record<string, string | undefined> }
		);
		const [, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		await proc.exited;
		if (proc.exitCode !== 0) {
			throw new Error(`Failed to install grype: ${stderr.trim()}`);
		}
	} else {
		// Use Trivy's official install script
		const proc = Bun.spawn(
			['sh', '-c', `curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b "${SCANNERS_DIR}"`],
			{ stdout: 'pipe', stderr: 'pipe', env: Bun.env as Record<string, string | undefined> }
		);
		const [, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		await proc.exited;
		if (proc.exitCode !== 0) {
			throw new Error(`Failed to install trivy: ${stderr.trim()}`);
		}
	}

	// Ensure binary is executable
	if (existsSync(binPath)) {
		chmodSync(binPath, 0o755);
		console.log(`[ImageScanner] ${id} installed at ${binPath}`);
	} else {
		throw new Error(`${id} binary not found after installation at ${binPath}`);
	}
}

/** Remove a scanner binary */
export async function removeScanner(id: ScannerId): Promise<void> {
	const binPath = getScannerBinPath(id);
	if (existsSync(binPath)) {
		unlinkSync(binPath);
		console.log(`[ImageScanner] ${id} removed from ${binPath}`);
	}
}

/** Get scanner version */
export async function getScannerVersion(id: ScannerId): Promise<string | null> {
	const binPath = getScannerBinPath(id);
	if (!existsSync(binPath)) return null;

	try {
		const args = id === 'grype' ? [binPath, 'version'] : [binPath, '--version'];
		const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		if (proc.exitCode !== 0) return null;
		const match = output.match(/Version:\s*(.+)/i) ?? output.match(/(\d+\.\d+\.\d+)/);
		return match?.[1]?.trim() ?? output.trim().split('\n')[0];
	} catch {
		return null;
	}
}

/** Check if a scanner is installed */
export function isScannerInstalled(id: ScannerId): boolean {
	return existsSync(getScannerBinPath(id));
}

/** Check if any scanner is available */
export async function isTrivyAvailable(): Promise<boolean> {
	return isScannerInstalled('grype') || isScannerInstalled('trivy');
}

/** Get version of the first available scanner */
export async function getTrivyVersion(): Promise<string | null> {
	if (isScannerInstalled('grype')) {
		const v = await getScannerVersion('grype');
		if (v) return `grype: ${v}`;
	}
	if (isScannerInstalled('trivy')) {
		const v = await getScannerVersion('trivy');
		if (v) return `trivy: ${v}`;
	}
	return null;
}

// ── Image Parsing ───────────────────────────────────────────────────────────

/**
 * Parse image string into name + tag.
 * Handles formats: image:tag, image@sha256:..., image:tag@sha256:...
 * The digest is stripped — the version tag (or 'latest') is returned.
 */
export function parseImageRef(imageRef: string): { image: string; tag: string } {
	let ref = imageRef;

	// Strip @sha256: digest suffix first
	const atIndex = ref.indexOf('@');
	if (atIndex !== -1) {
		ref = ref.slice(0, atIndex);
	}

	// Parse tag from the remaining ref
	const parts = ref.split(':');
	if (parts.length > 1) {
		const tag = parts.pop()!;
		return { image: parts.join(':'), tag };
	}

	return { image: ref, tag: 'latest' };
}

// ── Cache Cleanup ───────────────────────────────────────────────────────────

/**
 * Clean up stale scanner cache directories left behind by interrupted/crashed scans.
 * Removes .grype-cache-* and .trivy-cache-* dirs in the scanners folder.
 */
export function cleanupStaleScannerCaches(): void {
	if (!existsSync(SCANNERS_DIR)) return;

	try {
		const entries = readdirSync(SCANNERS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (
				entry.isDirectory() &&
				(entry.name.startsWith('.grype-cache-') || entry.name.startsWith('.trivy-cache-'))
			) {
				try {
					rmSync(join(SCANNERS_DIR, entry.name), { recursive: true, force: true });
					console.log(`[ImageScanner] Cleaned stale cache: ${entry.name}`);
				} catch {}
			}
		}
	} catch (err) {
		console.error('[ImageScanner] Failed to clean stale caches:', err);
	}
}

// ── Scanning ────────────────────────────────────────────────────────────────

/** Scan an image with Grype CLI — outputs Trivy-compatible JSON structure */
async function scanWithGrype(imageRef: string): Promise<ScanOutput> {
	const binPath = getScannerBinPath('grype');
	const cacheDir = join(SCANNERS_DIR, `.grype-cache-${randomUUID().slice(0, 8)}`);
	mkdirSync(cacheDir, { recursive: true });

	try {
		const proc = Bun.spawn(
			[binPath, imageRef, '-o', 'json', '--quiet'],
			{
				stdout: 'pipe',
				stderr: 'pipe',
				env: {
					...(Bun.env as Record<string, string | undefined>),
					GRYPE_DB_CACHE_DIR: cacheDir
				}
			}
		);

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		await proc.exited;

		if (proc.exitCode !== 0 && !stdout.trim()) {
			throw new Error(`Grype scan failed: ${stderr.trim() || `exit code ${proc.exitCode}`}`);
		}

		// Grype JSON → normalize to our ScanOutput structure
		try {
			const raw = JSON.parse(stdout);
			return normalizeGrypeOutput(raw, imageRef);
		} catch {
			throw new Error(`Failed to parse Grype output: ${stdout.slice(0, 200)}`);
		}
	} finally {
		try { rmSync(cacheDir, { recursive: true, force: true }); } catch {}
	}
}

/** Normalize Grype JSON output to our unified format */
function normalizeGrypeOutput(raw: GrypeRawOutput, imageRef: string): ScanOutput {
	const vulns: ScanVulnerability[] = (raw.matches ?? []).map((m) => ({
		VulnerabilityID: m.vulnerability?.id ?? 'UNKNOWN',
		PkgName: m.artifact?.name ?? 'unknown',
		InstalledVersion: m.artifact?.version ?? '',
		FixedVersion: m.vulnerability?.fix?.versions?.[0] ?? undefined,
		Severity: (m.vulnerability?.severity ?? 'Unknown').toUpperCase(),
		Title: m.vulnerability?.description?.slice(0, 200) ?? undefined,
		Description: m.vulnerability?.description ?? undefined,
		PrimaryURL: m.vulnerability?.dataSource ?? undefined,
		CVSS: m.vulnerability?.cvss
			? { primary: { V3Score: m.vulnerability.cvss[0]?.metrics?.baseScore ?? undefined } }
			: undefined
	}));

	return {
		ArtifactName: imageRef,
		Results: vulns.length > 0
			? [{ Target: imageRef, Type: 'grype', Vulnerabilities: vulns }]
			: [{ Target: imageRef, Type: 'grype', Vulnerabilities: [] }]
	};
}

interface GrypeRawOutput {
	matches?: Array<{
		vulnerability?: {
			id?: string;
			severity?: string;
			description?: string;
			dataSource?: string;
			fix?: { versions?: string[] };
			cvss?: Array<{ metrics?: { baseScore?: number } }>;
		};
		artifact?: { name?: string; version?: string };
	}>;
}

/** Scan an image with Trivy CLI */
async function scanWithTrivy(imageRef: string): Promise<ScanOutput> {
	const binPath = getScannerBinPath('trivy');
	const cacheDir = join(SCANNERS_DIR, `.trivy-cache-${randomUUID().slice(0, 8)}`);
	mkdirSync(cacheDir, { recursive: true });

	try {
		const proc = Bun.spawn(
			[binPath, 'image', '--format', 'json', '--scanners', 'vuln', '--quiet', '--cache-dir', cacheDir, imageRef],
			{
				stdout: 'pipe',
				stderr: 'pipe',
				env: {
					...(Bun.env as Record<string, string | undefined>),
					TRIVY_NO_PROGRESS: 'true'
				}
			}
		);

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		await proc.exited;

		if (proc.exitCode !== 0 && !stdout.trim()) {
			throw new Error(`Trivy scan failed: ${stderr.trim() || `exit code ${proc.exitCode}`}`);
		}

		try {
			return JSON.parse(stdout) as ScanOutput;
		} catch {
			throw new Error(`Failed to parse Trivy output: ${stdout.slice(0, 200)}`);
		}
	} finally {
		try { rmSync(cacheDir, { recursive: true, force: true }); } catch {}
	}
}

/**
 * Scan an image with the preferred scanner(s).
 * If preference is 'both', tries grype first, then trivy as fallback.
 */
export async function scanImage(
	imageRef: string,
	preference: 'grype' | 'trivy' | 'both' = 'both'
): Promise<{ output: ScanOutput; scanner: string }> {
	const grypeAvailable = isScannerInstalled('grype');
	const trivyAvailable = isScannerInstalled('trivy');

	if (!grypeAvailable && !trivyAvailable) {
		throw new Error('No scanner installed. Install Grype or Trivy from the cluster Security settings.');
	}

	if (preference === 'grype') {
		if (!grypeAvailable) throw new Error('Grype is not installed.');
		return { output: await scanWithGrype(imageRef), scanner: 'grype' };
	}

	if (preference === 'trivy') {
		if (!trivyAvailable) throw new Error('Trivy is not installed.');
		return { output: await scanWithTrivy(imageRef), scanner: 'trivy' };
	}

	// 'both' — prefer grype (faster), fallback to trivy
	if (grypeAvailable) {
		try {
			return { output: await scanWithGrype(imageRef), scanner: 'grype' };
		} catch (err) {
			console.warn(`[ImageScanner] Grype failed, falling back to Trivy:`, err);
			if (trivyAvailable) {
				return { output: await scanWithTrivy(imageRef), scanner: 'trivy' };
			}
			throw err;
		}
	}

	return { output: await scanWithTrivy(imageRef), scanner: 'trivy' };
}

// Keep backward compat for existing callers
export async function scanImageWithTrivy(imageRef: string): Promise<ScanOutput> {
	const { output } = await scanImage(imageRef);
	return output;
}

/**
 * Extract vulnerability summary counts from scan results
 */
function buildSummary(results: ScanResult[]): VulnerabilitySummary {
	const summary: VulnerabilitySummary = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

	for (const result of results) {
		for (const vuln of result.Vulnerabilities ?? []) {
			const sev = vuln.Severity?.toUpperCase();
			if (sev === 'CRITICAL') summary.critical++;
			else if (sev === 'HIGH') summary.high++;
			else if (sev === 'MEDIUM') summary.medium++;
			else if (sev === 'LOW') summary.low++;
			else summary.unknown++;
		}
	}

	return summary;
}

/**
 * Get the best CVSS score from a vulnerability
 */
function getCvssScore(vuln: ScanVulnerability): number | null {
	if (!vuln.CVSS) return null;
	for (const source of Object.values(vuln.CVSS)) {
		if (source.V3Score) return source.V3Score;
	}
	return null;
}

// ── In-Cluster Scanning ─────────────────────────────────────────────────────

/** Container images for in-cluster scan Jobs */
const SCANNER_IMAGES: Record<'grype' | 'trivy', string> = {
	grype: 'anchore/grype:latest',
	trivy: 'ghcr.io/aquasecurity/trivy:latest'
};

/** Namespace where scan jobs are created */
const SCAN_JOB_NAMESPACE = 'autokube-system';

/** Maximum time to wait for a scan Job to finish */
const SCAN_JOB_TIMEOUT_MS = 300_000; // 5 min

/** Polling interval when checking Job status */
const SCAN_JOB_POLL_MS = 3_000; // 3 sec

/** Cache of scanner image pull failures per cluster — avoids retrying a broken pull on every image */
const scannerPullFailures = new Map<string, number>(); // key: "clusterId:scanner" → timestamp
const PULL_FAILURE_CACHE_TTL_MS = 10 * 60_000; // 10 minutes

function markScannerPullFailed(clusterId: number, scanner: ScannerId): void {
	scannerPullFailures.set(`${clusterId}:${scanner}`, Date.now());
}

function isScannerPullFailed(clusterId: number, scanner: ScannerId): boolean {
	const key = `${clusterId}:${scanner}`;
	const ts = scannerPullFailures.get(key);
	if (!ts) return false;
	if (Date.now() - ts > PULL_FAILURE_CACHE_TTL_MS) {
		scannerPullFailures.delete(key);
		return false;
	}
	return true;
}

function clearScannerPullFailure(clusterId: number, scanner: ScannerId): void {
	scannerPullFailures.delete(`${clusterId}:${scanner}`);
}

/**
 * Ensure a namespace exists in the target cluster.
 */
async function ensureScanNamespace(clusterId: number, namespace: string): Promise<void> {
	const check = await makeClusterRequest(clusterId, `/api/v1/namespaces/${namespace}`);
	if (check.success) return;

	const create = await makeClusterRequest(clusterId, '/api/v1/namespaces', 15_000, {
		method: 'POST',
		body: JSON.stringify({
			apiVersion: 'v1',
			kind: 'Namespace',
			metadata: {
				name: namespace,
				labels: { 'app.kubernetes.io/managed-by': 'autokube' }
			}
		})
	});

	if (!create.success && !create.error?.includes('AlreadyExists') && !create.error?.includes('already exists')) {
		throw new Error(`Failed to create namespace ${namespace}: ${create.error}`);
	}
}

/**
 * Build a Kubernetes Job manifest that runs a scanner to scan a container image.
 */
function buildScanJobManifest(jobName: string, namespace: string, imageRef: string, scanner: 'grype' | 'trivy'): object {
	const containerImage = SCANNER_IMAGES[scanner];

	// Don't override 'command' — let each image's ENTRYPOINT handle execution.
	// anchore/grype has ENTRYPOINT ["/grype"], aquasecurity/trivy has ENTRYPOINT ["trivy"]
	const scanArgs = scanner === 'grype'
		? [imageRef, '-o', 'json', '--quiet']
		: ['image', '--format', 'json', '--scanners', 'vuln', '--quiet', '--no-progress', imageRef];

	return {
		apiVersion: 'batch/v1',
		kind: 'Job',
		metadata: {
			name: jobName,
			namespace,
			labels: {
				'app.kubernetes.io/managed-by': 'autokube',
				'autokube/purpose': 'image-scan'
			}
		},
		spec: {
			backoffLimit: 0,
			ttlSecondsAfterFinished: 120,
			activeDeadlineSeconds: 300,
			template: {
				metadata: {
					labels: {
						'app.kubernetes.io/managed-by': 'autokube',
						'autokube/purpose': 'image-scan',
						'job-name': jobName
					}
				},
				spec: {
					restartPolicy: 'Never',
					automountServiceAccountToken: false,
					containers: [
						{
							name: 'scanner',
							image: containerImage,
							imagePullPolicy: 'IfNotPresent',
							args: scanArgs,
							resources: {
								requests: { cpu: '200m', memory: '512Mi' },
								limits: { cpu: '1', memory: '2Gi' }
							},
							securityContext: {
								allowPrivilegeEscalation: false,
								readOnlyRootFilesystem: false
							}
						}
					]
				}
			}
		}
	};
}

/**
 * Poll a scan Job until it succeeds, fails, or times out.
 */
/** Image pull error reasons that indicate the scanner image cannot be fetched */
const IMAGE_PULL_ERRORS = new Set(['ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'InvalidImageName']);

async function waitForScanJob(
	clusterId: number,
	namespace: string,
	jobName: string,
	timeoutMs: number
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	let consecutiveFailures = 0;
	const MAX_CONSECUTIVE_FAILURES = 3;

	while (Date.now() < deadline) {
		const result = await makeClusterRequest<{
			status?: {
				succeeded?: number;
				failed?: number;
				active?: number;
			};
		}>(clusterId, `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`);

		if (!result.success) {
			consecutiveFailures++;
			if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				throw new Error(`Failed to check scan job status: ${result.error}`);
			}
			console.warn(`[ImageScanner] Transient error polling job ${jobName} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${result.error}`);
			await new Promise((r) => setTimeout(r, SCAN_JOB_POLL_MS));
			continue;
		}

		consecutiveFailures = 0;
		const status = result.data?.status;
		if (status?.succeeded && status.succeeded > 0) return true;
		if (status?.failed && status.failed > 0) return false;

		// Check pod status for image pull errors — fail fast instead of waiting 5 minutes
		await checkForImagePullErrors(clusterId, namespace, jobName);

		await new Promise((r) => setTimeout(r, SCAN_JOB_POLL_MS));
	}

	return false; // timed out
}

/**
 * Check if the scan pod is stuck on an image pull error and throw immediately.
 */
async function checkForImagePullErrors(clusterId: number, namespace: string, jobName: string): Promise<void> {
	try {
		const podsResult = await makeClusterRequest<{
			items?: Array<{
				status?: {
					containerStatuses?: Array<{
						state?: {
							waiting?: { reason?: string; message?: string };
						};
					}>;
				};
			}>;
		}>(clusterId, `/api/v1/namespaces/${namespace}/pods?labelSelector=job-name%3D${jobName}`);

		const waiting = podsResult.data?.items?.[0]?.status?.containerStatuses?.[0]?.state?.waiting;
		if (waiting?.reason && IMAGE_PULL_ERRORS.has(waiting.reason)) {
			throw new Error(
				`Scanner image pull failed (${waiting.reason}). ` +
				`${waiting.message ? waiting.message.slice(0, 300) + ' ' : ''}` +
				'Ensure cluster nodes can reach the container registry, or pre-load scanner images ' +
				'(e.g. `docker pull ghcr.io/aquasecurity/trivy:latest && kind load docker-image ghcr.io/aquasecurity/trivy:latest` for Kind clusters).'
			);
		}
	} catch (err) {
		// Re-throw image pull errors, ignore other failures (network glitches, pod not yet created, etc.)
		if (err instanceof Error && err.message.includes('image pull failed')) throw err;
	}
}

/**
 * Wait for a pod to appear (K8s may take a moment to schedule it).
 */
async function waitForJobPod(clusterId: number, namespace: string, jobName: string, timeoutMs = 15_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const podsResult = await makeClusterRequest<{
			items?: Array<{ metadata?: { name?: string } }>;
		}>(clusterId, `/api/v1/namespaces/${namespace}/pods?labelSelector=job-name%3D${jobName}`);

		const podName = podsResult.data?.items?.[0]?.metadata?.name;
		if (podName) return podName;

		await new Promise((r) => setTimeout(r, 1_500));
	}

	throw new Error('Could not find scan job pod (timed out waiting for pod creation)');
}

/**
 * Get stdout logs from the pod created by a scan Job.
 */
async function getScanJobLogs(clusterId: number, namespace: string, jobName: string): Promise<string> {
	const podName = await waitForJobPod(clusterId, namespace, jobName);

	const logsResult = await makeClusterRequest<string>(
		clusterId,
		`/api/v1/namespaces/${namespace}/pods/${podName}/log?container=scanner`
	);

	if (!logsResult.success) {
		throw new Error(`Failed to get scan job logs: ${logsResult.error}`);
	}

	return typeof logsResult.data === 'string' ? logsResult.data : JSON.stringify(logsResult.data);
}

/**
 * Delete a scan Job and its pods (background cascade).
 */
async function deleteScanJob(clusterId: number, namespace: string, jobName: string): Promise<void> {
	try {
		await makeClusterRequest(
			clusterId,
			`/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`,
			15_000,
			{
				method: 'DELETE',
				body: JSON.stringify({ propagationPolicy: 'Background' })
			}
		);
	} catch (err) {
		console.error(`[ImageScanner] Failed to cleanup scan job ${jobName}:`, err);
	}
}

/**
 * Get diagnostics from a failed scan Job's pod (exit code, termination reason)
 * and from the Job conditions.
 */
async function getJobPodDiagnostics(clusterId: number, namespace: string, jobName: string): Promise<string> {
	const parts: string[] = [];

	try {
		// Check Job conditions for failure reasons
		const jobResult = await makeClusterRequest<{
			status?: {
				conditions?: Array<{ type?: string; reason?: string; message?: string }>;
			};
		}>(clusterId, `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`);

		const failCond = jobResult.data?.status?.conditions?.find(
			(c) => c.type === 'Failed' && c.reason
		);
		if (failCond) {
			parts.push(`Job ${failCond.reason}${failCond.message ? `: ${failCond.message.slice(0, 200)}` : ''}`);
		}
	} catch { /* ignore */ }

	try {
		// Check pod container status for exit code / OOMKilled / etc.
		const podsResult = await makeClusterRequest<{
			items?: Array<{
				status?: {
					phase?: string;
					containerStatuses?: Array<{
						state?: {
							terminated?: { exitCode?: number; reason?: string; message?: string };
							waiting?: { reason?: string; message?: string };
						};
					}>;
				};
			}>;
		}>(clusterId, `/api/v1/namespaces/${namespace}/pods?labelSelector=job-name%3D${jobName}`);

		const pod = podsResult.data?.items?.[0];
		if (!pod) {
			if (!parts.length) parts.push('Pod not found (may not have been scheduled)');
			return parts.join('; ');
		}

		const cs = pod.status?.containerStatuses?.[0];
		if (cs) {
			const term = cs.state?.terminated;
			if (term) {
				const termParts: string[] = [];
				if (term.reason) termParts.push(`reason=${term.reason}`);
				if (term.exitCode !== undefined) termParts.push(`exitCode=${term.exitCode}`);
				if (term.message) termParts.push(term.message.slice(0, 200));
				parts.push(termParts.join(', '));
			}

			const wait = cs.state?.waiting;
			if (wait) {
				parts.push(`waiting: ${wait.reason ?? 'unknown'}${wait.message ? ` — ${wait.message.slice(0, 200)}` : ''}`);
			}
		} else if (pod.status?.phase) {
			parts.push(`Pod phase: ${pod.status.phase}`);
		}
	} catch { /* ignore */ }

	return parts.join('; ');
}

/**
 * Run a single scanner Job in the cluster and return parsed output.
 */
async function runScanJob(
	clusterId: number,
	namespace: string,
	imageRef: string,
	scanner: 'grype' | 'trivy'
): Promise<{ output: ScanOutput; scanner: 'grype' | 'trivy' }> {
	const jobName = `autokube-scan-${scanner[0]}${randomUUID().slice(0, 7)}`;

	console.log(`[ImageScanner] In-cluster ${scanner} scan: ${imageRef} (job: ${jobName})`);

	const jobBody = buildScanJobManifest(jobName, namespace, imageRef, scanner);
	const createResult = await makeClusterRequest(
		clusterId,
		`/apis/batch/v1/namespaces/${namespace}/jobs`,
		30_000,
		{ method: 'POST', body: JSON.stringify(jobBody) }
	);

	if (!createResult.success) {
		throw new Error(
			`Failed to create ${scanner} scan job: ${createResult.error}. ` +
			'Ensure the cluster credentials have permission to create Jobs in the autokube-system namespace.'
		);
	}

	try {
		const succeeded = await waitForScanJob(clusterId, namespace, jobName, SCAN_JOB_TIMEOUT_MS);

		if (!succeeded) {
			// Fetch pod status + Job conditions for diagnostics
			const diagMsg = await getJobPodDiagnostics(clusterId, namespace, jobName);
			const logs = await getScanJobLogs(clusterId, namespace, jobName).catch(() => '');
			throw new Error(
				`In-cluster ${scanner} scan job failed.${diagMsg ? ` [${diagMsg}]` : ''}${logs ? ` Output: ${logs.slice(0, 500)}` : ''}`
			);
		}

		// Job succeeded — scanner image is available; clear any cached pull failure
		clearScannerPullFailure(clusterId, scanner);

		// Job succeeded — fetch logs (retry handles pod scheduling delay)
		const logs = await getScanJobLogs(clusterId, namespace, jobName).catch(async (err) => {
			const diag = await getJobPodDiagnostics(clusterId, namespace, jobName);
			throw new Error(`${scanner} scan succeeded but failed to retrieve logs: ${err.message}${diag ? ` [${diag}]` : ''}`);
		});

		if (!logs.trim()) {
			throw new Error(`In-cluster ${scanner} scan job produced no output`);
		}

		const raw = typeof logs === 'object' ? logs : JSON.parse(logs);
		const output: ScanOutput = scanner === 'grype'
			? normalizeGrypeOutput(raw as GrypeRawOutput, imageRef)
			: (raw as ScanOutput);

		return { output, scanner };
	} catch (err) {
		// Cache image pull failures so we don't retry for every image in the batch
		if (err instanceof Error && err.message.includes('image pull failed')) {
			markScannerPullFailed(clusterId, scanner);
		}
		throw err;
	} finally {
		await deleteScanJob(clusterId, namespace, jobName);
	}
}

/**
 * Scan an image by creating a scanner Job inside the Kubernetes cluster.
 * Supports grype, trivy, or both (runs both scanners and merges results).
 * The scan runs within the cluster network so private registries are reachable.
 */
async function scanImageOnCluster(
	clusterId: number,
	imageRef: string,
	preference: 'grype' | 'trivy' | 'both' = 'both'
): Promise<{ output: ScanOutput; scanner: string }> {
	const namespace = SCAN_JOB_NAMESPACE;
	await ensureScanNamespace(clusterId, namespace);

	if (preference === 'grype') {
		return runScanJob(clusterId, namespace, imageRef, 'grype');
	}

	if (preference === 'trivy') {
		return runScanJob(clusterId, namespace, imageRef, 'trivy');
	}

	// 'both' — check if either scanner's image is known to be unavailable
	const grypeDown = isScannerPullFailed(clusterId, 'grype');
	const trivyDown = isScannerPullFailed(clusterId, 'trivy');

	if (grypeDown && trivyDown) {
		throw new Error('Both scanner images (Grype + Trivy) failed to pull on this cluster. Pre-load them or check Docker Hub access.');
	}
	if (grypeDown) {
		console.log(`[ImageScanner] Skipping Grype for ${imageRef} (image pull cached as failed)`);
		return runScanJob(clusterId, namespace, imageRef, 'trivy');
	}
	if (trivyDown) {
		console.log(`[ImageScanner] Skipping Trivy for ${imageRef} (image pull cached as failed)`);
		return runScanJob(clusterId, namespace, imageRef, 'grype');
	}

	// Both available — run grype AND trivy, merge deduplicated results
	const [grypeResult, trivyResult] = await Promise.allSettled([
		runScanJob(clusterId, namespace, imageRef, 'grype'),
		runScanJob(clusterId, namespace, imageRef, 'trivy')
	]);

	const grypeOk = grypeResult.status === 'fulfilled' ? grypeResult.value : null;
	const trivyOk = trivyResult.status === 'fulfilled' ? trivyResult.value : null;

	if (grypeOk && trivyOk) {
		// Merge results from both scanners, deduplicating by VulnerabilityID+PkgName
		const merged = mergeResults(grypeOk.output, trivyOk.output);
		return { output: merged, scanner: 'grype+trivy' };
	}

	// If one failed, return the successful one
	if (grypeOk) {
		const trivyErr = (trivyResult as PromiseRejectedResult).reason;
		console.warn(`[ImageScanner] Trivy failed for ${imageRef}, using Grype results only:`, trivyErr?.message ?? trivyErr);
		return grypeOk;
	}
	if (trivyOk) {
		const grypeErr = (grypeResult as PromiseRejectedResult).reason;
		console.warn(`[ImageScanner] Grype failed for ${imageRef}, using Trivy results only:`, grypeErr?.message ?? grypeErr);
		return trivyOk;
	}

	// Both failed — throw the grype error (since it ran first conceptually)
	throw (grypeResult as PromiseRejectedResult).reason;
}

/**
 * Merge scan outputs from two scanners, deduplicating vulnerabilities by ID+package.
 */
function mergeResults(a: ScanOutput, b: ScanOutput): ScanOutput {
	const allResults = [...(a.Results ?? []), ...(b.Results ?? [])];

	// Deduplicate across all results by VulnerabilityID + PkgName
	const seen = new Set<string>();
	const mergedVulns: ScanResult[] = [];

	for (const result of allResults) {
		const dedupedVulns = (result.Vulnerabilities ?? []).filter((v) => {
			const key = `${v.VulnerabilityID}::${v.PkgName}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		if (dedupedVulns.length > 0) {
			mergedVulns.push({ ...result, Vulnerabilities: dedupedVulns });
		}
	}

	return { Results: mergedVulns };
}

/**
 * Execute a full scan: create DB record, run scanner Job in-cluster, store results.
 * A clusterId is required — scans always run inside the Kubernetes cluster.
 */
export async function executeScan(request: ScanRequest): Promise<ImageScan> {
	const { image: rawImage, tag: rawTag, clusterId, resource, resourceNamespace, trigger, scannerPreference } = request;
	const parsed = parseImageRef(rawImage);
	const image = parsed.image;
	const tag = rawTag ?? parsed.tag;
	const fullRef = `${image}:${tag}`;

	// 1. Create pending scan record
	const scan = await insertImageScan({
		clusterId: clusterId ?? null,
		image,
		tag,
		status: 'pending',
		trigger: trigger ?? 'manual',
		resource: resource ?? null,
		resourceNamespace: resourceNamespace ?? null,
		scanner: scannerPreference === 'both' ? null : (scannerPreference ?? null),
		summary: null,
		errorMessage: null,
		startedAt: null,
		completedAt: null,
		digest: null
	});

	// 2. Mark as scanning
	await updateImageScan(scan.id, {
		status: 'scanning',
		startedAt: new Date().toISOString()
	});

	try {
		// 3. Run scanner as a K8s Job inside the cluster
		if (!clusterId) {
			throw new Error('Cluster ID is required — scans run inside the Kubernetes cluster.');
		}

		const { output, scanner: usedScanner } = await scanImageOnCluster(clusterId, fullRef, scannerPreference);
		const results = output.Results ?? [];
		const summary = buildSummary(results);

		// Update scanner field with what was actually used
		await updateImageScan(scan.id, { scanner: usedScanner });

		// 4. Store vulnerabilities
		const vulns = results.flatMap((r) =>
			(r.Vulnerabilities ?? []).map((v) => ({
				vulnerabilityId: v.VulnerabilityID,
				pkgName: v.PkgName,
				installedVersion: v.InstalledVersion ?? null,
				fixedVersion: v.FixedVersion ?? null,
				severity: (v.Severity ?? 'UNKNOWN').toUpperCase(),
				title: v.Title ?? null,
				description: v.Description ?? null,
				primaryUrl: v.PrimaryURL ?? null,
				score: getCvssScore(v)
			}))
		);

		await insertVulnerabilities(scan.id, vulns);

		// 5. Update scan with summary
		const updated = await updateImageScan(scan.id, {
			status: 'completed',
			summary: JSON.stringify(summary),
			completedAt: new Date().toISOString()
		});

		return updated ?? scan;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error(`[ImageScanner] Scan failed for ${fullRef}:`, err);

		await updateImageScan(scan.id, {
			status: 'failed',
			errorMessage,
			completedAt: new Date().toISOString()
		});

		// Return the scan record (with failed status)
		return { ...scan, status: 'failed', errorMessage };
	} finally {
		// Clean up any stale caches from this or earlier crashed scans
		cleanupStaleScannerCaches();
	}
}

/** Default concurrency limit for parallel scans */
const DEFAULT_SCAN_CONCURRENCY = 5;

/**
 * Execute scans for multiple images in parallel with a concurrency limit.
 * Returns all completed scan records (including failed ones).
 */
export async function executeScanBatch(
	requests: ScanRequest[],
	concurrency: number = DEFAULT_SCAN_CONCURRENCY,
	isCancelled?: () => boolean
): Promise<ImageScan[]> {
	const results: ImageScan[] = [];
	const queue = [...requests];

	async function worker() {
		while (queue.length > 0) {
			if (isCancelled?.()) break;
			const req = queue.shift();
			if (!req) break;
			try {
				const scan = await executeScan(req);
				results.push(scan);
			} catch (err) {
				console.error(`[ImageScanner] Batch scan failed for ${req.image}:`, err);
			}
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, requests.length) }, () => worker());
	await Promise.all(workers);

	if (isCancelled?.()) {
		console.log(`[ImageScanner] Batch scan cancelled. Completed ${results.length}/${requests.length} images.`);
	}

	// Final cleanup pass after all batch scans complete
	cleanupStaleScannerCaches();

	return results;
}

/**
 * Extract container images from K8s workloads via the cluster API
 */
export async function extractWorkloadImages(
	clusterRequest: (path: string) => Promise<{ items?: Array<{ metadata?: { name?: string; namespace?: string }; spec?: { template?: { spec?: { containers?: Array<{ image?: string }> } } } }> }>
): Promise<WorkloadImage[]> {
	const images: WorkloadImage[] = [];
	const seen = new Set<string>();

	// Never scan the scanner tool images themselves
	const scannerImageSet = new Set(Object.values(SCANNER_IMAGES));

	const workloadTypes = [
		{ path: '/apis/apps/v1/deployments', kind: 'deployment' },
		{ path: '/apis/apps/v1/statefulsets', kind: 'statefulset' },
		{ path: '/apis/apps/v1/daemonsets', kind: 'daemonset' },
		{ path: '/api/v1/pods', kind: 'pod' }
	];

	for (const { path, kind } of workloadTypes) {
		try {
			const response = await clusterRequest(path);
			for (const item of response.items ?? []) {
				const containers =
					kind === 'pod'
						? (item as { spec?: { containers?: Array<{ image?: string }> } }).spec?.containers
						: item.spec?.template?.spec?.containers;

				for (const container of containers ?? []) {
					if (container.image && !seen.has(container.image) && !scannerImageSet.has(container.image)) {
						seen.add(container.image);
						const { image, tag } = parseImageRef(container.image);
						images.push({
							image,
							tag,
							resource: `${kind}/${item.metadata?.name ?? 'unknown'}`,
							resourceNamespace: item.metadata?.namespace ?? 'default'
						});
					}
				}
			}
		} catch (err) {
			console.error(`[ImageScanner] Failed to list ${kind}s:`, err);
		}
	}

	return images;
}
