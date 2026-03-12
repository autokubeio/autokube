/**
 * Kubernetes Pod Exec — WebSocket session manager
 *
 * Opens a WebSocket exec connection to the K8s API server and provides
 * helpers to send stdin, receive stdout/stderr, and resize the remote PTY.
 *
 * Uses raw TLS sockets + manual HTTP upgrade (instead of node:https)
 * because Bun's node:https compatibility layer doesn't reliably emit
 * the 'upgrade' event needed for WebSocket connections.
 *
 * K8s exec protocol (v4.channel.k8s.io):
 *   Channel 0 — stdin
 *   Channel 1 — stdout
 *   Channel 2 — stderr
 *   Channel 4 — resize  (JSON: {"Width":cols,"Height":rows})
 *
 * Each message is prefixed with a single byte indicating the channel number.
 *
 * Shell fallback: If the requested shell is unavailable (distroless /
 * scratch-based images), the manager tries alternatives automatically:
 *   /bin/bash → /bin/sh → /bin/ash → sh
 * If none work, it reports "NO_SHELL" so the UI can show a clear message.
 */

import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import {
	buildConnectionConfig,
	type KubeconfigData,
	type BearerTokenConnection,
	type AgentConnection
} from './utils';
import { findCluster } from '$lib/server/queries/clusters';
import {
	sendAgentExecStart,
	registerAgentExecSession,
	unregisterAgentExecSession,
	sendAgentExecStdin,
	sendAgentExecResize,
	sendAgentExecClose,
	sendAgentExecOneshot
} from '$lib/server/services/agent-connection';

// ── Constants ────────────────────────────────────────────────────────────────

/** Error substrings that indicate the shell binary doesn't exist in the container */
const NO_SHELL_PATTERNS = [
	'executable file not found',
	'no such file or directory',
	'not found',
	'OCI runtime exec failed',
	'failed to exec',
	'command terminated with exit code 126',
	'command terminated with exit code 127',
	'shell exited immediately'
];

/** Error substrings that indicate Kubernetes RBAC denied exec access */
const EXEC_FORBIDDEN_PATTERNS = [
	'http/1.1 403 forbidden',
	'http 403',
	'403 forbidden',
	'"code":403',
	'cannot create resource "pods/exec"',
	'is forbidden',
	'forbidden'
];

function isNoShellErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	if (normalized === 'no_shell' || normalized.startsWith('no_shell:')) {
		return true;
	}

	return NO_SHELL_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function formatNoShellError(shellsTried: string[]): string {
	return `NO_SHELL: This container has no shell installed. Common with distroless or scratch-based images.\n\nTried: ${shellsTried.join(', ')}`;
}

function isExecPermissionDenied(message: string): boolean {
	const normalized = message.toLowerCase();
	return EXEC_FORBIDDEN_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function formatExecPermissionError(opts: {
	namespace: string;
	pod: string;
	container: string;
}): string {
	return `Kubernetes denied terminal access to ${opts.namespace}/${opts.pod} (${opts.container}). Grant the cluster credentials or agent ServiceAccount permission to create pods/exec for this pod.`;
}

function normalizeExecErrorMessage(
	message: string,
	opts: { namespace: string; pod: string; container: string }
): string {
	if (isNoShellErrorMessage(message)) {
		return 'NO_SHELL';
	}

	if (isExecPermissionDenied(message)) {
		return formatExecPermissionError(opts);
	}

	return message.trim() || 'Exec failed';
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExecSession {
	id: string;
	clusterId: number;
	podName: string;
	namespace: string;
	container: string;
	shell: string;
	/** Raw TCP socket (upgraded WebSocket) — null for agent-backed sessions */
	socket: import('node:net').Socket | null;
	/** Callback for stdout/stderr data */
	onData?: (channel: number, data: string) => void;
	/** Callback for session close */
	onClose?: (code?: number, reason?: string) => void;
	/** Callback for errors */
	onError?: (err: Error) => void;
	createdAt: number;
	/** If set, this session routes through an agent WebSocket */
	agentToken?: string;
	/** The agent-side session ID */
	agentSessionId?: string;
}

// ── Session Store ────────────────────────────────────────────────────────────

const sessions = new Map<string, ExecSession>();

/** Reap stale sessions that have been idle for > 30 min */
const REAP_INTERVAL = 60_000;
const MAX_AGE = 30 * 60_000;

setInterval(() => {
	const now = Date.now();
	for (const [id, s] of sessions) {
		if (now - s.createdAt > MAX_AGE) {
			destroySession(id);
		}
	}
}, REAP_INTERVAL);

// ── Public API ───────────────────────────────────────────────────────────────

export function getSession(id: string): ExecSession | undefined {
	return sessions.get(id);
}

export function destroySession(id: string): void {
	const s = sessions.get(id);
	if (s) {
		if (s.agentToken && s.agentSessionId) {
			sendAgentExecClose(s.agentToken, s.agentSessionId);
			unregisterAgentExecSession(s.agentSessionId);
		} else if (s.socket) {
			try {
				s.socket.destroy();
			} catch { /* ignore */ }
		}
		sessions.delete(id);
	}
}

/**
 * Open a new exec session for the requested shell.
 *
 * No automatic fallback — if the requested shell is unavailable the function
 * throws with a message starting with "NO_SHELL:" so the UI can show the
 * "No Shell" state rather than silently switching to a different shell.
 */
export async function createExecSession(opts: {
	clusterId: number;
	namespace: string;
	pod: string;
	container: string;
	shell: string;
	cols: number;
	rows: number;
	onData: (channel: number, data: string) => void;
	onClose?: (code?: number, reason?: string) => void;
	onError?: (err: Error) => void;
}): Promise<{ sessionId: string; shell: string }> {
	const cluster = await findCluster(opts.clusterId);
	if (!cluster) throw new Error('Cluster not found');

	let config;
	try {
		config = buildConnectionConfig({ ...cluster, authType: cluster.authType ?? undefined });
	} catch (e) {
		throw new Error(`Failed to build cluster config: ${e instanceof Error ? e.message : 'Unknown'}`);
	}

	if (config.authType === 'agent') {
		return _tryOpenAgentExec(opts, config as AgentConnection);
	}

	const standardConfig = config as KubeconfigData | BearerTokenConnection;

	// Only try the explicitly requested shell — no automatic fallback.
	// If it is missing, surface NO_SHELL so the UI shows the "No Shell" state.
	try {
		const sessionId = await _tryOpenExec(opts, standardConfig);
		return { sessionId, shell: opts.shell };
	} catch (err) {
		const rawMsg = err instanceof Error ? err.message : String(err);
		const msg = normalizeExecErrorMessage(rawMsg, opts);
		if (isNoShellErrorMessage(msg)) {
			throw new Error(formatNoShellError([opts.shell]));
		}
		throw new Error(msg);
	}
}

/**
 * Open an exec session through an AutoKube agent.
 * The agent opens the K8s exec WebSocket locally and relays stdin/stdout/stderr
 * through its persistent WebSocket connection back to the server.
 *
 * No automatic fallback — if the requested shell is unavailable the function
 * throws NO_SHELL so the UI shows the "No Shell" state.
 */
async function _tryOpenAgentExec(
	opts: {
		clusterId: number;
		namespace: string;
		pod: string;
		container: string;
		shell: string;
		cols: number;
		rows: number;
		onData: (channel: number, data: string) => void;
		onClose?: (code?: number, reason?: string) => void;
		onError?: (err: Error) => void;
	},
	config: AgentConnection
): Promise<{ sessionId: string; shell: string }> {
	try {
		// Ask the agent to open a K8s exec WebSocket with the requested shell.
		// No fallback — if the shell is missing, surface NO_SHELL to the UI.
		const agentSessionId = await sendAgentExecStart(config.agentToken, {
			namespace: opts.namespace,
			pod: opts.pod,
			container: opts.container,
			shell: opts.shell,
			cols: opts.cols,
			rows: opts.rows
		});

		// Create a local session that routes through the agent
		const sessionId = randomUUID();

		const session: ExecSession = {
			id: sessionId,
			clusterId: opts.clusterId,
			podName: opts.pod,
			namespace: opts.namespace,
			container: opts.container,
			shell: opts.shell,
			socket: null, // No direct socket — agent-backed
			onData: opts.onData,
			onClose: (code, reason) => {
				opts.onClose?.(code, reason);
				sessions.delete(sessionId);
				unregisterAgentExecSession(agentSessionId);
			},
			onError: opts.onError,
			createdAt: Date.now(),
			agentToken: config.agentToken,
			agentSessionId
		};

		sessions.set(sessionId, session);

		// Register callbacks so agent-connection.ts can relay exec output
		registerAgentExecSession(agentSessionId, {
			onData: (channel, data) => session.onData?.(channel, data),
			onClose: (code, reason) => {
				session.onClose?.(code, reason);
			},
			onError: (err) => {
				session.onError?.(err);
				sessions.delete(sessionId);
			}
		});

		return { sessionId, shell: opts.shell };
	} catch (err) {
		const rawMsg = err instanceof Error ? err.message : String(err);
		const msg = normalizeExecErrorMessage(rawMsg, opts);
		if (isNoShellErrorMessage(msg)) {
			throw new Error(formatNoShellError([opts.shell]));
		}
		throw new Error(msg);
	}
}

/**
 * Try to open a single exec WebSocket connection for a specific shell.
 * Uses raw TLS socket + manual HTTP/1.1 upgrade (reliable in Bun).
 * Returns sessionId on success, throws on failure.
 */
function _tryOpenExec(
	opts: {
		clusterId: number;
		namespace: string;
		pod: string;
		container: string;
		shell: string;
		cols: number;
		rows: number;
		onData: (channel: number, data: string) => void;
		onClose?: (code?: number, reason?: string) => void;
		onError?: (err: Error) => void;
	},
	standardConfig: KubeconfigData | BearerTokenConnection
): Promise<string> {
	const qs = new URLSearchParams({
		stdout: '1',
		stderr: '1',
		stdin: '1',
		tty: '1',
		container: opts.container,
		command: opts.shell
	});

	const execPath =
		`/api/v1/namespaces/${encodeURIComponent(opts.namespace)}` +
		`/pods/${encodeURIComponent(opts.pod)}` +
		`/exec?${qs.toString()}`;

	const sessionId = randomUUID();

	return new Promise<string>((resolve, reject) => {
		const baseUrl = new URL(execPath, standardConfig.server);
		const hostname = baseUrl.hostname;
		const port = parseInt(baseUrl.port) || 443;
		const path = baseUrl.pathname + baseUrl.search;
		const skipTLSVerify =
			standardConfig.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

		let settled = false;

		// Determine if we need TLS (https) or plain TCP (http)
		const isSecure = standardConfig.server.startsWith('https');

		const tlsOptions: tls.ConnectionOptions = {
			host: hostname,
			port,
			rejectUnauthorized: !skipTLSVerify,
			servername: hostname,
			...(standardConfig.ca ? { ca: standardConfig.ca } : {}),
			...('cert' in standardConfig && standardConfig.cert ? { cert: standardConfig.cert } : {}),
			...('key' in standardConfig && standardConfig.key ? { key: standardConfig.key } : {})
		};

		// Connect via TLS or plain TCP
		const socket: net.Socket | tls.TLSSocket = isSecure
			? tls.connect(tlsOptions)
			: net.connect({ host: hostname, port });

		const connectEvent = isSecure ? 'secureConnect' : 'connect';

		// Timeout for the entire upgrade handshake
		const timeout = setTimeout(() => {
			if (!settled) {
				settled = true;
				socket.destroy();
				reject(new Error('Exec connection timed out'));
			}
		}, 15_000);

		socket.once(connectEvent, () => {
			// Build and send the HTTP/1.1 upgrade request manually
			const wsKey = Buffer.from(randomUUID()).toString('base64');
			const headers = [
				`GET ${path} HTTP/1.1`,
				`Host: ${hostname}`,
				'Connection: Upgrade',
				'Upgrade: websocket',
				`Sec-WebSocket-Key: ${wsKey}`,
				'Sec-WebSocket-Version: 13',
				'Sec-WebSocket-Protocol: v4.channel.k8s.io'
			];
			if (standardConfig.token) {
				headers.push(`Authorization: Bearer ${standardConfig.token}`);
			}
			headers.push('', ''); // empty line terminates HTTP headers

			socket.write(headers.join('\r\n'));
		});

		// Parse the HTTP response, then switch to WebSocket framing
		let headerBuf = '';
		let upgraded = false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let frameBuffer: any = Buffer.alloc(0);

		socket.on('data', (chunk: Buffer) => {
			if (!upgraded) {
				// Still reading HTTP response headers
				headerBuf += chunk.toString('binary');
				const headerEnd = headerBuf.indexOf('\r\n\r\n');
				if (headerEnd === -1) return; // incomplete headers, wait for more

				const headerStr = headerBuf.substring(0, headerEnd);
				const firstLine = headerStr.split('\r\n')[0]; // e.g. "HTTP/1.1 101 Switching Protocols"

				if (!firstLine.includes('101')) {
					// Not an upgrade — extract status and body for error
					clearTimeout(timeout);
					if (!settled) {
						settled = true;
						const body = headerBuf.substring(headerEnd + 4).slice(0, 500);
						const errorMessage = normalizeExecErrorMessage(
							`Exec failed: ${firstLine} — ${body}`,
							opts
						);
						socket.destroy();
						reject(new Error(errorMessage));
					}
					return;
				}

				// Successfully upgraded to WebSocket
				upgraded = true;

				// Track early shell failure — K8s sends the error on channel 3
				// *after* the 101 upgrade, so we must wait briefly before resolving.
				let earlyError: string | null = null;

				const session: ExecSession = {
					id: sessionId,
					clusterId: opts.clusterId,
					podName: opts.pod,
					namespace: opts.namespace,
					container: opts.container,
					shell: opts.shell,
					socket,
					onData: opts.onData,
					onClose: (code?: number, reason?: string) => {
						// If we haven't resolved yet, a close means the shell failed
						if (!settled) {
							settled = true;
							clearTimeout(timeout);
							clearTimeout(earlySettleTimer);
							sessions.delete(sessionId);
							socket.destroy();
							reject(new Error(earlyError || `Shell exited immediately (code ${code})`));
							return;
						}
						opts.onClose?.(code, reason);
					},
					onError: (err: Error) => {
						// Capture early errors (e.g. "OCI runtime exec failed")
						earlyError = err.message;
						if (!settled) {
							settled = true;
							clearTimeout(timeout);
							clearTimeout(earlySettleTimer);
							sessions.delete(sessionId);
							socket.destroy();
							reject(err);
							return;
						}
						opts.onError?.(err);
					},
					createdAt: Date.now()
				};

				sessions.set(sessionId, session);

				// Process any remaining data after the HTTP headers as WebSocket frames
				const remaining = Buffer.from(headerBuf.substring(headerEnd + 4), 'binary');
				if (remaining.length > 0) {
					frameBuffer = Buffer.concat([frameBuffer, remaining]);
					frameBuffer = processWebSocketFrames(session, frameBuffer);
				}

				// Send initial resize
				sendResize(sessionId, opts.cols, opts.rows);

				clearTimeout(timeout);

				// Wait a short time for early shell failure before resolving.
				// K8s typically sends the error within ~200ms if the shell doesn't exist.
				const earlySettleTimer = setTimeout(() => {
					if (!settled) {
						settled = true;
						// Restore the original callbacks now that we're past the early window
						session.onClose = opts.onClose;
						session.onError = opts.onError;
						resolve(sessionId);
					}
				}, 500);
			} else {
				// WebSocket mode — process frames
				const session = sessions.get(sessionId);
				if (!session) return;
				frameBuffer = Buffer.concat([frameBuffer, chunk]);
				frameBuffer = processWebSocketFrames(session, frameBuffer);
			}
		});

		socket.on('close', () => {
			clearTimeout(timeout);
			if (!settled) {
				settled = true;
				reject(new Error('Connection closed before upgrade completed'));
			} else {
				const session = sessions.get(sessionId);
				if (session) {
					session.onClose?.();
					sessions.delete(sessionId);
				}
			}
		});

		socket.on('error', (err) => {
			clearTimeout(timeout);
			if (!settled) {
				settled = true;
				reject(new Error(`Exec connection failed: ${err.message}`));
			} else {
				const session = sessions.get(sessionId);
				if (session) {
					session.onError?.(err);
					sessions.delete(sessionId);
				}
			}
		});
	});
}

// ── WebSocket Frame Handling ─────────────────────────────────────────────────

/**
 * Parse WebSocket frames from buffer.
 * Returns remaining unprocessed bytes.
 */
function processWebSocketFrames(session: ExecSession, buffer: Buffer): Buffer {
	while (buffer.length >= 2) {
		// const fin = (buffer[0] & 0x80) !== 0;
		const opcode = buffer[0] & 0x0f;
		const masked = (buffer[1] & 0x80) !== 0;
		let payloadLen = buffer[1] & 0x7f;
		let offset = 2;

		if (payloadLen === 126) {
			if (buffer.length < 4) break;
			payloadLen = buffer.readUInt16BE(2);
			offset = 4;
		} else if (payloadLen === 127) {
			if (buffer.length < 10) break;
			// For practical purposes, read last 4 bytes as 32-bit
			payloadLen = buffer.readUInt32BE(6);
			offset = 10;
		}

		if (masked) offset += 4; // skip mask key (server→client should not be masked)

		if (buffer.length < offset + payloadLen) break; // incomplete frame

		const payload = buffer.subarray(offset, offset + payloadLen);

		if (opcode === 0x01 || opcode === 0x02) {
			// Text or binary frame
			processWebSocketData(session, payload);
		} else if (opcode === 0x08) {
			// Close frame
			session.onClose?.();
			try { session.socket?.destroy(); } catch { /* ignore */ }
			sessions.delete(session.id);
			return Buffer.alloc(0);
		} else if (opcode === 0x09) {
			// Ping — reply with pong
			if (session.socket) {
				sendWebSocketFrame(session.socket, 0x0a, payload);
			}
		}
		// ignore pong (0x0a) and other opcodes

		buffer = buffer.subarray(offset + payloadLen);
	}
	return buffer;
}

/**
 * Process K8s exec protocol data (channel byte + payload).
 */
function processWebSocketData(session: ExecSession, data: Buffer): void {
	if (data.length < 1) return;
	const channel = data[0];
	const payload = data.subarray(1).toString('utf8');

	if (channel === 1 || channel === 2) {
		// stdout (1) or stderr (2)
		if (channel === 2 && isNoShellErrorMessage(payload)) {
			session.onError?.(new Error(formatNoShellError([session.shell])));
			return;
		}

		session.onData?.(channel, payload);
	} else if (channel === 3) {
		// status channel — usually session close info
		try {
			const status = JSON.parse(payload);
			if (status.status === 'Failure') {
				session.onError?.(
					new Error(
						normalizeExecErrorMessage(status.message || 'Exec failed', {
							namespace: session.namespace,
							pod: session.podName,
							container: session.container
						})
					)
				);
				// Don't call onClose after a Failure — onError already handles cleanup
				return;
			}
			session.onClose?.(status.code);
		} catch {
			session.onClose?.();
		}
	}
}

// ── Send Helpers ─────────────────────────────────────────────────────────────

/**
 * Send stdin data to a session.
 */
export function sendStdin(sessionId: string, data: string): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;

	// Agent-backed session: relay through agent WS
	if (session.agentToken && session.agentSessionId) {
		return sendAgentExecStdin(session.agentToken, session.agentSessionId, data);
	}

	if (!session.socket || session.socket.destroyed) return false;

	// Channel 0 = stdin, prepend channel byte
	const payload = Buffer.alloc(1 + Buffer.byteLength(data, 'utf8'));
	payload[0] = 0; // stdin channel
	payload.write(data, 1, 'utf8');

	sendWebSocketFrame(session.socket, 0x02, payload); // binary frame
	return true;
}

/**
 * Send resize event to a session.
 */
export function sendResize(sessionId: string, cols: number, rows: number): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;

	// Agent-backed session: relay through agent WS
	if (session.agentToken && session.agentSessionId) {
		return sendAgentExecResize(session.agentToken, session.agentSessionId, cols, rows);
	}

	if (!session.socket || session.socket.destroyed) return false;

	// Channel 4 = resize
	const resizeJson = JSON.stringify({ Width: cols, Height: rows });
	const payload = Buffer.alloc(1 + Buffer.byteLength(resizeJson, 'utf8'));
	payload[0] = 4; // resize channel
	payload.write(resizeJson, 1, 'utf8');

	sendWebSocketFrame(session.socket, 0x02, payload); // binary frame
	return true;
}

/**
 * Build and send a WebSocket frame (client→server, masked).
 */
function sendWebSocketFrame(socket: import('node:net').Socket, opcode: number, payload: Buffer): void {
	if (socket.destroyed) return;

	const len = payload.length;
	let header: Buffer;

	// Client-to-server frames MUST be masked
	const maskKey = Buffer.alloc(4);
	for (let i = 0; i < 4; i++) maskKey[i] = Math.floor(Math.random() * 256);

	if (len < 126) {
		header = Buffer.alloc(6);
		header[0] = 0x80 | opcode; // FIN + opcode
		header[1] = 0x80 | len; // MASK + length
		maskKey.copy(header, 2);
	} else if (len < 65536) {
		header = Buffer.alloc(8);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(len, 2);
		maskKey.copy(header, 4);
	} else {
		header = Buffer.alloc(14);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 127;
		header.writeUInt32BE(0, 2); // high 32 bits
		header.writeUInt32BE(len, 6); // low 32 bits
		maskKey.copy(header, 10);
	}

	// Mask payload
	const masked = Buffer.alloc(len);
	for (let i = 0; i < len; i++) {
		masked[i] = payload[i] ^ maskKey[i & 3];
	}

	socket.write(Buffer.concat([header, masked]));
}

// ── One-shot Command Execution ───────────────────────────────────────────────

/**
 * Run a command in a container and return the collected stdout/stderr.
 * Uses the K8s exec WebSocket API with tty=false, stdin=false.
 * NOTE: Not supported for agent-based clusters.
 *
 * @param opts.command - Command and its arguments as an array, e.g. ['find', '/', '-maxdepth', '1']
 * @param opts.maxBytes - Max bytes to collect before aborting (default: 4 MB)
 * @param opts.timeout  - Timeout in milliseconds (default: 30 s)
 */
export async function runPodCommand(opts: {
	clusterId: number;
	namespace: string;
	pod: string;
	container: string;
	command: string[];
	maxBytes?: number;
	timeout?: number;
}): Promise<{ stdout: string; stderr: string }> {
	const cluster = await findCluster(opts.clusterId);
	if (!cluster) throw new Error('Cluster not found');

	let config;
	try {
		config = buildConnectionConfig({ ...cluster, authType: cluster.authType ?? undefined });
	} catch (e) {
		throw new Error(`Failed to build cluster config: ${e instanceof Error ? e.message : 'Unknown'}`);
	}

	if (config.authType === 'agent') {
		const agentCfg = config as AgentConnection;
		return sendAgentExecOneshot(agentCfg.agentToken, {
			namespace: opts.namespace,
			pod: opts.pod,
			container: opts.container,
			command: opts.command,
			maxBytes: opts.maxBytes,
			timeout: opts.timeout
		});
	}

	if (opts.command.length === 0) throw new Error('command array must not be empty');

	const standardConfig = config as KubeconfigData | BearerTokenConnection;

	const qs = new URLSearchParams({
		stdout: '1',
		stderr: '1',
		stdin: '0',
		tty: '0',
		container: opts.container
	});
	for (const arg of opts.command) qs.append('command', arg);

	const execPath =
		`/api/v1/namespaces/${encodeURIComponent(opts.namespace)}` +
		`/pods/${encodeURIComponent(opts.pod)}` +
		`/exec?${qs.toString()}`;

	const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
	const timeoutMs = opts.timeout ?? 30_000;

	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const baseUrl = new URL(execPath, standardConfig.server);
		const hostname = baseUrl.hostname;
		const port = parseInt(baseUrl.port) || (standardConfig.server.startsWith('https') ? 443 : 80);
		const path = baseUrl.pathname + baseUrl.search;
		const isSecure = standardConfig.server.startsWith('https');
		const skipTLSVerify =
			standardConfig.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

		const tlsOptions: tls.ConnectionOptions = {
			host: hostname, port,
			rejectUnauthorized: !skipTLSVerify,
			servername: hostname,
			...(standardConfig.ca ? { ca: standardConfig.ca } : {}),
			...('cert' in standardConfig && standardConfig.cert ? { cert: standardConfig.cert } : {}),
			...('key' in standardConfig && standardConfig.key ? { key: standardConfig.key } : {})
		};

		const socket: net.Socket | tls.TLSSocket = isSecure
			? tls.connect(tlsOptions)
			: net.connect({ host: hostname, port });

		const connectEvent = isSecure ? 'secureConnect' : 'connect';
		let settled = false;
		let stdout = '';
		let stderr = '';
		let totalBytes = 0;

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				socket.destroy();
				reject(new Error('Command timed out'));
			}
		}, timeoutMs);

		function done(err?: Error) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try { socket.destroy(); } catch { /* ignore */ }
			if (err) reject(err);
			else resolve({ stdout, stderr });
		}

		socket.once(connectEvent, () => {
			const wsKey = Buffer.from(randomUUID()).toString('base64');
			const headers = [
				`GET ${path} HTTP/1.1`,
				`Host: ${hostname}`,
				'Connection: Upgrade',
				'Upgrade: websocket',
				`Sec-WebSocket-Key: ${wsKey}`,
				'Sec-WebSocket-Version: 13',
				'Sec-WebSocket-Protocol: v4.channel.k8s.io'
			];
			if (standardConfig.token) headers.push(`Authorization: Bearer ${standardConfig.token}`);
			headers.push('', '');
			socket.write(headers.join('\r\n'));
		});

		let headerBuf = '';
		let upgraded = false;
		let frameBuffer: Buffer = Buffer.alloc(0);

		socket.on('data', (chunk: Buffer) => {
			if (!upgraded) {
				headerBuf += chunk.toString('binary');
				const headerEnd = headerBuf.indexOf('\r\n\r\n');
				if (headerEnd === -1) return;

				const firstLine = headerBuf.substring(0, headerBuf.indexOf('\r\n'));
				if (!firstLine.includes('101')) {
					const body = headerBuf.substring(headerEnd + 4).slice(0, 500);
					done(new Error(`Exec failed: ${firstLine} — ${body}`));
					return;
				}

				upgraded = true;
				const remaining = Buffer.from(headerBuf.substring(headerEnd + 4), 'binary');
				if (remaining.length > 0) {
					frameBuffer = Buffer.concat([frameBuffer, remaining]);
					frameBuffer = _processOneshotFrames();
				}
			} else {
				frameBuffer = Buffer.concat([frameBuffer, chunk]);
				frameBuffer = _processOneshotFrames();
			}
		});

		function _processOneshotFrames(): Buffer {
			let buf = frameBuffer;
			while (buf.length >= 2) {
				const opcode = buf[0] & 0x0f;
				const masked = (buf[1] & 0x80) !== 0;
				let payloadLen = buf[1] & 0x7f;
				let offset = 2;

				if (payloadLen === 126) {
					if (buf.length < 4) break;
					payloadLen = buf.readUInt16BE(2); offset = 4;
				} else if (payloadLen === 127) {
					if (buf.length < 10) break;
					payloadLen = buf.readUInt32BE(6); offset = 10;
				}
				if (masked) offset += 4;
				if (buf.length < offset + payloadLen) break;

				const payload = buf.subarray(offset, offset + payloadLen);

				if (opcode === 0x01 || opcode === 0x02) {
					if (payload.length >= 1) {
						const channel = payload[0];
						const text = payload.subarray(1).toString('utf8');
						if (channel === 1) {
							stdout += text;
							totalBytes += text.length;
						} else if (channel === 2) {
							stderr += text;
							totalBytes += text.length;
						} else if (channel === 3) {
							// status message — check for failure
							try {
								const status = JSON.parse(text);
								if (status.status === 'Failure') {
									done(new Error(status.message || 'Command failed'));
									return Buffer.alloc(0);
								}
							} catch { /* ignore parse errors */ }
						}
						if (totalBytes > maxBytes) {
							done(new Error('Output exceeded size limit'));
							return Buffer.alloc(0);
						}
					}
				} else if (opcode === 0x08) {
					// Close frame
					done();
					return Buffer.alloc(0);
				}

				buf = buf.subarray(offset + payloadLen);
			}
			return buf;
		}

		socket.on('close', () => done());
		socket.on('error', (err) => done(err));
	});
}
