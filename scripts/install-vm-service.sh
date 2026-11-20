#!/usr/bin/env bash
set -euo pipefail

# Installs faz-cloud-gaming as a systemd service on the GCP GPU VM so the backend
# starts automatically on every boot (works with Cloud Run on-demand VM wake/sleep).

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPO_DIR}/server"
RUN_USER="${SUDO_USER:-$USER}"
NODE_BIN="$(command -v node)"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: node not found in PATH." >&2
  exit 1
fi

echo "Installing systemd service for user '${RUN_USER}' at ${SERVER_DIR}..."

sudo tee /etc/systemd/system/faz-cloud-gaming.service >/dev/null <<EOF
[Unit]
Description=FazCloud Gaming Orchestrator API
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${SERVER_DIR}
ExecStart=${NODE_BIN} ${SERVER_DIR}/src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Allow passwordless poweroff only for optional AUTO_STOP_VM_IDLE_MS auto-shutdown
echo "${RUN_USER} ALL=(root) NOPASSWD: /sbin/poweroff, /usr/sbin/poweroff" | sudo tee /etc/sudoers.d/faz-cloud-poweroff >/dev/null
sudo chmod 0440 /etc/sudoers.d/faz-cloud-poweroff

sudo systemctl daemon-reload
sudo systemctl enable --now faz-cloud-gaming.service
sudo systemctl status faz-cloud-gaming.service --no-pager
