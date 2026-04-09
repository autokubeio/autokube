/**
 * Terraform runner — wraps Bun.spawn() to execute terraform commands inside
 * a given workspace and stream stdout/stderr lines to a callback.
 */

import { join } from 'node:path';

export interface TerraformOutputs {
	api_endpoint: string;
	master_init_ip: string;
	master_ips: string[];
	worker_ips: string[];
	load_balancer_ip: string | null;
}

export type LineCallback = (line: string, isError: boolean) => void | Promise<void>;

/**
 * Resolves the terraform binary path.
 * Prefers the bundled binary in data/bin/, falls back to PATH.
 */
function resolveTerraformBin(): string {
	// In production the binary lives next to the app; in dev it can be overridden
	const candidates = [
		// Bundled binary relative to CWD (works when Bun runs from project root)
		join(process.cwd(), 'data', 'bin', 'terraform'),
		// Allow override via env
		Bun.env.TERRAFORM_BIN ?? ''
	].filter(Boolean);

	for (const p of candidates) {
		try {
			if (Bun.file(p).size) return p;
		} catch {
			// not found — try next
		}
	}

	// Fall back to system terraform on PATH
	return 'terraform';
}

/**
 * Run a terraform subcommand inside `workspace`, streaming every output line
 * to `onLine`. Rejects if the process exits with a non-zero code.
 */
export async function runTerraform(
	workspace: string,
	args: string[],
	onLine: LineCallback
): Promise<void> {
	const bin = resolveTerraformBin();
	const env = {
		...process.env,
		TF_IN_AUTOMATION: '1',
		TF_CLI_ARGS: '-no-color',
		CHECKPOINT_DISABLE: '1'
	};

	const proc = Bun.spawn([bin, ...args], {
		cwd: workspace,
		env,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	// Stream stdout
	const stdoutReader = proc.stdout.getReader();
	const stderrReader = proc.stderr.getReader();
	const decoder = new TextDecoder();

	async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, isErr: boolean) {
		let buf = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				if (buf.trim()) await onLine(buf.trim(), isErr);
				break;
			}
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop() ?? '';
			for (const line of lines) {
				if (line.trim()) await onLine(line, isErr);
			}
		}
	}

	await Promise.all([drain(stdoutReader, false), drain(stderrReader, true)]);

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`terraform ${args[0]} exited with code ${exitCode}`);
	}
}

/**
 * Run `terraform import <address> <id>` to bring an existing remote resource
 * under Terraform state management. Silently succeeds if the resource is
 * already in state (terraform exits 0). Throws on unexpected errors.
 */
export async function terraformImport(
	workspace: string,
	address: string,
	id: string
): Promise<void> {
	const bin = resolveTerraformBin();
	const env = {
		...process.env,
		TF_IN_AUTOMATION: '1',
		TF_CLI_ARGS: '-no-color',
		CHECKPOINT_DISABLE: '1'
	};

	const proc = Bun.spawn([bin, 'import', address, id], {
		cwd: workspace,
		env,
		stdout: 'pipe',
		stderr: 'pipe'
	});

	// Drain both pipes concurrently before reading exitCode to avoid deadlock
	const [, errText] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		// "already managed" / "already exists" → resource is tracked — not an error
		if (errText.includes('already managed') || errText.includes('already exists')) return;
		throw new Error(`terraform import ${address} failed (${exitCode}): ${errText.trim()}`);
	}
}

/**
 * Execute `terraform output -json` in the workspace and parse the result
 * into a typed `TerraformOutputs` object.
 */
export async function getTerraformOutputs(workspace: string): Promise<TerraformOutputs> {
	const bin = resolveTerraformBin();

	const proc = Bun.spawn([bin, 'output', '-json'], {
		cwd: workspace,
		env: { ...process.env, CHECKPOINT_DISABLE: '1' },
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const raw = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const errText = await new Response(proc.stderr).text();
		throw new Error(`terraform output failed (${exitCode}): ${errText.trim()}`);
	}

	const parsed = JSON.parse(raw);

	function val<T>(key: string, fallback: T): T {
		return parsed[key]?.value ?? fallback;
	}

	return {
		api_endpoint: val<string>('api_endpoint', ''),
		master_init_ip: val<string>('master_init_ip', ''),
		master_ips: val<string[]>('master_ips', []),
		worker_ips: val<string[]>('worker_ips', []),
		load_balancer_ip: val<string | null>('load_balancer_ip', null)
	};
}
