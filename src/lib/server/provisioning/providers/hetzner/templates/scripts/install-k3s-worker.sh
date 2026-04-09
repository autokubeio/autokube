#!/bin/bash
# cloud-init script: install K3s as a WORKER agent and join the cluster.
# Template variables are substituted by Terraform's templatefile() before use.
set -euo pipefail

export INSTALL_K3S_VERSION="${k3s_version}"
export K3S_TOKEN="${k3s_token}"
export K3S_URL="https://${server_ip}:6443"

# Wait for apt lock
until apt-get update -qq 2>/dev/null; do
  echo "[k3s-worker] Waiting for apt lock..." >&2
  sleep 5
done

apt-get install -y -qq curl

# Wait until the API server is reachable
timeout 300 bash -c "until curl -sk https://${server_ip}:6443/livez > /dev/null 2>&1; do
  echo '[k3s-worker] Waiting for API server at ${server_ip}...' >&2
  sleep 10
done"

# Install K3s agent
curl -sfL https://get.k3s.io | sh -s - agent

echo "[k3s-worker] Worker agent joined cluster at ${server_ip}" >&2
