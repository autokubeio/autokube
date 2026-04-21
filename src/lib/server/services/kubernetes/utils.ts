/**
 * Kubernetes Utilities
 * Shared utilities for Kubernetes operations
 */

import * as yaml from 'js-yaml';
import https from 'node:https';

// ── Types ───────────────────────────────────────────────────────────────────

export type AuthType = 'kubeconfig' | 'bearer-token' | 'agent';

export interface KubeconfigData {
	authType?: 'kubeconfig';
	server: string;
	token?: string;
	cert?: Buffer;
	key?: Buffer;
	ca?: Buffer;
	skipTLSVerify?: boolean;
	contextName: string;
	clusterName: string;
}

export interface BearerTokenConnection {
	authType: 'bearer-token';
	server: string;
	token: string;
	ca?: Buffer;
	skipTLSVerify?: boolean;
	clusterName: string;
}

export interface AgentConnection {
	authType: 'agent';
	agentToken: string;
	clusterName: string;
}

export type ConnectionConfig = KubeconfigData | BearerTokenConnection | AgentConnection;

export interface ApiRequestOptions {
	method?: string;
	body?: string;
	headers?: Record<string, string>;
	timeout?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_TIMEOUT = 15000;

// ── Error Formatting ────────────────────────────────────────────────────────

export function formatConnectionError(
	error: Error,
	serverUrl: string,
	clusterName: string
): string {
	if (error.message.includes('certificate')) {
		return `TLS/Certificate error connecting to ${clusterName}. Verify cluster CA or enable insecure mode.`;
	}
	if (error.message.includes('ECONNREFUSED')) {
		return `Connection refused to ${serverUrl}. Is the cluster running and accessible?`;
	}
	if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
		return `Connection timeout to ${clusterName}. Check network connectivity and firewall rules.`;
	}
	if (error.message.includes('ENOTFOUND')) {
		return `Cannot resolve hostname in ${serverUrl}. Check DNS or cluster URL.`;
	}
	return error.message;
}

// ── Kubeconfig Parsing ──────────────────────────────────────────────────────

export function parseKubeconfig(kubeconfigContent: string, contextName?: string): KubeconfigData {
	// Guard against encrypted-but-not-decrypted values (decryption key mismatch)
	if (kubeconfigContent.startsWith('enc:v1:')) {
		throw new Error(
			'Kubeconfig could not be decrypted — the encryption key may have changed. ' +
				'Re-save the cluster credentials to resolve this.'
		);
	}

	let doc: unknown;
	let contentToparse = kubeconfigContent;

	try {
		doc = yaml.load(contentToparse);
	} catch (err) {
		throw new Error(
			'Failed to parse kubeconfig YAML: ' + (err instanceof Error ? err.message : String(err))
		);
	}

	// yaml.load can return a string when the content is:
	//   1. YAML-quoted  — the YAML value IS a string scalar (e.g. the whole doc is wrapped in quotes)
	//   2. JSON-stringified — someone JSON.stringify'd the YAML before saving
	//   3. Base64-encoded — the raw bytes were base64-encoded before saving
	// Try to unwrap each case and re-parse.
	if (typeof doc === 'string') {
		const docStr: string = doc;
		let unwrapped: string | null = null;

		// Attempt 1: the string IS the YAML (YAML-quoted scalar — just re-parse the returned string)
		if (docStr.includes('apiVersion') || docStr.includes('clusters:')) {
			unwrapped = docStr;
		}

		// Attempt 2: JSON-encoded (e.g. the kubeconfig was JSON.stringify'd before saving)
		if (!unwrapped) {
			try {
				const jsonParsed = JSON.parse(docStr);
				if (typeof jsonParsed === 'string') unwrapped = jsonParsed;
				else if (jsonParsed && typeof jsonParsed === 'object') {
					// Already a parsed object — use directly
					doc = jsonParsed;
				}
			} catch {
				// not JSON
			}
		}

		// Attempt 3: base64-encoded
		if (!unwrapped && typeof doc === 'string') {
			try {
				const decoded = Buffer.from(docStr, 'base64').toString('utf8');
				if (decoded.includes('apiVersion') || decoded.startsWith('---')) {
					unwrapped = decoded;
				}
			} catch {
				// not base64
			}
		}

		if (unwrapped && typeof doc === 'string') {
			try {
				doc = yaml.load(unwrapped);
				contentToparse = unwrapped;
			} catch {
				// fall through to error below
			}
		}
	}

	if (!doc || typeof doc !== 'object') {
		throw new Error(
			'Invalid kubeconfig: the stored value does not appear to be a valid kubeconfig YAML object. ' +
				'Please re-upload or re-paste the kubeconfig in cluster settings.'
		);
	}

	const docObj = doc as Record<string, unknown>;
	const contexts = docObj.contexts as Array<{
		name: string;
		context: { cluster: string; user: string };
	}>;
	const clusters = docObj.clusters as Array<{
		name: string;
		cluster: {
			server: string;
			'certificate-authority-data'?: string;
			'insecure-skip-tls-verify'?: boolean;
		};
	}>;
	const users = docObj.users as Array<{
		name: string;
		user: { token?: string; 'client-certificate-data'?: string; 'client-key-data'?: string };
	}>;

	if (!contexts?.length || !clusters?.length || !users?.length) {
		console.error(
			'[K8s] Kubeconfig missing sections - contexts:',
			!!contexts?.length,
			'clusters:',
			!!clusters?.length,
			'users:',
			!!users?.length
		);
		throw new Error('Kubeconfig missing required sections (contexts, clusters, users)');
	}

	const currentContextName = contextName || (docObj['current-context'] as string);
	if (!currentContextName) {
		throw new Error('No context specified and no current-context in kubeconfig');
	}

	const context = contexts.find((c) => c.name === currentContextName);
	if (!context) {
		throw new Error(`Context "${currentContextName}" not found`);
	}

	const cluster = clusters.find((c) => c.name === context.context.cluster);
	const user = users.find((u) => u.name === context.context.user);

	if (!cluster) {
		throw new Error(`Cluster "${context.context.cluster}" not found`);
	}
	if (!user) {
		throw new Error(`User "${context.context.user}" not found`);
	}

	// Decode base64 certificates to Buffers
	const cert = user.user['client-certificate-data']
		? Buffer.from(user.user['client-certificate-data'], 'base64')
		: undefined;
	const key = user.user['client-key-data']
		? Buffer.from(user.user['client-key-data'], 'base64')
		: undefined;
	const ca = cluster.cluster['certificate-authority-data']
		? Buffer.from(cluster.cluster['certificate-authority-data'], 'base64')
		: undefined;

	return {
		authType: 'kubeconfig',
		server: cluster.cluster.server,
		token: user.user.token,
		cert,
		key,
		ca,
		skipTLSVerify: cluster.cluster['insecure-skip-tls-verify'] || false,
		contextName: currentContextName,
		clusterName: cluster.name
	};
}

// ── Connection Builders ─────────────────────────────────────────────────────

/**
 * Create connection config from bearer token credentials
 */
export function createBearerTokenConnection(
	apiServer: string,
	bearerToken: string,
	clusterName: string,
	options?: { ca?: string; skipTLSVerify?: boolean }
): BearerTokenConnection {
	return {
		authType: 'bearer-token',
		server: apiServer,
		token: bearerToken,
		ca: options?.ca ? Buffer.from(options.ca, 'base64') : undefined,
		skipTLSVerify: options?.skipTLSVerify ?? false,
		clusterName
	};
}

/**
 * Create connection config from AutoKube agent credentials.
 * Agent connects TO AutoKube at /api/proxy?token=xxx (reverse proxy model).
 */
export function createAgentConnection(agentToken: string, clusterName: string): AgentConnection {
	return {
		authType: 'agent',
		agentToken,
		clusterName
	};
}

/**
 * Build connection config from database cluster record
 */
export function buildConnectionConfig(cluster: {
	authType?: string;
	apiServer?: string | null;
	kubeconfig?: string | null;
	context?: string | null;
	bearerToken?: string | null;
	tlsCa?: string | null;
	tlsSkipVerify?: boolean | null;
	agentUrl?: string | null;
	agentToken?: string | null;
	name: string;
}): ConnectionConfig {
	const authType = (cluster.authType || 'kubeconfig') as AuthType;

	switch (authType) {
		case 'kubeconfig':
			if (!cluster.kubeconfig) {
				throw new Error('Kubeconfig content is required for kubeconfig auth type');
			}
			if (cluster.kubeconfig.startsWith('enc:v1:')) {
				throw new Error(
					`Cluster "${cluster.name}": kubeconfig is encrypted but could not be decrypted. ` +
						'The encryption key may have changed — re-save the cluster credentials to fix this.'
				);
			}
			return parseKubeconfig(cluster.kubeconfig, cluster.context || undefined);

		case 'bearer-token':
			if (!cluster.apiServer || !cluster.bearerToken) {
				throw new Error('API server and bearer token are required for bearer-token auth type');
			}
			if (cluster.bearerToken.startsWith('enc:v1:')) {
				throw new Error(
					`Cluster "${cluster.name}": bearer token is encrypted but could not be decrypted. ` +
						'The encryption key may have changed — re-save the cluster credentials to fix this.'
				);
			}
			return createBearerTokenConnection(cluster.apiServer, cluster.bearerToken, cluster.name, {
				ca: cluster.tlsCa || undefined,
				skipTLSVerify: cluster.tlsSkipVerify ?? false
			});

		case 'agent':
			if (!cluster.agentToken) {
				throw new Error('Agent token is required for agent auth type');
			}
			return createAgentConnection(cluster.agentToken, cluster.name);

		default:
			throw new Error(`Unsupported auth type: ${authType}`);
	}
}

// ── HTTP Request Wrapper ────────────────────────────────────────────────────

/**
 * Build HTTPS request options from connection config
 * Handles authentication, TLS, and SNI properly
 */
export function buildRequestOptions(
	config: KubeconfigData | BearerTokenConnection,
	url: URL,
	method: string,
	headers: Record<string, string>,
	timeout: number
): https.RequestOptions {
	// Check if TLS verification should be skipped
	// Priority: 1. Cluster config, 2. NODE_TLS_REJECT_UNAUTHORIZED env var
	const skipTLSVerify = config.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

	const options: https.RequestOptions = {
		hostname: url.hostname,
		port: url.port || 443,
		path: url.pathname + url.search,
		method,
		headers: {
			'Content-Type': 'application/json',
			...headers,
			...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
		},
		timeout,
		rejectUnauthorized: !skipTLSVerify,
		servername: url.hostname // Important for SNI (Server Name Indication)
	};

	// Add TLS certificates if present
	if (config.ca) options.ca = config.ca;
	if ('cert' in config && config.cert) options.cert = config.cert;
	if ('key' in config && config.key) options.key = config.key;

	return options;
}

/**
 * Make a request to Kubernetes API or AutoKube agent
 * Supports kubeconfig, bearer token, and agent authentication
 */
export function k8sRequest<T = unknown>(
	config: ConnectionConfig,
	path: string,
	timeout = DEFAULT_TIMEOUT,
	options: ApiRequestOptions = {}
): Promise<T> {
	// Route to agent if using agent auth type
	if (config.authType === 'agent') {
		return agentRequest<T>(config as AgentConnection, path, timeout, options);
	}

	// Standard Kubernetes API request (kubeconfig or bearer-token)
	const standardConfig = config as KubeconfigData | BearerTokenConnection;

	return new Promise((resolve, reject) => {
		const url = new URL(path, standardConfig.server);
		const reqOptions = buildRequestOptions(
			standardConfig,
			url,
			options.method || 'GET',
			options.headers || {},
			timeout
		);

		const req = https.request(reqOptions, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					try {
						resolve(JSON.parse(data) as T);
					} catch {
						resolve(data as T);
					}
				} else {
					reject(new Error(`HTTP ${res.statusCode}: ${data}`));
				}
			});
		});

		req.setTimeout(timeout, () => {
			req.destroy();
			reject(new Error('Request timeout'));
		});

		req.on('error', reject);

		if (options.body) {
			req.write(options.body);
		}

		req.end();
	});
}

/**
 * Make a request through AutoKube agent.
 * Agent connects TO AutoKube and maintains a persistent WebSocket connection.
 * This function sends K8s API requests through the agent connection manager
 * and waits for the response.
 */
async function agentRequest<T = unknown>(
	config: AgentConnection,
	k8sPath: string,
	timeout = DEFAULT_TIMEOUT,
	options: ApiRequestOptions = {}
): Promise<T> {
	const { sendAgentRequest } = await import('$lib/server/services/agent-connection');

	const response = await sendAgentRequest(
		config.agentToken,
		k8sPath,
		options.method ?? 'GET',
		options.body,
		options.body
			? { 'Content-Type': 'application/json', ...options.headers }
			: options.headers,
		timeout
	);

	if (response.status >= 200 && response.status < 300) {
		try {
			return JSON.parse(response.body) as T;
		} catch {
			return response.body as T;
		}
	} else {
		throw new Error(`HTTP ${response.status}: ${response.body}`);
	}
}

// ── Generic API Wrapper ─────────────────────────────────────────────────────

export interface ApiResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Backwards compatible wrapper for kubeconfig-based operations
 * @deprecated Use withConnection() for new code
 */
export async function withKubeconfig<T>(
	kubeconfigContent: string,
	contextName: string | undefined,
	operation: (config: KubeconfigData) => Promise<T>
): Promise<ApiResult<T>> {
	try {
		if (!kubeconfigContent?.trim()) {
			return { success: false, error: 'Kubeconfig content is empty' };
		}

		let config: KubeconfigData;
		try {
			config = parseKubeconfig(kubeconfigContent, contextName);
		} catch (parseError) {
			return {
				success: false,
				error: `Invalid kubeconfig: ${parseError instanceof Error ? parseError.message : 'Failed to parse'}`
			};
		}

		const data = await operation(config);
		return { success: true, data };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Operation failed'
		};
	}
}

/**
 * Generic connection wrapper supporting all auth types
 */
export async function withConnection<T>(
	config: ConnectionConfig,
	operation: (config: ConnectionConfig) => Promise<T>
): Promise<ApiResult<T>> {
	try {
		const data = await operation(config);
		return { success: true, data };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Operation failed'
		};
	}
}

// ── Per-cluster connection config cache ──────────────────────────────────────
// Caches the built ConnectionConfig (or a failure message) per cluster ID for a
// short TTL so that parallel requests (e.g. Promise.allSettled([4x makeClusterRequest]))
// share one DB lookup + kubeconfig parse and only log config errors once per burst.

const CLUSTER_CONFIG_CACHE_TTL = 15_000; // 15 s — covers any reasonable burst of parallel calls

type ConfigCacheEntry =
	| { ok: true; config: ConnectionConfig; ts: number }
	| { ok: false; error: string; ts: number };

const _clusterConfigCache = new Map<number, ConfigCacheEntry>();

// Suppress repeated connection-error logs for the same cluster.
// Background health checks poll every cluster on a fixed interval; without
// this, every poll cycle floods the log with the same ECONNREFUSED warning.
const CLUSTER_ERROR_LOG_COOLDOWN = 5 * 60_000; // 5 minutes
const _clusterErrorLogTs = new Map<number, number>();

function shouldLogClusterError(clusterId: number): boolean {
	const now = Date.now();
	const last = _clusterErrorLogTs.get(clusterId) ?? 0;
	if (now - last < CLUSTER_ERROR_LOG_COOLDOWN) return false;
	_clusterErrorLogTs.set(clusterId, now);
	return true;
}

/**
 * Make a Kubernetes API request for a specific cluster by ID
 * This is the recommended high-level function for all cluster operations
 *
 * @param clusterId - Database cluster ID
 * @param apiPath - Kubernetes API path (e.g., '/api/v1/pods' or '/apis/apps/v1/deployments')
 * @param timeout - Optional request timeout in milliseconds
 * @param options - Optional request options (method, body, headers)
 * @returns Promise with ApiResult containing the response data or error
 *
 * @example
 * // Get pods from a cluster
 * const result = await makeClusterRequest(clusterId, '/api/v1/namespaces/default/pods');
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 */
export async function makeClusterRequest<T = unknown>(
	clusterId: number,
	apiPath: string,
	timeout?: number,
	options?: ApiRequestOptions
): Promise<ApiResult<T>> {
	const MAX_RETRIES = 3;

	try {
		// ── Resolve connection config (with short-lived cache) ──────────────────
		// Multiple parallel requests for the same cluster share one DB lookup +
		// kubeconfig parse, and config errors are logged only once per burst.
		const now = Date.now();
		let config: ConnectionConfig;

		const cached = _clusterConfigCache.get(clusterId);
		if (cached && now - cached.ts < CLUSTER_CONFIG_CACHE_TTL) {
			if (!cached.ok) {
				// Config is known-bad — return immediately without re-logging
				return { success: false, error: cached.error };
			}
			config = cached.config;
		} else {
			// Import here to avoid circular dependency
			const { findCluster } = await import('$lib/server/queries/clusters');

			const cluster = await findCluster(clusterId);
			if (!cluster) {
				return { success: false, error: 'Cluster not found' };
			}

			try {
				config = buildConnectionConfig({
					...cluster,
					authType: cluster.authType ?? undefined
				});
				_clusterConfigCache.set(clusterId, { ok: true, config, ts: Date.now() });
			} catch (configErr) {
				// Log once and cache the failure so parallel requests stay silent
				const errorMsg = formatK8sError(configErr);
				_clusterConfigCache.set(clusterId, { ok: false, error: errorMsg, ts: Date.now() });
				return { success: false, error: errorMsg };
			}
		}

		// Make the request with automatic retry on 429 (storage initializing)
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const data = await k8sRequest<T>(config, apiPath, timeout, options);
				return { success: true, data };
			} catch (err) {
				if (err instanceof Error && err.message.startsWith('HTTP 429:') && attempt < MAX_RETRIES) {
					// Parse retryAfterSeconds from the K8s Status body, default to 1s
					const match = err.message.match(/"retryAfterSeconds"\s*:\s*(\d+)/);
					const waitMs = match ? parseInt(match[1]) * 1000 : 1000;
					console.warn(
						`[K8s] 429 on ${apiPath} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
					);
					await new Promise((resolve) => setTimeout(resolve, waitMs + attempt * 200));
					continue;
				}
				throw err; // re-throw non-429 or exhausted retries
			}
		}

		// Should be unreachable, but satisfy the type checker
		return { success: false, error: 'Request failed after retries' };
	} catch (error) {
		return {
			success: false,
			error: formatK8sError(error, clusterId)
		};
	}
}

/**
 * Resolve connection config for a cluster by ID (uses short-lived cache).
 * Returns null if cluster not found or config is invalid.
 */
export async function getClusterConnectionConfig(
	clusterId: number
): Promise<ConnectionConfig | null> {
	const now = Date.now();
	const cached = _clusterConfigCache.get(clusterId);
	if (cached && now - cached.ts < CLUSTER_CONFIG_CACHE_TTL) {
		return cached.ok ? cached.config : null;
	}
	const { findCluster } = await import('$lib/server/queries/clusters');
	const cluster = await findCluster(clusterId);
	if (!cluster) return null;
	try {
		const config = buildConnectionConfig({
			...cluster,
			authType: cluster.authType ?? undefined
		});
		_clusterConfigCache.set(clusterId, { ok: true, config, ts: Date.now() });
		return config;
	} catch {
		return null;
	}
}

/**
 * Invalidate the cached connection config for a cluster (call after updating credentials).
 */
export function invalidateClusterConfigCache(clusterId: number): void {
	_clusterConfigCache.delete(clusterId);
}

/**
 * Test a connection with provided credentials (before saving to database)
 * Supports all three authentication methods
 *
 * @param credentials - Connection credentials based on auth type
 * @returns Promise with ApiResult containing version info or error
 *
 * @example
 * // Test kubeconfig
 * const result = await testConnectionCredentials({
 *   authType: 'kubeconfig',
 *   kubeconfig: '...',
 *   context: 'my-context'
 * });
 */
export async function testConnectionCredentials(credentials: {
	authType: 'kubeconfig' | 'bearer-token' | 'agent';
	kubeconfig?: string;
	context?: string;
	apiServer?: string;
	bearerToken?: string;
	tlsSkipVerify?: boolean;
	agentToken?: string;
}): Promise<ApiResult<{ major: string; minor: string; version: string }>> {
	try {
		let config: ConnectionConfig;

		// Build config based on auth type
		switch (credentials.authType) {
			case 'kubeconfig':
				if (!credentials.kubeconfig) {
					return { success: false, error: 'Kubeconfig is required' };
				}
				config = parseKubeconfig(credentials.kubeconfig, credentials.context);
				break;

			case 'bearer-token':
				if (!credentials.apiServer || !credentials.bearerToken) {
					return { success: false, error: 'API server and bearer token are required' };
				}
				config = createBearerTokenConnection(
					credentials.apiServer,
					credentials.bearerToken,
					'test-cluster',
					{ skipTLSVerify: credentials.tlsSkipVerify ?? false }
				);
				break;

			case 'agent':
				if (!credentials.agentToken) {
					return { success: false, error: 'Agent token is required' };
				}
				config = createAgentConnection(credentials.agentToken, 'test-cluster');
				break;

			default:
				return { success: false, error: 'Invalid auth type' };
		}

		// Test connection by fetching version
		const versionData = await k8sRequest<{ major: string; minor: string }>(
			config,
			'/version',
			10000
		);

		const version =
			versionData.major && versionData.minor
				? `${versionData.major}.${versionData.minor}`
				: 'Unknown';

		return {
			success: true,
			data: {
				...versionData,
				version
			}
		};
	} catch (error) {
		return {
			success: false,
			error: formatK8sError(error)
		};
	}
}

/**
 * Format Kubernetes error into user-friendly message
 * Centralized error formatting for consistent messages across the app
 *
 * Known/expected errors (connectivity, auth, config) are logged at warn level
 * with just the message. Unexpected errors are logged at error level with full detail.
 */
function formatK8sError(error: unknown, clusterId?: number): string {
	if (!(error instanceof Error)) {
		console.error('[K8s] Unexpected error:', error);
		return 'Unknown error occurred';
	}

	const msg = error.message.toLowerCase();
	// For per-cluster transient network errors, suppress repeated logs within the cooldown window
	const canLog = clusterId === undefined || shouldLogClusterError(clusterId);

	// Encryption / credential errors — warn only, no stack trace
	if (msg.includes('could not be decrypted') || msg.includes('encryption key')) {
		if (canLog) console.warn('[K8s]', error.message);
		return error.message;
	}

	// Network errors — expected when clusters are unreachable, warn only
	if (msg.includes('econnrefused')) {
		if (canLog) console.warn('[K8s] Connection refused:', error.message);
		return 'Connection refused - API server is not reachable';
	}
	if (msg.includes('etimedout') || msg.includes('timeout')) {
		if (canLog) console.warn('[K8s] Timeout:', error.message);
		return 'Connection timeout - cluster is unreachable';
	}
	if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
		if (canLog) console.warn('[K8s] Host not found:', error.message);
		return 'Host not found - check API server URL';
	}

	// TLS/SSL errors
	if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
		if (canLog) console.warn('[K8s] TLS error:', error.message);
		return 'TLS/SSL certificate verification failed';
	}

	// Authentication errors
	if (msg.includes('http 401') || msg.includes('unauthorized')) {
		if (canLog) console.warn('[K8s] Auth failed:', error.message);
		return 'Authentication failed - invalid credentials';
	}

	// Authorization errors
	if (msg.includes('http 403') || msg.includes('forbidden')) {
		if (canLog) console.warn('[K8s] Access denied:', error.message);
		return 'Access denied - insufficient permissions';
	}

	// Rate limit / storage initializing
	if (msg.includes('http 429') || msg.includes('toomanyrequests')) {
		console.warn('[K8s] Rate limited:', error.message);
		return 'Kubernetes API is temporarily unavailable (storage initializing) — please retry in a moment';
	}

	// 404 / not found — expected for optional resources (e.g. metrics-server)
	if (msg.includes('http 404') || msg.includes('not found')) {
		// Don't log 404s - they're expected for optional resources
		return 'Resource not found';
	}

	// 409 / already exists — expected when creating resources that already exist (e.g. namespace)
	if (msg.includes('http 409') || msg.includes('alreadyexists') || msg.includes('already exists')) {
		// Don't log — callers decide whether this is an error
		return error.message;
	}

	// Server errors — callers log with full context, no generic log here
	if (msg.includes('http 5') || msg.includes('internal server error')) {
		return 'Kubernetes API server error';
	}

	// Implementation errors — not a code bug, informational
	if (msg.includes('not yet implemented') || msg.includes('agent communication')) {
		return 'Agent connection not yet implemented';
	}
	if (msg.includes('agent not connected')) {
		// Expected when agent cluster hasn't connected (yet) — no stack trace needed
		return 'Agent not connected';
	}
	if (msg.includes('agent request timeout')) {
		// Already logged by the timeout handler — don't double-log
		return error.message;
	}
	if (msg.includes('unsupported auth type')) {
		return 'Unsupported authentication type';
	}
	if (msg.includes('kubeconfig not available') || msg.includes('credentials not available')) {
		return 'Cluster credentials not configured';
	}

	// Kubeconfig / parsing errors — already formatted
	if (
		msg.includes('invalid kubeconfig') ||
		msg.includes('failed to parse') ||
		msg.includes('kubeconfig content is required') ||
		msg.includes('kubeconfig is')
	) {
		// Log once via sampling to avoid spam during polling
		if (Math.random() < 0.05) { // 5% sampling
			console.warn('[K8s] Config error:', error.message);
		}
		return error.message;
	}

	// Unexpected — log the full error for debugging
	console.error('[K8s] Unexpected error:', error);
	return error.message;
}
