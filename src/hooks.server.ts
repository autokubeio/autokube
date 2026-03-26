import { initializeDatabase } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { getSession } from '$lib/server/queries/sessions';
import { startNotificationMonitor } from '$lib/server/services/notification-monitor';
import { initScanScheduler } from '$lib/server/services/scan-scheduler';
import {
	validateAgentToken,
	handleAgentOpen,
	handleAgentMessage,
	handleAgentClose,
	type AgentWsData
} from '$lib/server/services/agent-connection';

// Run migrations and seed on server start
await initializeDatabase();

// Start background notification monitor (cluster health, license expiry)
startNotificationMonitor();

// Start background scan scheduler (cron-based image vulnerability scans)
initScanScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const { request } = event;

	// ── WebSocket upgrade for agent connections ──────────────────────────────
	if (
		pathname === '/api/agent/ws' &&
		request.headers.get('connection')?.toLowerCase().includes('upgrade') &&
		request.headers.get('upgrade')?.toLowerCase() === 'websocket'
	) {
		// In production (svelte-adapter-bun), upgrade via Bun platform.
		// In dev mode, the Vite plugin handles the upgrade — we should never
		// reach here in dev, but if we do, return 404 so we don't return 500
		// and kill the socket that the Vite plugin is upgrading.
		const platform = event.platform as App.Platform | undefined;
		if (!platform?.server) {
			// Dev mode — skip, handled by devAgentWebSocketPlugin
			return new Response(null, { status: 404 });
		}

		const token = event.url.searchParams.get('token');
		if (!token) {
			return new Response(JSON.stringify({ error: 'Missing token' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const clusterId = await validateAgentToken(token);
		if (clusterId === null) {
			return new Response(JSON.stringify({ error: 'Invalid agent token' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		if (platform.request) {
			const success = platform.server.upgrade<AgentWsData>(platform.request, {
				data: { token, clusterId }
			});
			if (success) {
				return new Response(null, { status: 101 });
			}
		}

		return new Response('WebSocket upgrade failed', { status: 500 });
	}

	// ── Auth handling ────────────────────────────────────────────────────────

	// Load auth configuration
	const authConfig = await loadAuthConfig();
	const authEnabled = authConfig?.authEnabled ?? false;

	// If auth is not enabled, allow all requests
	if (!authEnabled) {
		return resolve(event);
	}

	// Allow access to auth-related endpoints and public assets
	const publicPaths = [
		'/login',
		'/api/auth/login',
		'/api/auth/setup',
		'/api/auth/mfa/validate',
		'/api/auth/oidc',
		'/api/auth-settings',
		'/api/agent/status',
		'/api/sso/providers'
	];
	const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

	if (isPublicPath || pathname.startsWith('/_app/') || pathname.startsWith('/favicon')) {
		return resolve(event);
	}

	// Check for valid session
	const sessionId = event.cookies.get('session_id');
	if (!sessionId) {
		// Redirect to login if accessing protected route
		if (!pathname.startsWith('/api/')) {
			return Response.redirect(new URL('/login', event.url.origin), 302);
		}
		// For API routes, return 401
		return new Response(JSON.stringify({ error: 'Not authenticated' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Validate session
	const session = await getSession(sessionId);
	if (!session || new Date(session.expiresAt) < new Date()) {
		event.cookies.delete('session_id', { path: '/' });

		if (!pathname.startsWith('/api/')) {
			return Response.redirect(new URL('/login', event.url.origin), 302);
		}
		return new Response(JSON.stringify({ error: 'Session expired' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return resolve(event);
};

// ── Bun WebSocket handler (exported for svelte-adapter-bun) ──────────────────

export const websocket: Bun.WebSocketHandler<AgentWsData> = {
	async open(ws) {
		await handleAgentOpen(ws);
	},
	message(ws, message) {
		handleAgentMessage(ws, message);
	},
	close(ws, code, reason) {
		handleAgentClose(ws, code, typeof reason === 'string' ? reason : '');
	}
};
