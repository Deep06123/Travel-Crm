#!/usr/bin/env bash
#
# First-run setup for the Travel Booking CRM on a Hostinger VPS.
#
# Run once, as the `deploy` user, from a fresh checkout:
#
#   sudo mkdir -p /srv/travel-crm && sudo chown deploy:deploy /srv/travel-crm
#   git clone <repo> /srv/travel-crm/repo
#   cd /srv/travel-crm/repo && scripts/hostinger-setup.sh crm.example.com
#
# It creates the release layout, installs the systemd unit and the nginx site
# with your domain substituted in, and then stops and tells you what is left.
#
# What it will NOT do, on purpose:
#
#   * install packages — `apt-get install` on someone's server is theirs to run
#   * create the MySQL database or user — that needs a password you choose
#   * write .env — it holds secrets, and a generated placeholder that looks
#     filled in is worse than an obvious gap
#   * obtain a certificate — certbot needs DNS to have propagated first
#
# Everything here is idempotent: an existing file is left alone and reported,
# never silently overwritten.

set -euo pipefail

DOMAIN="${1:-}"
ROOT="${ROOT:-/srv/travel-crm}"
SERVICE_USER="${SERVICE_USER:-deploy}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
skip() { printf '  \033[33m•\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$DOMAIN" ] || fail "Usage: scripts/hostinger-setup.sh <domain>   e.g. crm.example.com"

# ---------------------------------------------------------------------------
step "Checking prerequisites"
# ---------------------------------------------------------------------------

NODE_MAJOR="$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')" || fail "node is not installed."
[ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 20 ] || fail "Node 20.9+ is required; found $(node --version 2>/dev/null || echo none)."
ok "node $(node --version)"

for tool in npm git nginx mysql mysqldump curl; do
  if command -v "$tool" > /dev/null 2>&1; then
    ok "$tool"
  else
    # mysqldump and mysql are what scripts/backup.sh and restore.sh shell out
    # to. A deployment without them deploys fine and has no backups, which is
    # discovered at the worst possible moment.
    fail "$tool is not installed. sudo apt-get install -y nodejs mysql-server nginx git curl"
  fi
done

# ---------------------------------------------------------------------------
step "Creating the release layout under $ROOT"
# ---------------------------------------------------------------------------

# shared/ holds everything that must outlive a release: the secrets and the
# uploaded documents. Releases are replaced wholesale, so anything kept inside
# one is lost on the next deploy.
for dir in "$ROOT/shared" "$ROOT/shared/storage" "$ROOT/releases"; do
  if [ -d "$dir" ]; then
    skip "$dir exists"
  else
    mkdir -p "$dir"
    ok "created $dir"
  fi
done

# Documents are served only through /api/admin/documents/[id]/view, after a
# permission check. 0700 means that even someone with a shell on the box as
# another user cannot read a passport scan straight off the disk.
chmod 700 "$ROOT/shared/storage"
ok "$ROOT/shared/storage is 0700"

if [ -f "$ROOT/shared/.env" ]; then
  skip "$ROOT/shared/.env exists — left untouched"
else
  install -m 600 deploy/env.production.example "$ROOT/shared/.env"
  ok "copied the template to $ROOT/shared/.env (0600) — fill it in"
fi

# ---------------------------------------------------------------------------
step "Installing the systemd unit"
# ---------------------------------------------------------------------------

if [ -f /etc/systemd/system/travel-crm.service ]; then
  skip "/etc/systemd/system/travel-crm.service exists — left untouched"
else
  sed "s/^User=deploy$/User=$SERVICE_USER/; s/^Group=deploy$/Group=$SERVICE_USER/" \
    deploy/travel-crm.service | sudo tee /etc/systemd/system/travel-crm.service > /dev/null
  sudo systemctl daemon-reload
  ok "installed, running as $SERVICE_USER (not enabled yet — there is nothing to start)"
fi

# The deploy script restarts the service. Rather than give the deploy user
# blanket sudo, allow exactly that one command.
SUDOERS=/etc/sudoers.d/travel-crm
if [ -f "$SUDOERS" ]; then
  skip "$SUDOERS exists — left untouched"
else
  echo "$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart travel-crm" \
    | sudo tee "$SUDOERS" > /dev/null
  sudo chmod 440 "$SUDOERS"
  # A malformed sudoers file can lock everyone out of sudo. Check it, and
  # remove it rather than leave a broken one in place.
  sudo visudo -cf "$SUDOERS" > /dev/null || { sudo rm -f "$SUDOERS"; fail "Generated sudoers rule was invalid and has been removed."; }
  ok "$SERVICE_USER may restart travel-crm without a password, and nothing else"
fi

# ---------------------------------------------------------------------------
step "Installing the nginx site for $DOMAIN"
# ---------------------------------------------------------------------------

if [ -f /etc/nginx/sites-available/travel-crm ]; then
  skip "/etc/nginx/sites-available/travel-crm exists — left untouched"
else
  sed "s/crm\.example\.com/$DOMAIN/g" deploy/nginx.conf \
    | sudo tee /etc/nginx/sites-available/travel-crm > /dev/null
  sudo ln -sfn /etc/nginx/sites-available/travel-crm /etc/nginx/sites-enabled/travel-crm
  # Hostinger images ship a default site that answers on port 80 and would
  # otherwise win the server_name match for a bare IP.
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t || fail "nginx rejected the configuration. Nothing has been reloaded."
  sudo systemctl reload nginx
  ok "installed and reloaded"
fi

# ---------------------------------------------------------------------------
printf '\n\033[1mWhat is left — in this order\033[0m\n\n'
# ---------------------------------------------------------------------------

cat <<EOF
  1. Create the database. The collation is not optional: the search filters
     rely on utf8mb4_unicode_ci being case-insensitive.

       sudo mysql
       CREATE DATABASE travel_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
       CREATE USER 'travel_crm'@'localhost' IDENTIFIED BY '<strong-password>';
       GRANT ALL PRIVILEGES ON travel_crm.* TO 'travel_crm'@'localhost';
       FLUSH PRIVILEGES;

  2. Fill in $ROOT/shared/.env — DATABASE_URL, AUTH_SECRET, AUTH_URL.

       openssl rand -base64 32        # AUTH_SECRET, a fresh one
       AUTH_URL="https://$DOMAIN"

  3. Point $DOMAIN at this server (an A record to its IPv4), wait for it to
     resolve, then get a certificate. HTTPS is not optional — session cookies
     are 'secure' in production, so over plain HTTP sign-in appears to succeed
     and every request after it is anonymous.

       sudo certbot --nginx -d $DOMAIN

  4. First deploy. There is no database to back up yet:

       SKIP_BACKUP=1 scripts/hostinger-deploy.sh

  5. Seed reference data and the first administrator, and CAPTURE THE PASSWORD
     it prints. It is stored as a bcrypt digest and is printed exactly once.

       cd $REPO_DIR && npm run db:seed

  6. Enable the service at boot, and verify:

       sudo systemctl enable travel-crm
       BASE_URL=https://$DOMAIN npm run smoke

  7. Schedule backups — nothing does this for you:

       crontab -e
       20 2 * * * cd $REPO_DIR && scripts/backup.sh /var/backups/travel-crm >> /var/log/travel-crm-backup.log 2>&1

     Then copy the archives off this machine. Hostinger's VPS snapshots restore
     the whole server, not one database, and a backup living only on the box
     that failed is not a backup.

  8. Firewall, if you have not already:

       sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
EOF
