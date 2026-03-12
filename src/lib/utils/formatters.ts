/**
 * Formatting helpers for Kubernetes data
 * Client-side formatters that work with raw data from API
 */

/**
 * Format CPU from raw Kubernetes values
 * @param cpuString - Raw CPU value (e.g., "123456n", "123m")
 * @returns Formatted CPU in millicores (e.g., "123m") or "–"
 *
 * @example
 * formatCpu("123456n") // "123m"
 * formatCpu("50m")     // "50m"
 * formatCpu("0")       // "–"
 */
export function formatCpu(cpuString: string): string {
	if (!cpuString || cpuString === '–' || cpuString === '0') return '–';

	// Already in millicores (e.g., "123m")
	if (cpuString.endsWith('m')) {
		return cpuString;
	}

	// In nanocores (e.g., "123456n")
	if (cpuString.endsWith('n')) {
		const nanocores = parseInt(cpuString.slice(0, -1));
		if (isNaN(nanocores)) return cpuString;
		const millicores = Math.round(nanocores / 1000000);
		return `${millicores}m`;
	}

	// In cores (e.g., "0.5" or "2")
	const cores = parseFloat(cpuString);
	if (!isNaN(cores)) {
		const millicores = Math.round(cores * 1000);
		return `${millicores}m`;
	}

	// Unknown format, return as-is
	return cpuString;
}

/**
 * Format memory from raw Kubernetes values
 * @param memoryString - Raw memory value (e.g., "123456Ki", "120Mi", "1Gi")
 * @returns Formatted memory in Mi (e.g., "120Mi") or "–"
 *
 * @example
 * formatMemory("123456Ki") // "120Mi"
 * formatMemory("256Mi")    // "256Mi"
 * formatMemory("2Gi")      // "2048Mi"
 * formatMemory("0")        // "–"
 */
export function formatMemory(memoryString: string): string {
	if (!memoryString || memoryString === '–' || memoryString === '0') return '–';

	// Already in Mi (e.g., "123Mi")
	if (memoryString.endsWith('Mi')) {
		return memoryString;
	}

	// In Ki (e.g., "123456Ki")
	if (memoryString.endsWith('Ki')) {
		const kilobytes = parseInt(memoryString.slice(0, -2));
		if (isNaN(kilobytes)) return memoryString;
		const megabytes = Math.round(kilobytes / 1024);
		return `${megabytes}Mi`;
	}

	// In Gi (e.g., "2Gi")
	if (memoryString.endsWith('Gi')) {
		const gigabytes = parseInt(memoryString.slice(0, -2));
		if (isNaN(gigabytes)) return memoryString;
		const megabytes = gigabytes * 1024;
		return `${megabytes}Mi`;
	}

	// In bytes (e.g., "123456789")
	const bytes = parseInt(memoryString);
	if (!isNaN(bytes)) {
		const megabytes = Math.round(bytes / (1024 * 1024));
		return `${megabytes}Mi`;
	}

	// Unknown format, return as-is
	return memoryString;
}

/**
 * Parse CPU string to millicores number for sorting
 * @param cpuString - Formatted CPU value (e.g., "123m", "–")
 * @returns Number of millicores or 0
 */
export function parseCpu(cpuString: string): number {
	if (!cpuString || cpuString === '–' || cpuString === '0') return 0;

	// In millicores (e.g., "123m")
	if (cpuString.endsWith('m')) {
		const millicores = parseInt(cpuString.slice(0, -1));
		return isNaN(millicores) ? 0 : millicores;
	}

	// In nanocores (e.g., "123456n")
	if (cpuString.endsWith('n')) {
		const nanocores = parseInt(cpuString.slice(0, -1));
		return isNaN(nanocores) ? 0 : Math.round(nanocores / 1000000);
	}

	// In cores (e.g., "0.5" or "2")
	const cores = parseFloat(cpuString);
	return isNaN(cores) ? 0 : Math.round(cores * 1000);
}

/**
 * Parse memory string to Mi number for sorting
 * @param memoryString - Formatted memory value (e.g., "256Mi", "–")
 * @returns Number of Mi or 0
 */
export function parseMemory(memoryString: string): number {
	if (!memoryString || memoryString === '–' || memoryString === '0') return 0;

	// In Mi (e.g., "123Mi")
	if (memoryString.endsWith('Mi')) {
		const megabytes = parseInt(memoryString.slice(0, -2));
		return isNaN(megabytes) ? 0 : megabytes;
	}

	// In Ki (e.g., "123456Ki")
	if (memoryString.endsWith('Ki')) {
		const kilobytes = parseInt(memoryString.slice(0, -2));
		return isNaN(kilobytes) ? 0 : Math.round(kilobytes / 1024);
	}

	// In Gi (e.g., "2Gi")
	if (memoryString.endsWith('Gi')) {
		const gigabytes = parseInt(memoryString.slice(0, -2));
		return isNaN(gigabytes) ? 0 : gigabytes * 1024;
	}

	// In bytes (e.g., "123456789")
	const bytes = parseInt(memoryString);
	return isNaN(bytes) ? 0 : Math.round(bytes / (1024 * 1024));
}

/**
 * Calculate age from ISO timestamp
 * @param createdAt - ISO timestamp string
 * @returns Formatted age (e.g., "5d", "2h", "30m", "45s")
 *
 * @example
 * calculateAge("2024-01-01T00:00:00Z") // "25d"
 * calculateAge("2024-01-25T22:00:00Z") // "2h"
 */
export function calculateAge(createdAt: string): string {
	const created = new Date(createdAt);
	const now = new Date();
	const diffMs = now.getTime() - created.getTime();

	if (diffMs < 0) return '0s'; // Future date

	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	if (diffDay > 0) return `${diffDay}d`;
	if (diffHr > 0) return `${diffHr}h`;
	if (diffMin > 0) return `${diffMin}m`;
	return `${diffSec}s`;
}

/**
 * Format bytes to human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted bytes (e.g., "1.2GB", "256KB")
 *
 * @example
 * formatBytes(1234567890) // "1.15GB"
 * formatBytes(1234)       // "1.21KB"
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0B';
	if (bytes < 0) return '–';

	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	if (i === 0) return `${bytes}B`;

	return `${(bytes / Math.pow(k, i)).toFixed(2)}${sizes[i]}`;
}

/**
 * Format percentage value
 * @param value - Percentage value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage (e.g., "45.2%")
 *
 * @example
 * formatPercentage(45.678)    // "45.7%"
 * formatPercentage(45.678, 2) // "45.68%"
 */
export function formatPercentage(value: number, decimals: number = 1): string {
	if (isNaN(value)) return '–';
	return `${value.toFixed(decimals)}%`;
}

/**
 * Format an ISO date string as DD.MM.YYYY HH:MM:SS
 *
 * @example
 * formatCreatedAt('2026-01-11T10:02:08Z') // "11.01.2026 10:02:08"
 */
export function formatCreatedAt(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Format CPU millicores to human-readable capacity string
 * @param millis - CPU in millicores
 * @returns Formatted CPU (e.g., "2.5 cores", "500m")
 *
 * @example
 * formatCpuCapacity(2500) // "2.5 cores"
 * formatCpuCapacity(500)  // "500m"
 */
export function formatCpuCapacity(millis: number): string {
	if (millis >= 1000) return `${(millis / 1000).toFixed(1)} cores`;
	return `${Math.round(millis)}m`;
}

/**
 * Format bytes to human-readable memory capacity using binary units (Mi/Gi)
 * @param bytes - Memory in bytes
 * @returns Formatted memory (e.g., "8.0 Gi", "512 Mi")
 *
 * @example
 * formatMemCapacity(8589934592)  // "8.0 Gi"
 * formatMemCapacity(536870912)   // "512 Mi"
 */
export function formatMemCapacity(bytes: number): string {
	const gi = bytes / (1024 * 1024 * 1024);
	if (gi >= 1) return `${gi.toFixed(1)} Gi`;
	const mi = bytes / (1024 * 1024);
	return `${Math.round(mi)} Mi`;
}

/**
 * Format bytes to human-readable disk capacity using binary units (Mi/Gi/Ti)
 * @param bytes - Disk space in bytes
 * @returns Formatted disk (e.g., "1.5 Ti", "256.0 Gi", "512 Mi")
 *
 * @example
 * formatDiskCapacity(1649267441664) // "1.5 Ti"
 * formatDiskCapacity(274877906944)  // "256.0 Gi"
 */
export function formatDiskCapacity(bytes: number): string {
	const ti = bytes / (1024 * 1024 * 1024 * 1024);
	if (ti >= 1) return `${ti.toFixed(1)} Ti`;
	const gi = bytes / (1024 * 1024 * 1024);
	if (gi >= 1) return `${gi.toFixed(1)} Gi`;
	const mi = bytes / (1024 * 1024);
	return `${Math.round(mi)} Mi`;
}

/**
 * Try to parse a string as JSON and return pretty-printed output.
 * Returns the original string unchanged if it is not valid JSON.
 */
export function tryPrettyJson(value: string): { pretty: boolean; text: string } {
	if (!value.trimStart().startsWith('{') && !value.trimStart().startsWith('[')) {
		return { pretty: false, text: value };
	}
	try {
		return { pretty: true, text: JSON.stringify(JSON.parse(value), null, 2) };
	} catch {
		return { pretty: false, text: value };
	}
}
