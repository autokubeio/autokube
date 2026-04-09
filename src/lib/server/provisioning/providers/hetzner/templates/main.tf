terraform {
  required_version = ">= 1.3.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# ── SSH Key ──────────────────────────────────────────────────────────────────

resource "hcloud_ssh_key" "cluster" {
  name       = var.ssh_key_name != "" ? var.ssh_key_name : "${var.cluster_name}-key"
  public_key = var.ssh_public_key

  lifecycle {
    # Key content cannot be updated in-place on Hetzner
    ignore_changes = [public_key]
  }
}

# ── Private Network (optional) ───────────────────────────────────────────────

resource "hcloud_network" "cluster" {
  count    = var.use_private_network ? 1 : 0
  name     = "${var.cluster_name}-network"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "cluster" {
  count        = var.use_private_network ? 1 : 0
  network_id   = hcloud_network.cluster[0].id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = "10.0.0.0/16"
}

# ── Firewall ─────────────────────────────────────────────────────────────────

resource "hcloud_firewall" "cluster" {
  name = "${var.cluster_name}-fw"

  # SSH access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Kubernetes API server
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # K3s Flannel VXLAN (intra-cluster)
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Kubelet metrics
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # K3s embedded etcd (HA mode)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "2379-2380"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # ICMP (ping)
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # User-defined extra rules
  dynamic "rule" {
    for_each = var.extra_firewall_rules
    content {
      direction  = "in"
      protocol   = rule.value.protocol
      port       = rule.value.port
      source_ips = length(rule.value.source_ips) > 0 ? rule.value.source_ips : ["0.0.0.0/0", "::/0"]
    }
  }
}

# ── Master Nodes ─────────────────────────────────────────────────────────────

locals {
  # Assign each master to a location by round-robin across the provided list
  master_locs = [
    for i in range(var.master_count) : var.master_locations[i % length(var.master_locations)]
  ]
}

# First master — initialises the etcd cluster
resource "hcloud_server" "master_init" {
  name         = "${var.cluster_name}-master-1"
  server_type  = var.master_instance_type
  image        = "ubuntu-24.04"
  location     = local.master_locs[0]
  ssh_keys     = [hcloud_ssh_key.cluster.id]
  firewall_ids = [hcloud_firewall.cluster.id]

  user_data = templatefile("${path.module}/scripts/install-k3s-init.sh", {
    k3s_version  = var.k3s_version
    k3s_token    = var.k3s_token
    cluster_name = var.cluster_name
  })

  dynamic "network" {
    for_each = var.use_private_network ? [1] : []
    content {
      network_id = hcloud_network.cluster[0].id
    }
  }

  depends_on = [hcloud_network_subnet.cluster]
}

# Additional masters — join the existing etcd cluster
resource "hcloud_server" "master_join" {
  count        = var.master_count - 1
  name         = "${var.cluster_name}-master-${count.index + 2}"
  server_type  = var.master_instance_type
  image        = "ubuntu-24.04"
  location     = local.master_locs[count.index + 1]
  ssh_keys     = [hcloud_ssh_key.cluster.id]
  firewall_ids = [hcloud_firewall.cluster.id]

  user_data = templatefile("${path.module}/scripts/install-k3s-join.sh", {
    k3s_version  = var.k3s_version
    k3s_token    = var.k3s_token
    cluster_name = var.cluster_name
    init_ip      = hcloud_server.master_init.ipv4_address
  })

  dynamic "network" {
    for_each = var.use_private_network ? [1] : []
    content {
      network_id = hcloud_network.cluster[0].id
    }
  }

  depends_on = [hcloud_server.master_init, hcloud_network_subnet.cluster]
}

# ── Load Balancer (HA only) ───────────────────────────────────────────────────

resource "hcloud_load_balancer" "masters" {
  count              = var.create_load_balancer && var.master_count > 1 ? 1 : 0
  name               = "${var.cluster_name}-lb"
  load_balancer_type = "lb11"
  location           = var.master_locations[0]
}

resource "hcloud_load_balancer_target" "master_init" {
  count            = var.create_load_balancer && var.master_count > 1 ? 1 : 0
  type             = "server"
  load_balancer_id = hcloud_load_balancer.masters[0].id
  server_id        = hcloud_server.master_init.id
  use_private_ip   = false
  depends_on       = [hcloud_load_balancer.masters]
}

resource "hcloud_load_balancer_target" "master_join" {
  count            = var.create_load_balancer && var.master_count > 1 ? var.master_count - 1 : 0
  type             = "server"
  load_balancer_id = hcloud_load_balancer.masters[0].id
  server_id        = hcloud_server.master_join[count.index].id
  use_private_ip   = false
  depends_on       = [hcloud_load_balancer.masters, hcloud_server.master_join]
}

resource "hcloud_load_balancer_service" "api" {
  count            = var.create_load_balancer && var.master_count > 1 ? 1 : 0
  load_balancer_id = hcloud_load_balancer.masters[0].id
  protocol         = "tcp"
  listen_port      = 6443
  destination_port = 6443
}

# ── Worker Nodes ─────────────────────────────────────────────────────────────

locals {
  # Flatten worker pools into individual server definitions
  worker_servers = flatten([
    for pool in var.worker_pools : [
      for i in range(pool.count) : {
        pool_name     = pool.name
        index         = i
        instance_type = pool.instance_type
        location      = pool.location
      }
    ]
  ])

  # The API endpoint workers should use to join
  worker_api_endpoint = (
    var.create_load_balancer && var.master_count > 1
    ? hcloud_load_balancer.masters[0].ipv4
    : hcloud_server.master_init.ipv4_address
  )
}

resource "hcloud_server" "worker" {
  count        = length(local.worker_servers)
  name         = "${var.cluster_name}-${local.worker_servers[count.index].pool_name}-${local.worker_servers[count.index].index + 1}"
  server_type  = local.worker_servers[count.index].instance_type
  image        = "ubuntu-24.04"
  location     = local.worker_servers[count.index].location
  ssh_keys     = [hcloud_ssh_key.cluster.id]
  firewall_ids = [hcloud_firewall.cluster.id]

  user_data = templatefile("${path.module}/scripts/install-k3s-worker.sh", {
    k3s_version = var.k3s_version
    k3s_token   = var.k3s_token
    server_ip   = local.worker_api_endpoint
  })

  dynamic "network" {
    for_each = var.use_private_network ? [1] : []
    content {
      network_id = hcloud_network.cluster[0].id
    }
  }

  depends_on = [hcloud_server.master_init, hcloud_server.master_join, hcloud_network_subnet.cluster]
}
