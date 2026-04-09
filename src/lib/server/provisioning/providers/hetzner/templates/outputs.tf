output "master_init_ip" {
  description = "Public IPv4 address of the first (init) master node"
  value       = hcloud_server.master_init.ipv4_address
}

output "master_join_ips" {
  description = "Public IPv4 addresses of additional master nodes"
  value       = hcloud_server.master_join[*].ipv4_address
}

output "master_ips" {
  description = "All master node public IPv4 addresses (init first)"
  value = concat(
    [hcloud_server.master_init.ipv4_address],
    hcloud_server.master_join[*].ipv4_address
  )
}

output "worker_ips" {
  description = "All worker node public IPv4 addresses"
  value       = hcloud_server.worker[*].ipv4_address
}

output "api_endpoint" {
  description = "The Kubernetes API server endpoint (LB IP for HA, master IP for single)"
  value = (
    var.create_load_balancer && var.master_count > 1
    ? hcloud_load_balancer.masters[0].ipv4
    : hcloud_server.master_init.ipv4_address
  )
}

output "load_balancer_ip" {
  description = "Load balancer IP (null if not created)"
  value = (
    var.create_load_balancer && var.master_count > 1
    ? hcloud_load_balancer.masters[0].ipv4
    : null
  )
}

output "ssh_key_id" {
  description = "Hetzner SSH key resource ID"
  value       = hcloud_ssh_key.cluster.id
}
