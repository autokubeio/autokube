<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Separator } from '$lib/components/ui/separator';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import { Settings, Users, Server, Eye, Terminal, Database, Bell, Key, Box, Layers, Timer, Network, Globe, FileText, HardDrive, Activity, Shield, Blocks } from 'lucide-svelte';
	import type { PermissionMap, ResolvedRole } from '$lib/server/queries/roles';

	interface Props {
		open?: boolean;
		role?: ResolvedRole | null;
		onClose: () => void;
		onSave: (data: {
			name: string;
			description: string;
			permissions: PermissionMap;
		}) => Promise<void>;
	}

	let { open = $bindable(false), role = null, onClose, onSave }: Props = $props();

	let name = $state('');
	let description = $state('');
	let systemPerms = $state<Map<string, Set<string>>>(new Map());
	let clusterPerms = $state<Map<string, Set<string>>>(new Map());
	let saving = $state(false);

	const isEditMode = $derived(!!role);
	const isValid = $derived(name.trim().length > 0);
	const totalSystemPerms = $derived([...systemPerms.values()].reduce((n, s) => n + s.size, 0));
	const totalClusterPerms = $derived([...clusterPerms.values()].reduce((n, s) => n + s.size, 0));

	const SYSTEM_PERMISSION_GROUPS: {
		label: string;
		icon: typeof Settings;
		resource: string;
		perms: { id: string; label: string }[];
	}[] = [
		{
			label: 'Settings',
			icon: Settings,
			resource: 'settings',
			perms: [
				{ id: 'view', label: 'View settings' },
				{ id: 'edit', label: 'Edit settings' }
			]
		},
		{
			label: 'Users',
			icon: Users,
			resource: 'users',
			perms: [
				{ id: 'view', label: 'View users' },
				{ id: 'create', label: 'Create users' },
				{ id: 'edit', label: 'Edit users' },
				{ id: 'delete', label: 'Delete users' }
			]
		},
		{
			label: 'Clusters',
			icon: Server,
			resource: 'clusters',
			perms: [
				{ id: 'view', label: 'View clusters' },
				{ id: 'create', label: 'Create clusters' },
				{ id: 'edit', label: 'Edit clusters' },
				{ id: 'delete', label: 'Delete clusters' }
			]
		},
		{
			label: 'Audit Log',
			icon: Eye,
			resource: 'audit_logs',
			perms: [
				{ id: 'view', label: 'View audit log' },
				{ id: 'export', label: 'Export audit log' }
			]
		},
		{
			label: 'Notifications',
			icon: Bell,
			resource: 'notifications',
			perms: [
				{ id: 'view', label: 'View notifications' },
				{ id: 'edit', label: 'Manage notifications' }
			]
		},
		{
			label: 'License',
			icon: Key,
			resource: 'license',
			perms: [
				{ id: 'view', label: 'View license' },
				{ id: 'edit', label: 'Manage license' }
			]
		}
	];

	const CLUSTER_PERMISSION_GROUPS: {
		label: string;
		icon: typeof Settings;
		resource: string;
		perms: { id: string; label: string }[];
	}[] = [
		{
			label: 'Pods',
			icon: Box,
			resource: 'pods',
			perms: [
				{ id: 'view', label: 'View pods' },
				{ id: 'create', label: 'Create pods' },
				{ id: 'delete', label: 'Delete pods' },
				{ id: 'exec', label: 'Exec into pods' },
				{ id: 'logs', label: 'View pod logs' }
			]
		},
		{
			label: 'Deployments',
			icon: Layers,
			resource: 'deployments',
			perms: [
				{ id: 'view', label: 'View deployments' },
				{ id: 'create', label: 'Create deployments' },
				{ id: 'edit', label: 'Edit deployments' },
				{ id: 'delete', label: 'Delete deployments' },
				{ id: 'scale', label: 'Scale workloads' },
				{ id: 'restart', label: 'Restart workloads' }
			]
		},
		{
			label: 'Jobs & CronJobs',
			icon: Timer,
			resource: 'jobs',
			perms: [
				{ id: 'view', label: 'View jobs' },
				{ id: 'create', label: 'Create jobs' },
				{ id: 'delete', label: 'Delete jobs' }
			]
		},
		{
			label: 'Services & Networking',
			icon: Network,
			resource: 'services',
			perms: [
				{ id: 'view', label: 'View services' },
				{ id: 'create', label: 'Create services' },
				{ id: 'edit', label: 'Edit services' },
				{ id: 'delete', label: 'Delete services' }
			]
		},
		{
			label: 'Ingress',
			icon: Globe,
			resource: 'ingress',
			perms: [
				{ id: 'view', label: 'View ingresses' },
				{ id: 'create', label: 'Create ingresses' },
				{ id: 'edit', label: 'Edit ingresses' },
				{ id: 'delete', label: 'Delete ingresses' }
			]
		},
		{
			label: 'Configuration',
			icon: FileText,
			resource: 'config',
			perms: [
				{ id: 'view', label: 'View configs' },
				{ id: 'create', label: 'Create configs' },
				{ id: 'edit', label: 'Edit configs' },
				{ id: 'delete', label: 'Delete configs' }
			]
		},
		{
			label: 'Storage',
			icon: HardDrive,
			resource: 'volumes',
			perms: [
				{ id: 'view', label: 'View volumes' },
				{ id: 'create', label: 'Create volumes' },
				{ id: 'edit', label: 'Edit volumes' },
				{ id: 'delete', label: 'Delete volumes' }
			]
		},
		{
			label: 'Nodes',
			icon: Server,
			resource: 'nodes',
			perms: [
				{ id: 'view', label: 'View nodes' },
				{ id: 'cordon', label: 'Cordon / uncordon' },
				{ id: 'drain', label: 'Drain nodes' }
			]
		},
		{
			label: 'Namespaces',
			icon: Database,
			resource: 'namespaces',
			perms: [
				{ id: 'view', label: 'View namespaces' },
				{ id: 'create', label: 'Create namespaces' },
				{ id: 'delete', label: 'Delete namespaces' }
			]
		},
		{
			label: 'Events',
			icon: Activity,
			resource: 'events',
			perms: [{ id: 'view', label: 'View events' }]
		},
		{
			label: 'Access Control',
			icon: Shield,
			resource: 'access_control',
			perms: [
				{ id: 'view', label: 'View RBAC' },
				{ id: 'edit', label: 'Manage RBAC' }
			]
		},
		{
			label: 'Custom Resources',
			icon: Blocks,
			resource: 'custom_resources',
			perms: [
				{ id: 'view', label: 'View CRDs' },
				{ id: 'create', label: 'Create CRDs' },
				{ id: 'edit', label: 'Edit CRDs' },
				{ id: 'delete', label: 'Delete CRDs' }
			]
		}
	];

	function buildSetsFromPermissions(permissions: PermissionMap) {
		const permsAsRecord = permissions as unknown as Record<string, string[]>;
		const system = new Map<string, Set<string>>();
		const cluster = new Map<string, Set<string>>();

		for (const group of SYSTEM_PERMISSION_GROUPS) {
			const actions = new Set<string>(permsAsRecord[group.resource] ?? []);
			system.set(group.resource, actions);
		}
		for (const group of CLUSTER_PERMISSION_GROUPS) {
			const actions = new Set<string>(permsAsRecord[group.resource] ?? []);
			cluster.set(group.resource, actions);
		}
		return { system, cluster };
	}

	function buildPermissionsFromSets(
		system: Map<string, Set<string>>,
		cluster: Map<string, Set<string>>
	): PermissionMap {
		const result: Record<string, string[]> = {};
		for (const [resource, actions] of system) {
			if (actions.size > 0) result[resource] = [...actions];
		}
		for (const [resource, actions] of cluster) {
			if (actions.size > 0) result[resource] = [...actions];
		}
		return result as unknown as PermissionMap;
	}

	$effect(() => {
		if (open) {
			name = role?.name ?? '';
			description = role?.description ?? '';
			if (role?.permissions) {
				const { system, cluster } = buildSetsFromPermissions(role.permissions);
				systemPerms = system;
				clusterPerms = cluster;
			} else {
				systemPerms = new Map(SYSTEM_PERMISSION_GROUPS.map((g) => [g.resource, new Set()]));
				clusterPerms = new Map(CLUSTER_PERMISSION_GROUPS.map((g) => [g.resource, new Set()]));
			}
		}
	});

	function toggleSys(resource: string, action: string) {
		const s = new Set(systemPerms.get(resource) ?? []);
		if (s.has(action)) s.delete(action);
		else s.add(action);
		systemPerms.set(resource, s);
		systemPerms = new Map(systemPerms);
	}

	function toggleCls(resource: string, action: string) {
		const s = new Set(clusterPerms.get(resource) ?? []);
		if (s.has(action)) s.delete(action);
		else s.add(action);
		clusterPerms.set(resource, s);
		clusterPerms = new Map(clusterPerms);
	}

	async function handleSave() {
		saving = true;
		try {
			await onSave({
				name: name.trim(),
				description: description.trim(),
				permissions: buildPermissionsFromSets(systemPerms, clusterPerms)
			});
			onClose();
		} catch (err) {
			console.error('[Role Dialog] Save error:', err);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
		<DialogHeader>
			<DialogTitle class="text-base">{isEditMode ? 'Edit Role' : 'New Role'}</DialogTitle>
		</DialogHeader>

		<div class="flex-1 space-y-4 overflow-y-auto pr-1">
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Name <span class="text-destructive">*</span></Label>
					<Input
						bind:value={name}
						placeholder="e.g. developer"
						class="h-8 text-xs"
						disabled={role?.isSystem || saving}
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Description</Label>
					<Input
						bind:value={description}
						placeholder="Optional description"
						class="h-8 text-xs"
						disabled={saving}
					/>
				</div>
			</div>

			<Separator />

			<Tabs value="system">
				<TabsList class="h-8">
					<TabsTrigger value="system" class="text-xs">
						System Permissions
						<Badge variant="secondary" class="ml-1.5 h-4 px-1 text-[10px]">
							{totalSystemPerms}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value="cluster" class="text-xs">
						Cluster Permissions
						<Badge variant="secondary" class="ml-1.5 h-4 px-1 text-[10px]">
							{totalClusterPerms}
						</Badge>
					</TabsTrigger>
				</TabsList>

				<TabsContent value="system" class="mt-3 space-y-3">
					{#each SYSTEM_PERMISSION_GROUPS as group (group.resource)}
						<div class="rounded-lg border bg-muted/20 p-3">
							<div class="mb-2.5 flex items-center gap-1.5">
								<group.icon class="size-3 text-muted-foreground" />
								<span class="text-xs font-medium">{group.label}</span>
							</div>
							<div class="grid grid-cols-2 gap-2">
								{#each group.perms as p (p.id)}
									<label class="group/perm flex cursor-pointer items-center gap-2">
										<Checkbox
											checked={systemPerms.get(group.resource)?.has(p.id) ?? false}
											onCheckedChange={() => toggleSys(group.resource, p.id)}
											class="size-3.5"
											disabled={saving}
										/>
										<span
											class="text-xs text-muted-foreground transition-colors group-hover/perm:text-foreground"
										>
											{p.label}
										</span>
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</TabsContent>

				<TabsContent value="cluster" class="mt-3 space-y-3">
					{#each CLUSTER_PERMISSION_GROUPS as group (group.resource)}
						<div class="rounded-lg border bg-muted/20 p-3">
							<div class="mb-2.5 flex items-center gap-1.5">
								<group.icon class="size-3 text-muted-foreground" />
								<span class="text-xs font-medium">{group.label}</span>
							</div>
							<div class="grid grid-cols-2 gap-2">
								{#each group.perms as p (p.id)}
									<label class="group/perm flex cursor-pointer items-center gap-2">
										<Checkbox
											checked={clusterPerms.get(group.resource)?.has(p.id) ?? false}
											onCheckedChange={() => toggleCls(group.resource, p.id)}
											class="size-3.5"
											disabled={saving}
										/>
										<span
											class="text-xs text-muted-foreground transition-colors group-hover/perm:text-foreground"
										>
											{p.label}
										</span>
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</TabsContent>
			</Tabs>
		</div>

		<DialogFooter class="mt-2 shrink-0 border-t pt-3">
			<Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose} disabled={saving}>
				Cancel
			</Button>
			<Button size="sm" class="h-8 text-xs" disabled={!isValid || saving} onclick={handleSave}>
				{saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Role'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
