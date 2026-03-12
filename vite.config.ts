import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { bunExternals, devAgentWebSocketPlugin } from './config/vite-plugins';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [bunExternals(), devAgentWebSocketPlugin(), tailwindcss(), sveltekit()],
	optimizeDeps: {
		include: ['lucide-svelte']
	},
	resolve: {
		dedupe: [
			'@codemirror/state',
			'@codemirror/view',
			'@codemirror/language',
			'@lezer/common',
			'@lezer/highlight'
		]
	},
	build: {
		target: 'esnext',
		minify: 'esbuild',
		sourcemap: false,
		rollupOptions: {
			external: [/^bun:/]
		}
	},
	ssr: {
		external: [/^bun:/]
	}
});
