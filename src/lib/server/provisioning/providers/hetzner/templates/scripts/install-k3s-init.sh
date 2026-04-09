#!/bin/bash
# cloud-init script: initialise the FIRST K3s master (--cluster-init etcd mode)
# Template variables are substituted by Terraform's templatefile() before use.
set -euo pipefail

export INSTALL_K3S_VERSION="${k3s_version}"
export K3S_TOKEN="${k3s_token}"

# Wait for apt to be available (cloud-init may hold the lock briefly)
until apt-get update -qq 2>/dev/null; do
  echo "[k3s-init] Waiting for apt lock..." >&2
  sleep 5
done

# Install dependencies
apt-get install -y -qq curl

# Install K3s as init (bootstraps embedded etcd)
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --write-kubeconfig-mode=644 \
  --disable=traefik \
  --node-name="${cluster_name}-master-1"

# Wait until the API server is healthy
timeout 300 bash -c 'until curl -sk https://localhost:6443/livez > /dev/null 2>&1; do
  echo "[k3s-init] Waiting for API server..." >&2
  sleep 5
done'

echo "[k3s-init] K3s master initialised successfully" >&2
