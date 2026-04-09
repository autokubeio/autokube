/**
 * Job Manager — tracks active provisioning processes.
 * Uses globalThis for HMR-safe singleton so concurrent connections
 * can check running state without losing references on hot-reload.
 */

export type JobStatus = 'running' | 'completed' | 'failed';

export interface ProvisioningJob {
	clusterId: number;
	status: JobStatus;
	startedAt: Date;
	completedAt?: Date;
	errorMessage?: string;
}

class JobManager {
	private readonly jobs = new Map<number, ProvisioningJob>();

	/** Register a new job as running. */
	register(clusterId: number): void {
		this.jobs.set(clusterId, {
			clusterId,
			status: 'running',
			startedAt: new Date()
		});
	}

	/** Mark a job as successfully completed. */
	complete(clusterId: number): void {
		const job = this.jobs.get(clusterId);
		if (job) {
			job.status = 'completed';
			job.completedAt = new Date();
		}
	}

	/** Mark a job as failed. */
	fail(clusterId: number, message?: string): void {
		const job = this.jobs.get(clusterId);
		if (job) {
			job.status = 'failed';
			job.completedAt = new Date();
			job.errorMessage = message;
		}
	}

	/** Returns true if there is an actively running job for this cluster. */
	isRunning(clusterId: number): boolean {
		return this.jobs.get(clusterId)?.status === 'running';
	}

	/** Returns the job record, or undefined if never registered. */
	get(clusterId: number): ProvisioningJob | undefined {
		return this.jobs.get(clusterId);
	}

	/** Remove a job from memory (e.g. after a TTL cleanup). */
	remove(clusterId: number): void {
		this.jobs.delete(clusterId);
	}
}

// ── HMR-safe singleton ────────────────────────────────────────────────────────

declare const globalThis: typeof global & {
	__autokube_provisioning_jobs?: JobManager;
};

export const jobManager: JobManager =
	globalThis.__autokube_provisioning_jobs ??
	(globalThis.__autokube_provisioning_jobs = new JobManager());
