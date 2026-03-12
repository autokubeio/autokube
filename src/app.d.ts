// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			/** Bun HTTP server instance (for WebSocket upgrades) */
			server: import('bun').Server;
			/** Original Bun Request object */
			request: Request;
		}
	}
}

export {};
