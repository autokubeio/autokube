/**
 * Workspace manager — creates and destroys isolated temporary directories
 * for each Terraform provisioning job.
 *
 * Layout:
 *   /tmp/autokube/provisioning/<clusterId>/
 *     ├── main.tf
 *     ├── variables.tf
 *     ├── outputs.tf
 *     ├── scripts/
 *     │   ├── install-k3s-init.sh
 *     │   ├── install-k3s-join.sh
 *     │   └── install-k3s-worker.sh
 *     ├── terraform.tfvars.json
 *     └── .terraform/   (created by terraform init)
 */

import { mkdir, rm, cp, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const BASE_DIR = '/tmp/autokube/provisioning';

/** Returns the absolute path to the workspace for a given cluster ID. */
export function workspacePath(clusterId: number): string {
	return join(BASE_DIR, String(clusterId));
}

/**
 * Create (or reuse) a workspace directory for a provisioning job.
 *
 * If the workspace already exists AND contains a `terraform.tfstate` file
 * (from a previous partially-successful run), we keep the state and only
 * overwrite the template `.tf` / script files.  This lets Terraform reconcile
 * already-created cloud resources on retry instead of failing with 409s.
 *
 * If no state file is present we do a clean recreation.
 *
 * Returns the absolute workspace path.
 */
export async function createWorkspace(clusterId: number, templatesDir: string): Promise<string> {
	const ws = workspacePath(clusterId);
	const stateFile = join(ws, 'terraform.tfstate');
	const hasState = existsSync(stateFile);

	if (existsSync(ws) && !hasState) {
		// No useful state — start clean
		await rm(ws, { recursive: true, force: true });
	}

	await mkdir(ws, { recursive: true });

	// Copy provider templates into workspace.
	// When state exists we only want to update .tf files and scripts, NOT
	// overwrite terraform.tfstate or the .terraform provider cache.
	if (hasState) {
		await copyTemplatesPreservingState(templatesDir, ws);
	} else {
		await cp(templatesDir, ws, { recursive: true });
	}

	return ws;
}

/**
 * Recursively copy files from src to dst, skipping anything that looks like
 * Terraform runtime state (`*.tfstate`, `.terraform/`).
 */
async function copyTemplatesPreservingState(src: string, dst: string): Promise<void> {
	const entries = await readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = join(src, entry.name);
		const dstPath = join(dst, entry.name);
		// Never overwrite state or provider cache
		if (entry.name === 'terraform.tfstate' || entry.name === '.terraform' || entry.name === 'terraform.tfstate.backup') {
			continue;
		}
		if (entry.isDirectory()) {
			await mkdir(dstPath, { recursive: true });
			await copyTemplatesPreservingState(srcPath, dstPath);
		} else {
			await cp(srcPath, dstPath, { force: true });
		}
	}
}

/**
 * Write the `terraform.tfvars.json` file into the workspace.
 */
export async function writeTfvars(workspace: string, vars: Record<string, unknown>): Promise<void> {
	const filePath = join(workspace, 'terraform.tfvars.json');
	await writeFile(filePath, JSON.stringify(vars, null, 2), 'utf-8');
}

/**
 * Remove the workspace directory and everything inside it.
 * Safe to call even if the directory does not exist.
 */
export async function cleanupWorkspace(workspace: string): Promise<void> {
	if (existsSync(workspace)) {
		await rm(workspace, { recursive: true, force: true });
	}
}
