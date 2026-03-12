import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Snippet } from 'svelte';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Type helpers used by shadcn-svelte components
export type WithElementRef<T, E extends Element = HTMLElement> = T & {
	ref?: E | null;
	children?: Snippet;
};

export type WithoutChildren<T> = Omit<T, 'children'>;

export type WithoutChild<T> = Omit<T, 'child'>;

export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>;

/** Format an uptime duration (ms) into "Xd HH:MM:SS". */
export function formatUptime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return days > 0
		? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
		: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Format bytes to a human-readable string. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
