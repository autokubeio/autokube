/**
 * Agent Connection Manager — WebSocket-based
 *
 * Manages persistent WebSocket connections from AutoKube agents deployed in Kubernetes clusters.
 * Each agent connects with its unique token via ws(s)://<host>/api/agent/ws?token=xxx
 *
 * Protocol (WebSocket):
 *   1. Agent opens WebSocket to /api/agent/ws?token=xxx
 *   2. Server validates token, registers connection, sends { type: "connected" }
 *   3. When AutoKube needs K8s data it pushes: { id, type: "k8s-request", path, method, body?, headers? }
 *   4. Agent executes against local K8s API and responds: { id, type: "k8s-response", status, body, headers? }
 *   5. Server sends { type: "ping" } every 30s; agent replies { type: "pong" }
 */

import type { ServerWebSocket } from 'bun';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentK8sRequest {
	id: string;
	type: 'k8s-request';
	path: string;
	method: string;
	body?: string;
	headers?: Record<string, string>;
	timeout?: number;
}

export interface AgentK8sResponse {
	id: string;
	type: 'k8s-response';
	status: number;
	body: string;
	headers?: Record<string, string>;
}

// ── Exec Protocol Types ─────────────────────────────────────────────────────

/** Server → Agent: start an exec session */
export interface AgentExecStart {
	id: string;
	type: 'exec-start';
	namespace: string;
	pod: string;
	container: string;
	shell: string;
	cols: number;
	rows: number;
}

/** Agent → Server: exec session started successfully */
export interface AgentExecStarted {
	id: string;
	type: 'exec-started';
	sessionId: string;
}

/** Agent → Server: exec start failed */
export interface AgentExecError {
	id: string;
	type: 'exec-error';
	error: string;
}

/** Agent → Server: exec stdout/stderr data */
export interface AgentExecOutput {
	type: 'exec-output';
	sessionId: string;
	channel: number; // 1 = stdout, 2 = stderr
	data: string;
}

/** Agent → Server: exec session closed */
export interface AgentExecClosed {
	type: 'exec-closed';
	sessionId: string;
	code?: number;
	reason?: string;
}

/** Callbacks registered for a remote exec session */
export interface AgentExecCallbacks {
	onData: (channel: number, data: string) => void;
	onClose: (code?: number, reason?: string) => void;
	onError: (err: Error) => void;
}

interface PendingRequest {
	resolve: (response: AgentK8sResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface PendingExecStart {
	resolve: (sessionId: string) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface AgentWsData {
	token: string;
	clusterId: number;
}

interface AgentConnection {
	token: string;
	clusterId: number;
	connectedAt: Date;
	lastActivityAt: Date;
	ws: ServerWebSocket<AgentWsData>;
	pendingRequests: Map<string, PendingRequest>;
}

// ── Connection Registry ──────────────────────────────────────────────────────

// Store on globalThis so that Vite HMR module reloads do not destroy live
// agent sessions — both the Bun WebSocket handler (hooks.server.ts) and the
// Vite dev-plugin WebSocket shim reference the same Maps.
declare global {
	var __autokubeAgentConnections: Map<string, AgentConnection> | undefined;
	var __autokubeAgentClusterToToken: Map<number, string> | undefined;
	var __autokubeAgentExecSessions: Map<string, AgentExecCallbacks> | undefined;
	var __autokubePendingAgentExecEvents: Map<string, PendingAgentExecEvents> | undefined;
	var __autokubeAgentHandlers: {
		validateAgentToken: (token: string) => Promise<number | null>;
		handleAgentOpen: (ws: unknown) => Promise<void>;
		handleAgentMessage: (ws: unknown, message: string | Buffer) => void;
		handleAgentClose: (ws: unknown, code: number, reason: string) => void;
	} | undefined;
}

/** Map of agent token → active connection */
const connections: Map<string, AgentConnection> =
	(globalThis.__autokubeAgentConnections ??= new Map());

/** Map of cluster ID → agent token */
const clusterToToken: Map<number, string> =
	(globalThis.__autokubeAgentClusterToToken ??= new Map());

/** Map of agent exec sessionId → callbacks (for relaying output back to SSE) */
const agentExecSessions: Map<string, AgentExecCallbacks> =
	(globalThis.__autokubeAgentExecSessions ??= new Map());

interface PendingAgentExecEvents {
	outputs: Array<{ channel: number; data: string }>;
	close?: { code?: number; reason?: string };
	error?: string;
}

/** Buffer of early agent exec events received before callback registration */
const pendingAgentExecEvents: Map<string, PendingAgentExecEvents> =
	(globalThis.__autokubePendingAgentExecEvents ??= new Map());

const REQUEST_TIMEOUT = 60_000; // 60s timeout for K8s requests through agent
const PING_INTERVAL = 30_000; // 30s ping interval
const STALE_TIMEOUT = 90_000; // 90s without activity = stale

// ── WebSocket Lifecycle (called from hooks.server.ts websocket handler) ──────

/**
 * Called when an agent WebSocket connection opens.
 */
export async function handleAgentOpen(ws: ServerWebSocket<AgentWsData>): Promise<void> {
	const { token, clusterId } = ws.data;

	// Clean up any existing connection for this cluster
	const existingToken = clusterToToken.get(clusterId);
	if (existingToken && existingToken !== token) {
		disconnectAgent(existingToken, 'Replaced by new connection');
	}

	// If same token is already connected, close old one
	if (connections.has(token)) {
		disconnectAgent(token, 'Reconnected');
	}

	connections.set(token, {
		token,
		clusterId,
		connectedAt: new Date(),
		lastActivityAt: new Date(),
		ws,
		pendingRequests: new Map()
	});

	clusterToToken.set(clusterId, token);

	ws.send(JSON.stringify({ type: 'connected', clusterId }));
	console.log(`[agent-ws] Agent connected for cluster #${clusterId}`);
}

/**
 * Called when an agent WebSocket message is received.
 */
export function handleAgentMessage(ws: ServerWebSocket<AgentWsData>, message: string | Buffer): void {
	const { token } = ws.data;
	const conn = connections.get(token);
	if (!conn) return;

	conn.lastActivityAt = new Date();

	const raw = typeof message === 'string' ? message : message.toString();

	// Handle plain-text pong from agent (response to our plain-text ping)
	if (raw === 'pong') return;

	let msg: { type: string; id?: string; [key: string]: unknown };
	try {
		msg = JSON.parse(raw);
	} catch {
		console.error('[agent-ws] Invalid JSON from agent');
		return;
	}

	// Handle JSON pong (backwards compatibility)
	if (msg.type === 'pong') {
		return;
	}

	// Handle K8s response
	if (msg.type === 'k8s-response' && msg.id) {
		const pending = conn.pendingRequests.get(msg.id);
		if (pending) {
			clearTimeout(pending.timer);
			conn.pendingRequests.delete(msg.id);
			pending.resolve({
				id: msg.id,
				type: 'k8s-response',
				status: (msg.status as number) ?? 500,
				body: (msg.body as string) ?? '',
				headers: (msg.headers as Record<string, string>) ?? {}
			});
		}
		return;
	}

	// Handle exec-started response (agent successfully opened K8s exec session)
	if (msg.type === 'exec-started' && msg.id && msg.sessionId) {
		const pending = conn.pendingRequests.get(msg.id);
		if (pending) {
			clearTimeout(pending.timer);
			conn.pendingRequests.delete(msg.id);
			// Resolve with a fake AgentK8sResponse carrying the sessionId
			pending.resolve({
				id: msg.id,
				type: 'k8s-response',
				status: 200,
				body: JSON.stringify({ sessionId: msg.sessionId as string })
			});
		}
		return;
	}

	// Handle exec-error response (agent failed to open exec session)
	if (msg.type === 'exec-error' && msg.id) {
		const pending = conn.pendingRequests.get(msg.id);
		if (pending) {
			clearTimeout(pending.timer);
			conn.pendingRequests.delete(msg.id);
			pending.resolve({
				id: msg.id,
				type: 'k8s-response',
				status: 500,
				body: JSON.stringify({ error: msg.error as string })
			});
		}
		return;
	}

	// Handle exec-oneshot-result
	if (msg.type === 'exec-oneshot-result' && msg.id) {
		const pending = conn.pendingRequests.get(msg.id as string);
		if (pending) {
			clearTimeout(pending.timer);
			conn.pendingRequests.delete(msg.id as string);
			pending.resolve({
				id: msg.id as string,
				type: 'k8s-response',
				status: 200,
				body: JSON.stringify({ stdout: msg.stdout as string, stderr: msg.stderr as string })
			});
		}
		return;
	}

	// Handle exec-oneshot-error
	if (msg.type === 'exec-oneshot-error' && msg.id) {
		const pending = conn.pendingRequests.get(msg.id as string);
		if (pending) {
			clearTimeout(pending.timer);
			conn.pendingRequests.delete(msg.id as string);
			pending.resolve({
				id: msg.id as string,
				type: 'k8s-response',
				status: 500,
				body: JSON.stringify({ error: msg.error as string })
			});
		}
		return;
	}

	// Handle exec-output (stdout/stderr data from agent exec session)
	if (msg.type === 'exec-output' && msg.sessionId) {
		const sid = msg.sessionId as string;
		const cbs = agentExecSessions.get(sid);
		if (cbs) {
			cbs.onData((msg.channel as number) ?? 1, (msg.data as string) ?? '');
		} else {
			const pending = pendingAgentExecEvents.get(sid) ?? { outputs: [] };
			pending.outputs.push({
				channel: (msg.channel as number) ?? 1,
				data: (msg.data as string) ?? ''
			});
			pendingAgentExecEvents.set(sid, pending);
		}
		return;
	}

	// Handle exec-closed (agent exec session ended)
	if (msg.type === 'exec-closed' && msg.sessionId) {
		const sid = msg.sessionId as string;
		const cbs = agentExecSessions.get(sid);
		const reason = (msg.reason as string | undefined) ?? '';
		const normalizedReason = reason.trim().toLowerCase();
		if (cbs) {
			if (normalizedReason === 'no_shell' || normalizedReason.startsWith('no_shell:')) {
				cbs.onError(new Error(reason));
			} else {
				cbs.onClose(msg.code as number | undefined, reason);
			}
		} else {
			const pending = pendingAgentExecEvents.get(sid) ?? { outputs: [] };
			if (normalizedReason === 'no_shell' || normalizedReason.startsWith('no_shell:')) {
				pending.error = reason;
			} else {
				pending.close = {
					code: msg.code as number | undefined,
					reason
				};
			}
			pendingAgentExecEvents.set(sid, pending);
		}
		agentExecSessions.delete(sid);
		return;
	}

	console.warn(`[agent-ws] Unknown message type from agent: ${msg.type}`);
}

/**
 * Called when an agent WebSocket connection closes.
 */
export function handleAgentClose(ws: ServerWebSocket<AgentWsData>, code: number, reason: string): void {
	const { token, clusterId } = ws.data;

	const conn = connections.get(token);
	if (!conn) return;

	// Reject all pending requests
	for (const [, pending] of conn.pendingRequests) {
		clearTimeout(pending.timer);
		pending.reject(new Error('Agent WebSocket closed'));
	}

	// Notify/clean up any active exec sessions for this agent's cluster
	for (const [sid, cbs] of agentExecSessions) {
		try {
			cbs.onClose(1001, 'Agent disconnected');
		} catch { /* ignore */ }
		agentExecSessions.delete(sid);
	}

	clusterToToken.delete(clusterId);
	connections.delete(token);
	console.log(`[agent-ws] Agent disconnected for cluster #${clusterId} (code=${code} reason=${reason || 'none'})`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Disconnect an agent by token.
 */
export function disconnectAgent(token: string, reason = 'Disconnected'): void {
	const conn = connections.get(token);
	if (!conn) return;

	// Reject all pending requests
	for (const [, pending] of conn.pendingRequests) {
		clearTimeout(pending.timer);
		pending.reject(new Error(reason));
	}

	try {
		conn.ws.close(1000, reason);
	} catch {
		// Socket may already be closed
	}

	clusterToToken.delete(conn.clusterId);
	connections.delete(token);
	console.log(`[agent-ws] Agent force-disconnected for cluster #${conn.clusterId}: ${reason}`);
}

/**
 * Check if an agent is connected for a given token.
 */
export function isAgentConnected(token: string): boolean {
	const conn = connections.get(token);
	if (!conn) return false;

	const elapsed = Date.now() - conn.lastActivityAt.getTime();
	if (elapsed > STALE_TIMEOUT) {
		disconnectAgent(token, 'Stale connection');
		return false;
	}

	return true;
}

/**
 * Check if an agent is connected for a given cluster ID.
 */
export function isAgentConnectedForCluster(clusterId: number): boolean {
	const token = clusterToToken.get(clusterId);
	if (!token) return false;
	return isAgentConnected(token);
}

/**
 * Send a K8s API request through the agent WebSocket and wait for the response.
 * Called by agentRequest() in kubernetes/utils.ts
 */
export function sendAgentRequest(
	token: string,
	path: string,
	method = 'GET',
	body?: string,
	headers?: Record<string, string>,
	timeout = REQUEST_TIMEOUT
): Promise<AgentK8sResponse> {
	const conn = connections.get(token);
	if (!conn) {
		return Promise.reject(new Error('Agent not connected'));
	}

	const id = crypto.randomUUID();

	const request: AgentK8sRequest = {
		id,
		type: 'k8s-request',
		path,
		method,
		body,
		headers,
		timeout
	};

	return new Promise<AgentK8sResponse>((resolve, reject) => {
		const timer = setTimeout(() => {
			conn.pendingRequests.delete(id);
			reject(new Error(`Agent request timeout after ${timeout}ms: ${method} ${path}`));
		}, timeout);

		conn.pendingRequests.set(id, { resolve, reject, timer });

		try {
			conn.ws.send(JSON.stringify(request));
		} catch (err) {
			clearTimeout(timer);
			conn.pendingRequests.delete(id);
			reject(new Error(`Failed to send to agent: ${err instanceof Error ? err.message : String(err)}`));
		}
	});
}

// ── Agent Exec API ───────────────────────────────────────────────────────────

const EXEC_START_TIMEOUT = 15_000; // 15s to open exec session

/**
 * Start an exec session on the agent. Sends `exec-start` and waits for
 * `exec-started` or `exec-error`. Returns the agent-generated sessionId.
 */
export function sendAgentExecStart(
	token: string,
	opts: { namespace: string; pod: string; container: string; shell: string; cols: number; rows: number }
): Promise<string> {
	const conn = connections.get(token);
	if (!conn) {
		return Promise.reject(new Error('Agent not connected'));
	}

	const id = crypto.randomUUID();

	const msg: AgentExecStart = {
		id,
		type: 'exec-start',
		...opts
	};

	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			conn.pendingRequests.delete(id);
			reject(new Error('Exec start timeout — agent did not respond'));
		}, EXEC_START_TIMEOUT);

		// Re-use pendingRequests with a wrapper that extracts sessionId
		conn.pendingRequests.set(id, {
			resolve: (response: AgentK8sResponse) => {
				if (response.status === 200) {
					try {
						const body = JSON.parse(response.body);
						resolve(body.sessionId as string);
					} catch {
						reject(new Error('Invalid exec-started response'));
					}
				} else {
					try {
						const body = JSON.parse(response.body);
						reject(new Error(body.error ?? 'Exec start failed'));
					} catch {
						reject(new Error(response.body || 'Exec start failed'));
					}
				}
			},
			reject,
			timer
		});

		try {
			conn.ws.send(JSON.stringify(msg));
		} catch (err) {
			clearTimeout(timer);
			conn.pendingRequests.delete(id);
			reject(new Error(`Failed to send exec-start: ${err instanceof Error ? err.message : String(err)}`));
		}
	});
}

/**
 * Register callbacks for an agent exec session (called after exec-started).
 */
export function registerAgentExecSession(sessionId: string, callbacks: AgentExecCallbacks): void {
	agentExecSessions.set(sessionId, callbacks);

	const pending = pendingAgentExecEvents.get(sessionId);
	if (!pending) return;

	for (const output of pending.outputs) {
		callbacks.onData(output.channel, output.data);
	}

	if (pending.error) {
		callbacks.onError(new Error(pending.error));
	} else if (pending.close) {
		callbacks.onClose(pending.close.code, pending.close.reason);
	}

	pendingAgentExecEvents.delete(sessionId);
}

/**
 * Unregister an agent exec session.
 */
export function unregisterAgentExecSession(sessionId: string): void {
	agentExecSessions.delete(sessionId);
	pendingAgentExecEvents.delete(sessionId);
}

/**
 * Send stdin data to an agent exec session.
 */
export function sendAgentExecStdin(token: string, sessionId: string, data: string): boolean {
	const conn = connections.get(token);
	if (!conn) return false;

	try {
		conn.ws.send(JSON.stringify({ type: 'exec-stdin', sessionId, data }));
		return true;
	} catch {
		return false;
	}
}

/**
 * Send resize event to an agent exec session.
 */
export function sendAgentExecResize(token: string, sessionId: string, cols: number, rows: number): boolean {
	const conn = connections.get(token);
	if (!conn) return false;

	try {
		conn.ws.send(JSON.stringify({ type: 'exec-resize', sessionId, cols, rows }));
		return true;
	} catch {
		return false;
	}
}

/**
 * Close an agent exec session.
 */
export function sendAgentExecClose(token: string, sessionId: string): boolean {
	const conn = connections.get(token);
	if (!conn) return false;

	try {
		conn.ws.send(JSON.stringify({ type: 'exec-close', sessionId }));
		agentExecSessions.delete(sessionId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Send a one-shot command execution request to the agent and resolve with stdout/stderr.
 * The agent runs the command in the container without a TTY.
 */
export function sendAgentExecOneshot(
	token: string,
	opts: {
		namespace: string;
		pod: string;
		container: string;
		command: string[];
		maxBytes?: number;
		timeout?: number;
	}
): Promise<{ stdout: string; stderr: string }> {
	const conn = connections.get(token);
	if (!conn) {
		return Promise.reject(new Error('Agent not connected'));
	}

	const id = crypto.randomUUID();
	const timeoutMs = opts.timeout ?? REQUEST_TIMEOUT;

	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const timer = setTimeout(() => {
			conn.pendingRequests.delete(id);
			reject(new Error(`Agent exec-oneshot timeout after ${timeoutMs}ms`));
		}, timeoutMs + 5_000); // give agent a little extra before we kill the pending request

		conn.pendingRequests.set(id, {
			resolve: (response: AgentK8sResponse) => {
				if (response.status === 200) {
					try {
						const body = JSON.parse(response.body) as { stdout: string; stderr: string };
						resolve(body);
					} catch {
						reject(new Error('Invalid exec-oneshot-result response'));
					}
				} else {
					try {
						const body = JSON.parse(response.body) as { error: string };
						reject(new Error(body.error ?? 'Exec oneshot failed'));
					} catch {
						reject(new Error(response.body || 'Exec oneshot failed'));
					}
				}
			},
			reject,
			timer
		});

		try {
			conn.ws.send(JSON.stringify({
				id,
				type: 'exec-oneshot',
				...opts
			}));
		} catch (err) {
			clearTimeout(timer);
			conn.pendingRequests.delete(id);
			reject(new Error(`Failed to send exec-oneshot: ${err instanceof Error ? err.message : String(err)}`));
		}
	});
}

/**
 * Get list of connected agents (for status display).
 */
export function getConnectedAgents(): Array<{
	clusterId: number;
	connectedAt: Date;
	lastActivityAt: Date;
	pendingRequests: number;
}> {
	const agents: Array<{
		clusterId: number;
		connectedAt: Date;
		lastActivityAt: Date;
		pendingRequests: number;
	}> = [];

	for (const conn of connections.values()) {
		agents.push({
			clusterId: conn.clusterId,
			connectedAt: conn.connectedAt,
			lastActivityAt: conn.lastActivityAt,
			pendingRequests: conn.pendingRequests.size
		});
	}

	return agents;
}

/**
 * Validate an agent token against the database.
 * Returns the cluster ID if valid, null otherwise.
 */
export async function validateAgentToken(token: string): Promise<number | null> {
	try {
		const { findClusterByToken } = await import('$lib/server/queries/clusters');
		const cluster = await findClusterByToken(token);
		return cluster?.id ?? null;
	} catch {
		return null;
	}
}

// ── Periodic ping & stale cleanup ────────────────────────────────────────────

setInterval(() => {
	const now = Date.now();
	for (const [token, conn] of connections) {
		const elapsed = now - conn.lastActivityAt.getTime();

		if (elapsed > STALE_TIMEOUT) {
			console.log(
				`[agent-ws] Cleaning up stale agent for cluster #${conn.clusterId} (${Math.round(elapsed / 1000)}s idle)`
			);
			disconnectAgent(token, 'Stale');
			continue;
		}

		// Send ping (plain text — matches what the agent expects)
		try {
			conn.ws.send('ping');
		} catch {
			disconnectAgent(token, 'Ping failed');
		}
	}
}, PING_INTERVAL);

// ── Register handlers on globalThis for the Vite dev WebSocket plugin ────────
// The Vite plugin runs in the same process but a different module context.
// Registering here lets it call these functions without going through Vite's
// SSR module loader (which is unreliable during raw HTTP upgrade events).
globalThis.__autokubeAgentHandlers = {
	validateAgentToken,
	handleAgentOpen: handleAgentOpen as (ws: unknown) => Promise<void>,
	handleAgentMessage: handleAgentMessage as (ws: unknown, message: string | Buffer) => void,
	handleAgentClose: handleAgentClose as (ws: unknown, code: number, reason: string) => void
};
