import {
	Box,
	Layers,
	Network,
	Settings,
	Lock,
	Globe,
	Folder,
	Server,
	GitBranch,
	HardDrive,
	Database,
	Repeat,
	Play,
	Clock,
	Shield,
	Link,
	User,
	Bell,
	Plus,
	Pencil,
	Trash2,
	Wrench,
	Eye,
	FileText,
	CheckCircle,
	Undo,
	ArrowUp,
	RotateCcw,
	BookOpen,
	Terminal,
	Zap,
	AlertCircle,
	Unlock,
	XCircle,
	RefreshCw,
	Stethoscope,
	Archive,
	Activity,
	LogIn,
	LogOut
} from 'lucide-svelte';
import type { AuditAction, AuditEntityType } from '$lib/server/queries/audit';

// ── Constants ───────────────────────────────────────────────────────────────

export const ENTITY_TYPES: { value: AuditEntityType; label: string }[] = [
	{ value: 'pod', label: 'Pods' },
	{ value: 'deployment', label: 'Deployments' },
	{ value: 'service', label: 'Services' },
	{ value: 'configmap', label: 'ConfigMaps' },
	{ value: 'secret', label: 'Secrets' },
	{ value: 'ingress', label: 'Ingresses' },
	{ value: 'namespace', label: 'Namespaces' },
	{ value: 'node', label: 'Nodes' },
	{ value: 'cluster', label: 'Clusters' },
	{ value: 'persistentvolume', label: 'Persistent Volumes' },
	{ value: 'persistentvolumeclaim', label: 'Persistent Volume Claims' },
	{ value: 'statefulset', label: 'StatefulSets' },
	{ value: 'daemonset', label: 'DaemonSets' },
	{ value: 'job', label: 'Jobs' },
	{ value: 'cronjob', label: 'CronJobs' },
	{ value: 'storageclass', label: 'Storage Classes' },
	{ value: 'role', label: 'Roles' },
	{ value: 'rolebinding', label: 'Role Bindings' },
	{ value: 'clusterrole', label: 'Cluster Roles' },
	{ value: 'clusterrolebinding', label: 'Cluster Role Bindings' },
	{ value: 'user', label: 'Users' },
	{ value: 'settings', label: 'Settings' },
	{ value: 'oidc_provider', label: 'OIDC Providers' },
	{ value: 'ldap_config', label: 'LDAP Config' },
	{ value: 'ssh_key', label: 'SSH Keys' },
	{ value: 'certificate', label: 'Certificates' },
	{ value: 'network_policy', label: 'Network Policies' },
	{ value: 'rbac', label: 'RBAC' },
	{ value: 'notification', label: 'Notifications' }
];

export const ACTION_TYPES: { value: AuditAction; label: string }[] = [
	{ value: 'create', label: 'Create' },
	{ value: 'update', label: 'Update' },
	{ value: 'delete', label: 'Delete' },
	{ value: 'patch', label: 'Patch' },
	{ value: 'get', label: 'Get' },
	{ value: 'list', label: 'List' },
	{ value: 'watch', label: 'Watch' },
	{ value: 'apply', label: 'Apply' },
	{ value: 'rollback', label: 'Rollback' },
	{ value: 'scale', label: 'Scale' },
	{ value: 'restart', label: 'Restart' },
	{ value: 'logs', label: 'Logs' },
	{ value: 'exec', label: 'Exec' },
	{ value: 'port_forward', label: 'Port Forward' },
	{ value: 'drain', label: 'Drain' },
	{ value: 'cordon', label: 'Cordon' },
	{ value: 'uncordon', label: 'Uncordon' },
	{ value: 'provision', label: 'Provision' },
	{ value: 'terminate', label: 'Terminate' },
	{ value: 'upgrade', label: 'Upgrade' },
	{ value: 'login', label: 'Login' },
	{ value: 'logout', label: 'Logout' },
	{ value: 'access_granted', label: 'Access Granted' },
	{ value: 'access_denied', label: 'Access Denied' },
	{ value: 'configure', label: 'Configure' },
	{ value: 'sync', label: 'Sync' },
	{ value: 'diagnose', label: 'Diagnose' },
	{ value: 'backup', label: 'Backup' },
	{ value: 'restore', label: 'Restore' }
];

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Get human-readable label for entity type value
 */
export function getEntityTypeLabel(value: string): string {
	const entity = ENTITY_TYPES.find((e) => e.value === value);
	return entity?.label ?? value;
}

/**
 * Get human-readable label for action value
 */
export function getActionLabel(value: string): string {
	const action = ACTION_TYPES.find((a) => a.value === value);
	return action?.label ?? value;
}

// ── Icon Functions ──────────────────────────────────────────────────────────

export function getEntityIcon(entityType: string) {
	switch (entityType) {
		case 'pod':
			return Box;
		case 'deployment':
			return Layers;
		case 'service':
			return Network;
		case 'configmap':
			return Settings;
		case 'secret':
			return Lock;
		case 'ingress':
			return Globe;
		case 'namespace':
			return Folder;
		case 'node':
			return Server;
		case 'cluster':
			return GitBranch;
		case 'persistentvolume':
			return HardDrive;
		case 'persistentvolumeclaim':
			return Database;
		case 'statefulset':
			return Database;
		case 'daemonset':
			return Repeat;
		case 'job':
			return Play;
		case 'cronjob':
			return Clock;
		case 'storageclass':
			return HardDrive;
		case 'role':
			return Shield;
		case 'rolebinding':
			return Link;
		case 'clusterrole':
			return Shield;
		case 'clusterrolebinding':
			return Link;
		case 'user':
			return User;
		case 'settings':
			return Settings;
		case 'oidc_provider':
			return Lock;
		case 'ldap_config':
			return Settings;
		case 'ssh_key':
			return Lock;
		case 'certificate':
			return Lock;
		case 'network_policy':
			return Shield;
		case 'rbac':
			return Shield;
		case 'notification':
			return Bell;
		default:
			return Box;
	}
}

export function getActionIcon(action: string) {
	switch (action) {
		case 'create':
			return Plus;
		case 'update':
			return Pencil;
		case 'delete':
			return Trash2;
		case 'patch':
			return Wrench;
		case 'get':
			return Eye;
		case 'list':
			return FileText;
		case 'watch':
			return Eye;
		case 'apply':
			return CheckCircle;
		case 'rollback':
			return Undo;
		case 'scale':
			return ArrowUp;
		case 'restart':
			return RotateCcw;
		case 'logs':
			return BookOpen;
		case 'exec':
			return Terminal;
		case 'port_forward':
			return Zap;
		case 'drain':
			return AlertCircle;
		case 'cordon':
			return Lock;
		case 'uncordon':
			return Unlock;
		case 'provision':
			return Plus;
		case 'terminate':
			return XCircle;
		case 'upgrade':
			return ArrowUp;
		case 'login':
			return LogIn;
		case 'logout':
			return LogOut;
		case 'access_granted':
			return CheckCircle;
		case 'access_denied':
			return XCircle;
		case 'configure':
			return Settings;
		case 'sync':
			return RefreshCw;
		case 'diagnose':
			return Stethoscope;
		case 'backup':
			return Archive;
		case 'restore':
			return RotateCcw;
		default:
			return Activity;
	}
}

export function getActionColor(action: string): string {
	switch (action) {
		case 'create':
		case 'apply':
		case 'provision':
		case 'login':
		case 'access_granted':
			return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
		case 'delete':
		case 'terminate':
		case 'logout':
		case 'access_denied':
			return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
		case 'update':
		case 'patch':
		case 'restart':
		case 'upgrade':
			return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
		case 'sync':
		case 'backup':
		case 'restore':
			return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
		case 'exec':
		case 'port_forward':
		case 'drain':
		case 'diagnose':
			return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400';
		case 'get':
		case 'list':
		case 'watch':
			return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
		case 'cordon':
		case 'uncordon':
			return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
		case 'rollback':
		case 'scale':
		case 'configure':
			return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
		default:
			return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
	}
}
