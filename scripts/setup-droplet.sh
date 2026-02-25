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

echo "� Installing security tools..."
apt-get install -y fail2ban unattended-upgrades

# ── Automatic security updates ────────────────────────────
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /etc/apt/apt.conf.d/50unattended-upgrades-local
systemctl enable unattended-upgrades

# ── fail2ban (SSH brute-force protection) ─────────────────
echo "🛡️ Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 5
bantime = 3600
findtime = 600
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# ── SSH hardening ─────────────────────────────────────────
echo "🔐 Hardening SSH..."
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config
systemctl restart sshd

echo "🐳 Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

echo "📦 Installing Docker Compose plugin..."
apt-get install -y docker-compose-plugin

echo "🔥 Configuring firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
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
echo "  3. Push to master branch to trigger deployment"
