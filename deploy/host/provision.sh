#!/usr/bin/env bash
# provision.sh: set up, or bring back in line, the HalalGoes production server. One command.
#
#   First run:  ./provision.sh <server public IPv4> --laptop-key <laptop WireGuard public key> \
#                              --email <where alerts go> [--ssh-key ~/.ssh/id_ed25519.pub] [--root-password]
#   Every run after that:  ./provision.sh
#
# What it does, in order:
#   1. installs the pinned Ansible collections into ./.collections;
#   2. creates the secrets the first time: an age key (if you have none), and the encrypted
#      host.sops.yaml and dev.sops.env in ~/.config/halalgoes/secrets, with random values;
#   3. writes inventory/hosts.yml from inventory/hosts.example.yml the first time;
#   4. if the server answers over WireGuard: runs site.yml over the tunnel and closes public SSH;
#      otherwise: creates the admin account as root if needed (bootstrap.yml), runs site.yml over
#      the public address with SSH still open (keys only), and writes your laptop's WireGuard
#      config to out/owner-laptop.conf. Bring that tunnel up and run this again: it locks down.
#
# Needs on this machine: ansible-core 2.19+, sops, age, openssl, ssh (and sshpass for
# --root-password). README.md, "Day 1", has the whole sequence.
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "provision: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

ip="" laptop_key="" email="" ssh_key="$HOME/.ssh/id_ed25519.pub" ask_pass=()
while [ $# -gt 0 ]; do
  case $1 in
    --laptop-key) laptop_key=$2; shift 2 ;;
    --email) email=$2; shift 2 ;;
    --ssh-key) ssh_key=$2; shift 2 ;;
    --root-password) ask_pass=(--ask-pass); shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) ip=$1; shift ;;
  esac
done

need ansible-playbook "Install ansible-core 2.19 or later (pipx install ansible-core)."
need sops "Install sops 3.9 or later (https://github.com/getsops/sops)."
need age-keygen "Install age (https://github.com/FiloSottile/age)."
need openssl "Install openssl."
[ ${#ask_pass[@]} -eq 0 ] || need sshpass "--root-password needs sshpass."

# ---------------------------------------------------------------- 1. collections
if [ ! -d .collections/ansible_collections/community/sops ]; then
  ansible-galaxy collection install -r requirements.yml -p ./.collections
fi

# ---------------------------------------------------------------- 2. secrets
secrets=${HALALGOES_SECRETS_DIR:-$HOME/.config/halalgoes/secrets}
age_key=${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}
mkdir -p "$secrets" && chmod 700 "$secrets"
if [ ! -f "$age_key" ]; then
  mkdir -p "$(dirname "$age_key")" && chmod 700 "$(dirname "$age_key")"
  age-keygen -o "$age_key" 2>/dev/null
  echo ">> Created your age key at $age_key. Copy that file into the offline password manager now:"
  echo "   without it nobody can decrypt the secrets."
fi
recipient=$(age-keygen -y "$age_key")
if [ ! -f "$secrets/.sops.yaml" ]; then
  printf 'creation_rules:\n  - path_regex: \\.sops\\.(yaml|env)$\n    age: %s\n' "$recipient" > "$secrets/.sops.yaml"
fi

rand() { openssl rand -base64 "${1:-33}" | tr -d '\n'; }
encrypt_new() { # encrypt_new <file> <type>: plaintext on stdin, encrypted file out
  local f=$1 type=$2 tmp
  tmp=$(mktemp "$secrets/.plain.XXXXXX")
  trap 'rm -f "$tmp"' RETURN
  cat > "$tmp"
  (cd "$secrets" && sops encrypt --filename-override "$(basename "$f")" \
     --input-type "$type" --output-type "$type" "$tmp" > "$f.new")
  mv "$f.new" "$f" && chmod 600 "$f"
}

if [ ! -f "$secrets/host.sops.yaml" ]; then
  console=$(rand 24 | tr -dc 'A-Za-z0-9' | head -c 28)
  encrypt_new "$secrets/host.sops.yaml" yaml <<YAML
hg_admin_console_password: "$console"
hg_admin_password_hash: '$(openssl passwd -6 "$console")'
hg_wg_private_keys:
  hg-prod: "$(rand 32)"
  hg-standby: "$(rand 32)"
hg_restic_password: "$(rand)"
hg_offline_restic_password: "$(rand)"
hg_pgbackrest_cipher_pass: "$(rand)"
hg_backup_silo_access_key: ""
hg_backup_silo_secret_key: ""
hg_alert_smtp_password: ""
hg_monitor_postgres_password: "$(rand 24 | tr -dc 'A-Za-z0-9')"
hg_standby_replication_password: "$(rand 24 | tr -dc 'A-Za-z0-9')"
hg_prod_silo_root_user: ""
hg_prod_silo_root_password: ""
hg_standby_silo_root_user: "hgstandby"
hg_standby_silo_root_password: "$(rand 24 | tr -dc 'A-Za-z0-9')"
YAML
  echo ">> Created $secrets/host.sops.yaml with random passwords. Copy the console password and"
  echo "   the three backup passwords into the offline password manager: sops decrypt $secrets/host.sops.yaml"
  echo "   Add the Resend key for alerts (hg_alert_smtp_password): sops edit $secrets/host.sops.yaml"
fi

if [ ! -f "$secrets/dev.sops.env" ]; then
  sed -e "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=$(rand 24 | tr -dc 'A-Za-z0-9')|" \
      -e "s|^REDIS_PASSWORD=$|REDIS_PASSWORD=$(rand 24 | tr -dc 'A-Za-z0-9')|" \
      -e "s|^MINIO_ROOT_PASSWORD=$|MINIO_ROOT_PASSWORD=$(rand 24 | tr -dc 'A-Za-z0-9')|" \
      -e "s|^HG_OTP_PEPPER=$|HG_OTP_PEPPER=$(rand 32)|" \
      -e "s|^HG_AUTH_SIGNING_KEY_SEED=$|HG_AUTH_SIGNING_KEY_SEED=$(rand 32)|" \
      -e "s|^HG_APP_DATA_KEY=$|HG_APP_DATA_KEY=$(rand 32)|" \
      -e '/^#/d' -e '/^$/d' secrets/dev.example.env | encrypt_new "$secrets/dev.sops.env" dotenv
  echo ">> Created $secrets/dev.sops.env. Add the TEST-mode keys: sops edit $secrets/dev.sops.env"
fi

# ---------------------------------------------------------------- 3. inventory
if [ ! -f inventory/hosts.yml ]; then
  [ -n "$ip" ] || die "first run: give the server's public IPv4 address"
  [ -n "$laptop_key" ] || die "first run: give --laptop-key, your laptop's WireGuard public key"
  [ -n "$email" ] || die "first run: give --email, where alerts are sent"
  [ -f "$ssh_key" ] || die "no SSH public key at $ssh_key (use --ssh-key)"
  esc() { printf '%s' "$1" | sed -e 's/[|&\\]/\\&/g'; }
  sed -e "s|__PUBLIC_IP__|$(esc "$ip")|" \
      -e "s|__LAPTOP_WG_PUBLIC_KEY__|$(esc "$laptop_key")|" \
      -e "s|__ADMIN_SSH_PUBLIC_KEY__|$(esc "$(tr -d '\n' < "$ssh_key")")|" \
      -e "s|__ALERT_EMAIL__|$(esc "$email")|" \
      -e "s|__OWNER_BACKUP_USER__|$(esc "$USER")|" \
      inventory/hosts.example.yml > inventory/hosts.yml
  echo ">> Wrote inventory/hosts.yml"
elif [ -n "$ip" ]; then
  sed -i "s|^\(\s*hg_public_ipv4:\).*|\1 $ip|" inventory/hosts.yml
fi

host_var() { ansible-inventory --host hg-prod 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }
wg_address=$(host_var hg_wg_address)
public_ip=$(host_var hg_public_ipv4)
admin=$(host_var ansible_user)
admin=${admin:-ops}

# ---------------------------------------------------------------- 4. the server
reachable() { ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$admin@$1" true 2>/dev/null; }

if reachable "$wg_address"; then
  echo ">> The server answers over WireGuard: full run, closing public SSH."
  ansible-playbook site.yml -e "ansible_host=$wg_address" -e hg_ssh_public=false
  echo
  echo ">> Done. Public SSH is closed; only WireGuard peers can log in."
else
  [ -n "$public_ip" ] || die "no public address in inventory/hosts.yml"
  if ! reachable "$public_ip"; then
    echo ">> Creating the admin account as root on $public_ip."
    ansible-playbook bootstrap.yml --limit hg-prod -e "ansible_host=$public_ip" -e ansible_user=root "${ask_pass[@]}"
  fi
  echo ">> Full run over the public address, SSH still open (keys only) until your tunnel works."
  ansible-playbook site.yml -e "ansible_host=$public_ip" -e hg_ssh_public=true
  echo
  echo ">> Next: put your laptop's WireGuard private key into out/owner-laptop.conf and bring it up"
  echo "   (sudo wg-quick up ./out/owner-laptop.conf, or import it into the WireGuard app),"
  echo "   then run ./provision.sh again. That run comes over the tunnel and closes public SSH."
fi
