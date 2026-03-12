import { type Plugin, type ViteDevServer } from 'vite';

export function bunExternals(): Plugin {
	return {
		name: 'bun-externals',
		enforce: 'pre',
		resolveId(source) {
			if (source.startsWith('bun:')) {
				return { id: source, external: true };
			}
			return null;
		}
	};
}

// Extend globalThis for HMR-safe dev WebSocket server
declare global {
	// eslint-disable-next-line no-var
	var __autokubeDevWsServer: import('bun').Server | undefined;
}

/**
 * Vite dev-only plugin: agent WebSocket server.
 *
 * PROBLEM: In production, svelte-adapter-bun's `platform.server.upgrade()` works
 * perfectly.  In dev (Vite on Bun), however, Bun's `node:http` compatibility
 * layer provides a non-functional socket in the `upgrade` event — any data
 * written via `socket.write()` is silently lost.  Neither the `ws` npm library,
 * raw WebSocket framing, Vite proxy, nor TCP relay approaches can work through
 * this broken socket.
 *
 * SOLUTION: Start a separate Bun-native HTTP/WebSocket server on port 15173.
 * A discovery endpoint (`GET /api/agent/discover`) on the Vite dev server
 * (port 5173) tells the agent which WebSocket URL to use.  The agent connects
 * to `ws://localhost:15173/api/agent/ws?token=…` automatically.  This uses
 * Bun's fully-functional native WebSocket — no compat layer involved.
 *
 * Dev-install usage (same port as always):
 *   ./dev-install.sh --local http://localhost:5173 <token>
 */
export function devAgentWebSocketPlugin(): Plugin {
	const AGENT_WS_PORT = 15_173;

	return {
		name: 'dev-agent-ws',
		apply: 'serve',

		configureServer(server: ViteDevServer) {
			type AgentHandlers = NonNullable<typeof globalThis.__autokubeAgentHandlers>;

			// ── Poll for handlers registered by agent-connection.ts ─────────
			const getHandlers = async (): Promise<AgentHandlers | null> => {
				for (let i = 0; i < 50; i++) {
					const h = globalThis.__autokubeAgentHandlers;
					if (h) return h;
					await new Promise((r) => setTimeout(r, 100));
				}
				console.error('[dev-agent-ws] handlers not available after 5 s');
				return null;
			};

			// ── Warm SvelteKit so agent-connection.ts loads ──────────────────
			server.httpServer?.once('listening', () => {
				const addr = server.httpServer!.address() as import('node:net').AddressInfo;
				fetch(`http://localhost:${addr.port}/api/agent/status`).catch(() => {});
			});

			// ── Start Bun-native WebSocket server ────────────────────────────
			// Stored on globalThis so Vite HMR restarts don't leak servers.
			if (globalThis.__autokubeDevWsServer) {
				try {
					globalThis.__autokubeDevWsServer.stop();
				} catch {
					/* ignore */
				}
			}

			const bunServer = Bun.serve({
				port: AGENT_WS_PORT,
				fetch(req, srv) {
					const url = new URL(req.url);

					// Agent WebSocket upgrade
					if (url.pathname === '/api/agent/ws') {
						const token = url.searchParams.get('token');
						if (!token) {
							return new Response('Missing token', { status: 400 });
						}
						const ok = srv.upgrade(req, { data: { token, clusterId: 0 } });
						if (!ok) {
							return new Response('Upgrade failed', { status: 500 });
						}
						return undefined;
					}

					// Status endpoint for health-checks
					if (url.pathname === '/api/agent/status') {
						const agents = globalThis.__autokubeAgentHandlers ? 'ready' : 'loading';
						return Response.json({ status: agents, dev: true });
					}

					return new Response('Not found', { status: 404 });
				},
				websocket: {
					async open(ws) {
						const handlers = await getHandlers();
						if (!handlers) {
							ws.close(1013, 'Server not ready');
							return;
						}
						const token = (ws.data as { token: string }).token;
						const clusterId = await handlers.validateAgentToken(token);
						if (clusterId === null) {
							console.warn('[dev-agent-ws] Invalid token rejected');
							ws.close(1008, 'Invalid token');
							return;
						}
						(ws.data as { token: string; clusterId: number }).clusterId = clusterId;
						handlers.handleAgentOpen(ws as never);
						console.log(`[dev-agent-ws] Agent connected for cluster #${clusterId}`);
					},
					message(ws, message) {
						const handlers = globalThis.__autokubeAgentHandlers;
						if (!handlers) return;
						const text =
							typeof message === 'string' ? message : Buffer.from(message).toString();
						handlers.handleAgentMessage(ws as never, text);
					},
					close(ws, code, reason) {
						const handlers = globalThis.__autokubeAgentHandlers;
						if (!handlers) return;
						handlers.handleAgentClose(ws as never, code, reason);
					}
				}
			});

			globalThis.__autokubeDevWsServer = bunServer;
			console.log(
				`[dev-agent-ws] Bun WS server on port ${bunServer.port} — ` +
					`agent URL: ws://localhost:${bunServer.port}/api/agent/ws`
			);

			// ── Discovery middleware on port 5173 ─────────────────────────────
			// The agent fetches GET /api/agent/discover on the main Vite port
			// before connecting via WebSocket.  This tells it where to connect.
			server.middlewares.use('/api/agent/discover', (_req, res) => {
				res.setHeader('Content-Type', 'application/json');
				res.end(
					JSON.stringify({
						wsUrl: `ws://localhost:${bunServer.port}/api/agent/ws`
					})
				);
			});
		}
	};
}
