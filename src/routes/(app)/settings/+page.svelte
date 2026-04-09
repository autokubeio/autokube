<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GeneralTab from './tabs/general-tab.svelte';
	import AuthenticationTab from './tabs/authentication-tab.svelte';
	import AboutTab from './tabs/about-tab.svelte';
	import SshKeysTab from './tabs/ssh-keys-tab.svelte';
	import ClustersTab from './tabs/clusters-tab.svelte';
	import NotificationsTab from './tabs/notifications-tab.svelte';
	import LicenseTab from './tabs/license-tab.svelte';
	import DangerZoneTab from './tabs/danger-zone-tab.svelte';
	import AiTab from './tabs/ai-tab.svelte';
	import ProvisioningTab from './tabs/provisioning-tab.svelte';

	const settingsTabs = [
		{ value: 'general', label: 'General' },
		{ value: 'authentication', label: 'Authentication' },
		{ value: 'cluster', label: 'Cluster' },
		{ value: 'provisioning', label: 'Provisioning' },
		{ value: 'ssh-keys', label: 'SSH Keys' },
		{ value: 'notifications', label: 'Notifications' },
		{ value: 'ai', label: 'AI Assistant' },
		{ value: 'license', label: 'License' },
		{ value: 'about', label: 'About' },
		{ value: 'danger-zone', label: 'Danger Zone', danger: true }
	];

	const validTabs = settingsTabs.map((t) => t.value);

	function getTabFromHash(): string {
		const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
		return validTabs.includes(hash) ? hash : 'general';
	}

	let activeTab = $state(getTabFromHash());

	function onTabChange(value: string | undefined) {
		if (!value) return;
		activeTab = value;
		goto(`/settings#${value}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	onMount(() => {
		const onHashChange = () => {
			const tab = getTabFromHash();
			if (tab !== activeTab) activeTab = tab;
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	});
</script>

<svelte:head>
	<title>Settings - AutoKube</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Settings</h1>
		<p class="text-sm text-muted-foreground">Manage your cluster and notification preferences.</p>
	</div>

	<!-- Tabs -->
	<Tabs.Root value={activeTab} onValueChange={onTabChange}>
		<Tabs.List>
			{#each settingsTabs as tab}
				<Tabs.Trigger
					value={tab.value}
					class={tab.danger ? 'text-red-500! data-[state=active]:text-red-500!' : ''}
				>
					{tab.label}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<Tabs.Content value="general" class="mt-3">
			<GeneralTab />
		</Tabs.Content>

		<Tabs.Content value="authentication" class="mt-3">
			<AuthenticationTab />
		</Tabs.Content>

		<Tabs.Content value="ssh-keys" class="mt-3">
			<SshKeysTab />
		</Tabs.Content>

		<Tabs.Content value="cluster" class="mt-3">
			<ClustersTab />
		</Tabs.Content>

		<Tabs.Content value="about" class="mt-3">
			<AboutTab />
		</Tabs.Content>

		<Tabs.Content value="notifications" class="mt-3">
			<NotificationsTab />
		</Tabs.Content>

		<Tabs.Content value="ai" class="mt-3">
			<AiTab />
		</Tabs.Content>

		<Tabs.Content value="provisioning" class="mt-3">
			<ProvisioningTab />
		</Tabs.Content>

		<Tabs.Content value="license" class="mt-3">
			<LicenseTab />
		</Tabs.Content>

		<Tabs.Content value="danger-zone" class="mt-3">
			<DangerZoneTab />
		</Tabs.Content>

		<!-- Placeholder tabs -->
		{#each settingsTabs.filter((t) => !['general', 'authentication', 'about', 'ssh-keys', 'cluster', 'notifications', 'ai', 'provisioning', 'license', 'danger-zone'].includes(t.value)) as tab}
			<Tabs.Content value={tab.value} class="mt-3">
				<Card.Root>
					<Card.Header>
						<Card.Title>{tab.label}</Card.Title>
						<Card.Description>Configure {tab.label.toLowerCase()} settings.</Card.Description>
					</Card.Header>
					<Card.Content>
						<p class="text-sm text-muted-foreground">Coming soon.</p>
					</Card.Content>
				</Card.Root>
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</div>
