# ── Provider ────────────────────────────────────────────────────────────────

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

# ── Cluster Identity ─────────────────────────────────────────────────────────

variable "cluster_name" {
  description = "Name for the K3s cluster. Used as a prefix for all resources."
  type        = string
}

variable "k3s_version" {
  description = "K3s version to install (e.g. v1.32.0+k3s1)"
  type        = string
  default     = "v1.32.0+k3s1"
}

variable "k3s_token" {
  description = "Shared secret token for K3s cluster formation"
  type        = string
  sensitive   = true
}

# ── SSH ───────────────────────────────────────────────────────────────────────

variable "ssh_public_key" {
  description = "SSH public key content to inject into all nodes"
  type        = string
}

variable "ssh_key_name" {
  description = "Name to use for the SSH key resource in Hetzner Cloud"
  type        = string
  default     = ""
}

# ── Master Nodes ─────────────────────────────────────────────────────────────

variable "master_count" {
  description = "Number of master (control-plane) nodes. Use 1, 3, or 5 for etcd quorum."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 3, 5, 7], var.master_count)
    error_message = "master_count must be 1, 3, 5, or 7."
  }
}

variable "master_instance_type" {
  description = "Hetzner server type for master nodes (e.g. cx22, cx32)"
  type        = string
  default     = "cx22"
}

variable "master_locations" {
  description = "Ordered list of Hetzner datacenter codes. Nodes are assigned round-robin."
  type        = list(string)
  default     = ["nbg1"]
}

# ── Worker Pools ─────────────────────────────────────────────────────────────

variable "worker_pools" {
  description = "Worker node pool configurations"
  type = list(object({
    name          = string
    count         = number
    instance_type = string
    location      = string
  }))
  default = []
}

# ── Networking ───────────────────────────────────────────────────────────────

variable "network_zone" {
  description = "Hetzner network zone for the optional private network (eu-central, us-east, us-west, ap-southeast)"
  type        = string
  default     = "eu-central"
}

variable "use_private_network" {
  description = "Whether to create and attach a Hetzner private network to all nodes"
  type        = bool
  default     = false
}

variable "create_load_balancer" {
  description = "Create an lb11 load balancer in front of master nodes for HA API access"
  type        = bool
  default     = false
}

# ── Firewall ─────────────────────────────────────────────────────────────────

variable "extra_firewall_rules" {
  description = "Additional inbound firewall rules defined by the user in the wizard"
  type = list(object({
    port       = string
    protocol   = string
    source_ips = list(string)
  }))
  default = []
}
