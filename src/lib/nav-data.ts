import {
	LayoutDashboard,
	Box,
	Layers,
	Server,
	Database,
	Copy,
	Timer,
	Calendar,
	Gauge,
	HardDrive,
	Activity,
	Network,
	Globe,
	Shield,
	FileText,
	Key,
	Scale,
	Ruler,
	User,
	ShieldCheck,
	Link,
	Link2,
	ClipboardList,
	ScrollText,
	Settings,
	Blocks,
	Workflow,
	Package,
	History
} from 'lucide-svelte';

export type IconComponent = typeof LayoutDashboard;

export interface MenuItem {
	href: string;
	Icon: IconComponent;
	label: string;
	permission: string;
	badge?: string;
}

export interface MenuCategory {
	label: string;
	items: readonly MenuItem[];
}

export const topItems: readonly MenuItem[] = [
	{ href: '/', Icon: LayoutDashboard, label: 'Dashboard', permission: 'always' },
	{ href: '/resource-map', Icon: Workflow, label: 'Resource Map', permission: 'always' },
	{ href: '/timeline', Icon: History, label: 'Timeline', permission: 'always' }
] as const;

export const menuCategories: readonly MenuCategory[] = [
	{
		label: 'Workload',
		items: [
			{ href: '/pods', Icon: Box, label: 'Pods', permission: 'pods' },
			{ href: '/deployments', Icon: Layers, label: 'Deployments', permission: 'deployments' },
			{ href: '/daemonsets', Icon: Server, label: 'DaemonSets', permission: 'deployments' },
			{ href: '/statefulsets', Icon: Database, label: 'StatefulSets', permission: 'deployments' },
			{ href: '/replicasets', Icon: Copy, label: 'ReplicaSets', permission: 'deployments' },
			{ href: '/jobs', Icon: Timer, label: 'Jobs', permission: 'jobs' },
			{ href: '/cronjobs', Icon: Calendar, label: 'CronJobs', permission: 'jobs' },
			{ href: '/hpas', Icon: Gauge, label: 'Pod Auto Scaling', permission: 'deployments' },
			{ href: '/nodes', Icon: HardDrive, label: 'Nodes', permission: 'nodes' },
			{ href: '/namespaces', Icon: Box, label: 'Namespaces', permission: 'namespaces' },
			{ href: '/events', Icon: Activity, label: 'Events', permission: 'events' }
		]
	},
	{
		label: 'Network & Routing',
		items: [
			{ href: '/services', Icon: Network, label: 'Services', permission: 'services' },
			{ href: '/endpoints', Icon: Network, label: 'Endpoints', permission: 'services' },
			{ href: '/endpointslices', Icon: Network, label: 'Endpoint Slices', permission: 'services' },
			{ href: '/ingress', Icon: Globe, label: 'Ingresses', permission: 'ingress' },
			{ href: '/ingressclasses', Icon: Globe, label: 'Ingress Classes', permission: 'ingress' },
			{ href: '/networkpolicies', Icon: Shield, label: 'Network Policies', permission: 'services' }
		]
	},
	{
		label: 'Configuration',
		items: [
			{ href: '/configmaps', Icon: FileText, label: 'ConfigMaps', permission: 'config' },
			{ href: '/secrets', Icon: Key, label: 'Secrets', permission: 'config' },
			{ href: '/resourcequotas', Icon: Scale, label: 'Resource Quotas', permission: 'config' },
			{ href: '/limitranges', Icon: Ruler, label: 'Limit Ranges', permission: 'config' }
		]
	},
	{
		label: 'Storage',
		items: [
			{ href: '/persistentvolumeclaims', Icon: HardDrive, label: 'PVCs', permission: 'volumes' },
			{
				href: '/persistentvolumes',
				Icon: Database,
				label: 'Persistent Volumes',
				permission: 'volumes'
			},
			{ href: '/storageclasses', Icon: Layers, label: 'Storage Classes', permission: 'volumes' }
		]
	},
	{
		label: 'Access Control',
		items: [
			{ href: '/serviceaccounts', Icon: User, label: 'Service Accounts', permission: 'access_control' },
			{ href: '/roles', Icon: Shield, label: 'Roles', permission: 'access_control' },
			{ href: '/clusterroles', Icon: ShieldCheck, label: 'Cluster Roles', permission: 'access_control' },
			{ href: '/rolebindings', Icon: Link, label: 'Role Bindings', permission: 'access_control' },
			{
				href: '/clusterrolebindings',
				Icon: Link2,
				label: 'Cluster Role Bindings',
				permission: 'access_control'
			}
		]
	},
	{
		label: 'Extensions',
		items: [
			{
				href: '/custom-resources',
				Icon: Blocks,
				label: 'Custom Resources',
				permission: 'custom_resources'
			},
			{
				href: '/helm-releases',
				Icon: Package,
				label: 'Helm Releases',
				permission: 'custom_resources'
			}
		]
	}
] as const;

export const bottomItems: readonly MenuItem[] = [
	{ href: '/audit', Icon: ScrollText, label: 'Audit Log', permission: 'audit_logs', badge: 'Pro' },
	{ href: '/settings', Icon: Settings, label: 'Settings', permission: 'settings' }
] as const;
