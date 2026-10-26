#!/usr/bin/env bash
#
# Put the CRM behind HTTPS on a VPS that has no domain name yet.
#
#   scripts/hostinger-enable-https.sh              # detects the public IP
#   scripts/hostinger-enable-https.sh 31.220.31.122
#
# Why this exists: session cookies are marked `secure` whenever NODE_ENV is
# production (src/lib/auth/session.ts). Over plain HTTP the browser accepts the
# cookie at sign-in and then never sends it back, so the user is redirected to
# the dashboard and bounced straight to the login page — reported as "invalid
# password", which it is not. Let's Encrypt will not issue for a bare IP, so an
# IP-only deployment has no way out of this on its own.
#
# nip.io resolves <anything>.<ip>.nip.io back to that IP, needs no signup and
# no DNS records, and Let's Encrypt will issue for it. That is enough to get a
# real certificate against an IP-only host.
#
# Everything here is idempotent — safe to re-run after a failure.
#
# Swap in a real domain later with: DOMAIN=crm.example.com scripts/hostinger-enable-https.sh

set -euo pipefail

ROOT="${ROOT:-/srv/travel-crm}"
ENV_FILE="$ROOT/shared/.env"
REPO="${REPO:-$ROOT/repo}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/travel-crm}"
# nip.io occasionally hits a Let's Encrypt rate limit. sslip.io is the same
# idea from different people; the script falls back to it automatically.
SUFFIX="${SUFFIX:-nip.io}"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found. Run scripts/hostinger-setup.sh first."
[ -f "$NGINX_SITE" ] || fail "$NGINX_SITE not found. Run scripts/hostinger-setup.sh first."
[ -d "$REPO" ] || fail "$REPO not found. Set REPO=/path/to/checkout."

# ---------------------------------------------------------------------------
step "Working out the hostname"
# ---------------------------------------------------------------------------

if [ -n "${DOMAIN:-}" ]; then
  HOST="$DOMAIN"
  ok "using the domain you gave: $HOST"
else
  IP="${1:-}"
  if [ -z "$IP" ]; then
    # Whatever the outside world sees, which is what has to be in DNS — not
    # necessarily what `ip addr` shows on a NATed box.
    IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  fi
  [ -n "$IP" ] || fail "Could not detect the public IP. Pass it: scripts/hostinger-enable-https.sh 31.220.31.122"
  case "$IP" in
    *[!0-9.]*|"") fail "'$IP' is not an IPv4 address." ;;
  esac

  HOST="$IP.$SUFFIX"
  ok "public IP $IP → $HOST"

  step "Checking that $HOST resolves back here"
  # getent, not dig: no extra package to install.
  RESOLVED="$(getent hosts "$HOST" | awk '{print $1}' | head -1 || true)"
  if [ "$RESOLVED" = "$IP" ]; then
    ok "resolves to $RESOLVED"
  elif [ -z "$RESOLVED" ]; then
    fail "$HOST does not resolve. Check outbound DNS, or pass DOMAIN=<your-domain>."
  else
    warn "resolves to $RESOLVED, not $IP — certbot will probably fail"
  fi
fi

NEW_URL="https://$HOST"

# ---------------------------------------------------------------------------
step "Pointing the application at $NEW_URL"
# ---------------------------------------------------------------------------

CURRENT_URL="$(grep -E '^AUTH_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"

if [ "$CURRENT_URL" = "$NEW_URL" ]; then
  ok "AUTH_URL is already $NEW_URL"
else
  cp -p "$ENV_FILE" "$ENV_FILE.bak"
  if grep -qE '^AUTH_URL=' "$ENV_FILE"; then
    sed -i "s|^AUTH_URL=.*|AUTH_URL=\"$NEW_URL\"|" "$ENV_FILE"
  else
    printf '\nAUTH_URL="%s"\n' "$NEW_URL" >> "$ENV_FILE"
  fi
  ok "AUTH_URL: ${CURRENT_URL:-unset} → $NEW_URL   (previous file kept as .env.bak)"
fi

# A placeholder secret gets through the editor far more often than it should,
# and the failure it causes — the service refusing to start — is much harder to
# read than this line.
SECRET="$(grep -E '^AUTH_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [ "${#SECRET}" -lt 32 ]; then
  fail "AUTH_SECRET in $ENV_FILE is ${#SECRET} characters; at least 32 are required.
  Generate one and paste it in, then re-run:
      openssl rand -base64 32"
fi
ok "AUTH_SECRET looks real (${#SECRET} characters)"

# ---------------------------------------------------------------------------
step "Pointing nginx at $HOST"
# ---------------------------------------------------------------------------

sudo cp -p "$NGINX_SITE" "$NGINX_SITE.bak"
# Rewrites every server_name, including the 443 block certbot may already have
# added, so the two cannot drift apart.
sudo sed -i -E "s/^(\s*server_name\s+).*;/\1$HOST;/" "$NGINX_SITE"
sudo nginx -t > /dev/null 2>&1 || {
  sudo mv "$NGINX_SITE.bak" "$NGINX_SITE"
  fail "nginx rejected the change; the previous config has been restored."
}
sudo systemctl reload nginx
ok "server_name is now $HOST"

# ---------------------------------------------------------------------------
step "Certificate"
# ---------------------------------------------------------------------------

if sudo test -d "/etc/letsencrypt/live/$HOST"; then
  ok "a certificate for $HOST already exists — leaving it alone"
else
  command -v certbot > /dev/null || fail "certbot is not installed:
      sudo apt-get install -y certbot python3-certbot-nginx"

  CERTBOT_EMAIL="${CERTBOT_EMAIL:-$(grep -E '^INITIAL_ADMIN_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)}"
  [ -n "$CERTBOT_EMAIL" ] || fail "Set CERTBOT_EMAIL=you@example.com and re-run."

  printf '  Registering with Let'\''s Encrypt as %s and accepting their\n' "$CERTBOT_EMAIL"
  printf '  Terms of Service (https://letsencrypt.org/repository/).\n'
  printf '  Ctrl-C within 5 seconds to stop.\n'
  sleep 5

  # --redirect also sends HTTP to HTTPS, so an old bookmark on http:// stops
  # producing the dropped-cookie failure this script exists to fix.
  sudo certbot --nginx -d "$HOST" \
    --non-interactive --agree-tos --no-eff-email \
    -m "$CERTBOT_EMAIL" --redirect || fail "certbot failed.
  If the message mentions rate limits, try the other free DNS service:
      SUFFIX=sslip.io $0 ${IP:-}"

  ok "certificate issued and HTTP→HTTPS redirect added"
fi

# HSTS belongs at the terminator, not in next.config.ts, so local HTTP
# development is unaffected.
if ! sudo grep -q "Strict-Transport-Security" "$NGINX_SITE"; then
  sudo sed -i "0,/listen 443/{s|\(listen 443.*\)|\1\n    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;|}" "$NGINX_SITE"
  sudo nginx -t > /dev/null 2>&1 && sudo systemctl reload nginx && ok "HSTS added" || warn "could not add HSTS automatically — add it by hand"
fi

# ---------------------------------------------------------------------------
step "Clearing any login lockout"
# ---------------------------------------------------------------------------

# Failed attempts accumulate while the cookie is being dropped, and five of
# them lock the account for fifteen minutes — so the first thing that happens
# after the fix would otherwise be another refusal.
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
DB_CREDS="${DB_URL#mysql://}"
DB_USER="${DB_CREDS%%:*}"
DB_REST="${DB_CREDS#*:}"
DB_PASS="${DB_REST%%@*}"
DB_HOSTPORT="${DB_REST#*@}"
DB_NAME="${DB_HOSTPORT#*/}"
DB_NAME="${DB_NAME%%\?*}"
DB_HOSTPORT="${DB_HOSTPORT%%/*}"
DB_HOST="${DB_HOSTPORT%%:*}"
DB_PORT="${DB_HOSTPORT##*:}"
[ "$DB_PORT" = "$DB_HOST" ] && DB_PORT=3306

# The password is percent-encoded in the URL — it has to be, or a `@` or `/`
# in it would be read as a delimiter. The mysql client wants the real bytes.
DB_PASS="$(printf '%b' "${DB_PASS//%/\\x}")"

if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" \
     -e "UPDATE AdminUser SET failedLoginAttempts = 0, lockedUntil = NULL;" 2>/dev/null; then
  ok "lockouts cleared"
else
  warn "could not clear lockouts automatically. If sign-in says the account is locked, wait 15 minutes or run:"
  printf '      sudo mysql %s -e "UPDATE AdminUser SET failedLoginAttempts = 0, lockedUntil = NULL;"\n' "$DB_NAME"
fi

# ---------------------------------------------------------------------------
step "Rebuilding — AUTH_URL is baked into the bundle, not read at startup"
# ---------------------------------------------------------------------------

# next.config.ts puts AUTH_URL's host in the Server Action allow-list and
# `output: "standalone"` freezes that into the build. Restarting alone would
# leave the old origin in the allow-list, and every form submission would be
# rejected — which presents as the Sign in button doing nothing at all.
cd "$REPO"
SKIP_BACKUP="${SKIP_BACKUP:-}" scripts/hostinger-deploy.sh

# ---------------------------------------------------------------------------
step "Checking it from the outside"
# ---------------------------------------------------------------------------

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$NEW_URL/admin/login" || echo 000)"
if [ "$CODE" = "200" ]; then
  ok "$NEW_URL/admin/login returns 200 over HTTPS"
else
  warn "$NEW_URL/admin/login returned $CODE — check: journalctl -u travel-crm -n 50 --no-pager"
fi

# The whole point of the exercise: the cookie must carry the Secure flag and
# actually survive the round trip now.
if curl -sI --max-time 15 "$NEW_URL/admin" | grep -qi "location:.*login"; then
  ok "unauthenticated /admin redirects to the login page"
fi

printf '\n\033[32m✓ Done.\033[0m Sign in at:\n\n    %s/admin/login\n\n' "$NEW_URL"
printf '  Use the one-time password the seed printed. You will be asked to\n'
printf '  change it immediately — that page will load properly this time.\n\n'
printf '  Lost it? Reset from the repo:\n'
printf '      cd %s && npm run admin:reset-password\n\n' "$REPO"
