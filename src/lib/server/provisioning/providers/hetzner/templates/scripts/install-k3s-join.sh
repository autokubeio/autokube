#!/bin/bash
# cloud-init script: join an ADDITIONAL master to an existing K3s etcd cluster.
# Template variables are substituted by Terraform's templatefile() before use.
set -euo pipefail

export INSTALL_K3S_VERSION="${k3s_version}"
export K3S_TOKEN="${k3s_token}"
export K3S_URL="https://${init_ip}:6443"

# Wait for apt lock
until apt-get update -qq 2>/dev/null; do
  echo "[k3s-join] Waiting for apt lock..." >&2
  sleep 5
done

apt-get install -y -qq curl

# Wait until the init master's API is reachable before joining
timeout 300 bash -c "until curl -sk https://${init_ip}:6443/livez > /dev/null 2>&1; do
  echo '[k3s-join] Waiting for init master...' >&2
  sleep 10
done"

# Join as an HA control-plane node
curl -sfL https://get.k3s.io | sh -s - server \
  --server "$K3S_URL" \
  --write-kubeconfig-mode=644 \
  --disable=traefik

echo "[k3s-join] Additional master joined cluster at ${init_ip}" >&2
