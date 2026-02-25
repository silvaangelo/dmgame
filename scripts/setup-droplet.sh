#!/usr/bin/env bash
# ─── DigitalOcean Droplet Initial Setup ────────────────────
# Run this ONCE on a fresh Ubuntu 22.04/24.04 droplet.
#
# Usage:
#   ssh root@YOUR_DROPLET_IP 'bash -s' < scripts/setup-droplet.sh
# ───────────────────────────────────────────────────────────

set -euo pipefail

echo "🔧 Updating system packages..."
apt-get update -y && apt-get upgrade -y

echo "🐳 Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

echo "📦 Installing Docker Compose plugin..."
apt-get install -y docker-compose-plugin

echo "🔥 Configuring firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

echo "📁 Creating app directory..."
mkdir -p /opt/deathmatch-arena

echo "✅ Droplet setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add your GitHub Actions deploy key to this server"
echo "  2. Configure GitHub Secrets in your repository:"
echo "     - DROPLET_HOST        = $(curl -s ifconfig.me)"
echo "     - DROPLET_USERNAME    = root"
echo "     - DROPLET_SSH_KEY     = <your private SSH key>"
echo "  3. Push to main branch to trigger deployment"
