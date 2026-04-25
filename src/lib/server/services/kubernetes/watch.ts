/**
 * Kubernetes Watch API Support
 * Handles streaming updates from Kubernetes API
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import https from 'node:https';
import { parseKubeconfig, buildConnectionConfig, k8sRequest } from './utils';
import { findCluster } from '$lib/server/queries/clusters';

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';

export interface WatchEvent {
	type: WatchEventType;
	object: any;
}

export type WatchCallback = (event: WatchEvent) => void;

export interface WatchOptions {
	kubeconfigContent: string;
	resourcePath: string;
	contextName?: string;
	callback: WatchCallback;
	signal?: AbortSignal;
	timeoutSeconds?: number;
}

interface ListResponse {
	items?: any[];
}

/**
 * Drain the rest of an HTTP response body and resolve with it as a string.
 * Used to read the K8s `Status` payload returned for non-2xx responses.
 */
function drainResponse(res: import('node:http').IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
		res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		res.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});
}

/**
 * Map an HTTP status from a watch response to a stable error code that the
 * SSE wrapper can use to decide whether to retry or give up.
 */
function watchErrorCodeForStatus(status: number): string {
	if (status === 404) return 'NOT_FOUND';
	if (status === 401 || status === 403) return 'UNAUTHORIZED';
	if (status >= 500) return 'SERVER_ERROR';
	return `HTTP_${status}`;
}

/**
 * Build a rejected error from a non-2xx watch response. Reads the K8s
 * `Status` object out of the body so we can include the API-server message
 * (e.g. "the server could not find the requested resource") alongside our
 * own code.
 */
async function buildHttpError(
	res: import('node:http').IncomingMessage
): Promise<NodeJS.ErrnoException> {
	const status = res.statusCode ?? 0;
	const body = await drainResponse(res);

	let message = `HTTP ${status}`;
	try {
		const parsed = JSON.parse(body) as { message?: string };
		if (parsed?.message) message = parsed.message;
	} catch {
		// Not JSON — keep the generic HTTP message.
	}

	const err = new Error(message) as NodeJS.ErrnoException;
	err.code = watchErrorCodeForStatus(status);
	return err;
}

interface SnapshotEntry {
	object: any;
	version: string;
}

const AGENT_WATCH_POLL_INTERVAL = 3000;

// Re-export resource path utilities for convenience
export {
	buildWatchPath,
	getWatchPath,
	buildApiPath,
	buildListApiPath,
	getResourceConfig,
	RESOURCE_CONFIGS
} from './resource-paths';

function stripWatchParams(resourcePath: string): string {
	const url = new URL(resourcePath, 'https://autokube.local');
	url.searchParams.delete('watch');
	url.searchParams.delete('timeoutSeconds');
	const query = url.searchParams.toString();
	return `${url.pathname}${query ? `?${query}` : ''}`;
}

function getSnapshotKey(object: any): string | null {
	const metadata = object?.metadata;
	if (!metadata || typeof metadata !== 'object') return null;

	if (typeof metadata.uid === 'string' && metadata.uid.length > 0) {
		return metadata.uid;
	}

	if (typeof metadata.name === 'string' && metadata.name.length > 0) {
		const namespace =
			typeof metadata.namespace === 'string' && metadata.namespace.length > 0
				? metadata.namespace
				: '_cluster';
		return `${namespace}/${metadata.name}`;
	}

	return null;
}

function getSnapshotVersion(object: any): string {
	const resourceVersion = object?.metadata?.resourceVersion;
	if (typeof resourceVersion === 'string' && resourceVersion.length > 0) {
		return resourceVersion;
	}

	try {
		return JSON.stringify(object);
	} catch {
		return String(object);
	}
}

function buildSnapshot(items: any[]): Map<string, SnapshotEntry> {
	const snapshot = new Map<string, SnapshotEntry>();

	for (const object of items) {
		const key = getSnapshotKey(object);
		if (!key) continue;

		snapshot.set(key, {
			object,
			version: getSnapshotVersion(object)
		});
	}

	return snapshot;
}

function emitSnapshotDiff(
	previous: Map<string, SnapshotEntry>,
	current: Map<string, SnapshotEntry>,
	callback: WatchCallback
): void {
	for (const [key, entry] of current) {
		const prior = previous.get(key);
		if (!prior) {
			callback({ type: 'ADDED', object: entry.object });
			continue;
		}

		if (prior.version !== entry.version) {
			callback({ type: 'MODIFIED', object: entry.object });
		}
	}

	for (const [key, entry] of previous) {
		if (!current.has(key)) {
			callback({ type: 'DELETED', object: entry.object });
		}
	}
}

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;

	await new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, AGENT_WATCH_POLL_INTERVAL);

		const onAbort = () => {
			clearTimeout(timeout);
			resolve();
		};

		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

async function pollResourceByConnection(
	config: ReturnType<typeof buildConnectionConfig>,
	resourcePath: string,
	callback: WatchCallback,
	signal?: AbortSignal
): Promise<void> {
	const listPath = stripWatchParams(resourcePath);
	let previous = new Map<string, SnapshotEntry>();

	while (!signal?.aborted) {
		const response = await k8sRequest<ListResponse>(config, listPath, 30_000);
		const current = buildSnapshot(response.items ?? []);

		emitSnapshotDiff(previous, current, callback);
		previous = current;

		await waitForNextPoll(signal);
	}
}

/**
 * Watch Kubernetes resources for changes
 * @param kubeconfigContent - Raw kubeconfig YAML content
 * @param resourcePath - API path to watch (use getWatchPath helper)
 * @param contextName - Specific context to use
 * @param callback - Function called for each watch event
 * @param signal - AbortSignal to cancel the watch
 */
export async function watchResource(
	kubeconfigContent: string,
	resourcePath: string,
	contextName: string | undefined,
	callback: WatchCallback,
	signal?: AbortSignal
): Promise<void> {
	try {
		const parsedKubeconfig = parseKubeconfig(kubeconfigContent, contextName);
		const url = `${parsedKubeconfig.server}${resourcePath}`;
		const urlObj = new URL(url);

		const skipTLS =
			parsedKubeconfig.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

		const options: https.RequestOptions = {
			hostname: urlObj.hostname,
			port: urlObj.port || 443,
			path: urlObj.pathname + urlObj.search,
			method: 'GET',
			headers: {
				Accept: 'application/json'
			},
			rejectUnauthorized: !skipTLS,
			servername: urlObj.hostname
		};

		// Add TLS options
		if (parsedKubeconfig.ca) {
			options.ca = parsedKubeconfig.ca;
		}
		if (parsedKubeconfig.cert && parsedKubeconfig.key) {
			options.cert = parsedKubeconfig.cert;
			options.key = parsedKubeconfig.key;
		}
		if (parsedKubeconfig.token) {
			options.headers = {
				...options.headers,
				Authorization: `Bearer ${parsedKubeconfig.token}`
			};
		}

		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					buildHttpError(res).then(reject, reject);
					return;
				}

				let buffer = '';

				res.on('data', (chunk) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (line.trim()) {
							try {
								const event = JSON.parse(line) as WatchEvent;
								callback(event);
							} catch (e) {
								console.error('[Watch Resource] Failed to parse event:', e);
							}
						}
					}
				});

				res.on('end', () => {
					resolve();
				});

				res.on('error', (err: any) => {
					const silent = [
						'ECONNRESET',
						'ECONNREFUSED',
						'ETIMEDOUT',
						'ENOTFOUND',
						'FailedToOpenSocket'
					];
					if (!silent.includes(err?.code)) {
						console.error('[Watch Resource] Response error:', err);
					}
					reject(err);
				});
			});

			req.on('error', (err: any) => {
				const silent = [
					'ECONNRESET',
					'ECONNREFUSED',
					'ETIMEDOUT',
					'ENOTFOUND',
					'FailedToOpenSocket'
				];
				if (!silent.includes(err?.code)) {
					console.error('[Watch Resource] Request error:', err);
				}
				reject(err);
			});

			// Handle abort signal
			if (signal) {
				signal.addEventListener('abort', () => {
					req.destroy();
					resolve();
				});
			}

			req.end();
		});
	} catch (error) {
		console.error('[Watch Resource] Setup error:', error);
		throw error;
	}
}

/**
 * Watch Kubernetes resources using clusterId (supports all connection types)
 * @param clusterId - Database cluster ID
 * @param resourcePath - API path to watch (use getWatchPath helper)
 * @param callback - Function called for each watch event
 * @param signal - AbortSignal to cancel the watch
 */
export async function watchResourceByCluster(
	clusterId: number,
	resourcePath: string,
	callback: WatchCallback,
	signal?: AbortSignal
): Promise<void> {
	try {
		// Fetch cluster configuration from database (returns decrypted values)
		const cluster = await findCluster(clusterId);
		if (!cluster) {
			const err = new Error(`Cluster ${clusterId} not found`);
			(err as NodeJS.ErrnoException).code = 'CONFIG_ERROR';
			throw err;
		}

		// Build connection config (supports kubeconfig and bearer-token)
		const config = buildConnectionConfig({
			...cluster,
			authType: cluster.authType ?? undefined
		});

		// Agent connections cannot use upstream streaming watch, so emulate it via polling.
		if (config.authType === 'agent') {
			return pollResourceByConnection(config, resourcePath, callback, signal);
		}

		// Support both full paths and API paths from resource-paths.ts
		const url = `${config.server}${resourcePath}`;
		const urlObj = new URL(url);

		const skipTLS = config.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

		const options: https.RequestOptions = {
			hostname: urlObj.hostname,
			port: urlObj.port || 443,
			path: urlObj.pathname + urlObj.search,
			method: 'GET',
			headers: {
				Accept: 'application/json'
			},
			rejectUnauthorized: !skipTLS,
			servername: urlObj.hostname
		};

		// Add TLS options
		if (config.ca) {
			options.ca = config.ca;
		}
		if ('cert' in config && config.cert && 'key' in config && config.key) {
			options.cert = config.cert;
			options.key = config.key;
		}
		if (config.token) {
			options.headers = {
				...options.headers,
				Authorization: `Bearer ${config.token}`
			};
		}

		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					buildHttpError(res).then(reject, reject);
					return;
				}

				let buffer = '';

				res.on('data', (chunk) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (line.trim()) {
							try {
								const event = JSON.parse(line) as WatchEvent;
								callback(event);
							} catch (e) {
								console.error('[Watch Resource] Failed to parse event:', e);
							}
						}
					}
				});

				res.on('end', () => {
					resolve();
				});

				res.on('error', (err: any) => {
					const silent = [
						'ECONNRESET',
						'ECONNREFUSED',
						'ETIMEDOUT',
						'ENOTFOUND',
						'FailedToOpenSocket'
					];
					if (!silent.includes(err?.code)) {
						console.error('[Watch Resource] Response error:', err);
					}
					reject(err);
				});
			});

			req.on('error', (err: any) => {
				const silent = [
					'ECONNRESET',
					'ECONNREFUSED',
					'ETIMEDOUT',
					'ENOTFOUND',
					'FailedToOpenSocket'
				];
				if (!silent.includes(err?.code)) {
					console.error('[Watch Resource] Request error:', err);
				}
				reject(err);
			});

			// Handle abort signal
			if (signal) {
				signal.addEventListener('abort', () => {
					req.destroy();
					resolve();
				});
			}

			req.end();
		});
	} catch (error) {
		console.error('[Watch Resource] Setup error:', error);
		throw error;
	}
}
