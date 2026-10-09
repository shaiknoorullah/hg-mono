#!/usr/bin/env bash
# provision-current.sh: set up, or bring back in line, the server running today (current.yml).
#   ./provision-current.sh [ansible-playbook options]     e.g. --check --diff, --tags base,firewall
# Creates, the first time and never printing a value: the age key (~/.config/halalgoes/age.key) and
# the encrypted host secrets (~/.config/halalgoes/secrets/host.sops.yaml). Then runs current.yml.
set -euo pipefail
cd "$(dirname "$0")"
die() { echo "provision-current: $*" >&2; exit 1; }
for c in ansible-playbook ansible-galaxy sops age-keygen openssl wg; do command -v "$c" >/dev/null || die "$c is not installed"; done

export ANSIBLE_COLLECTIONS_PATH=${ANSIBLE_COLLECTIONS_PATH:-$PWD/.collections}
[ -d "$ANSIBLE_COLLECTIONS_PATH/ansible_collections/community/sops" ] || \
  ansible-galaxy collection install -r requirements.yml -p "$ANSIBLE_COLLECTIONS_PATH"

home=${HALALGOES_CONFIG_DIR:-$HOME/.config/halalgoes}
export SOPS_AGE_KEY_FILE=${SOPS_AGE_KEY_FILE:-$home/age.key}
secrets=${HALALGOES_SECRETS_DIR:-$home/secrets}
export HALALGOES_SECRETS_DIR=$secrets
mkdir -p "$secrets" && chmod 700 "$home" "$secrets"
if [ ! -f "$SOPS_AGE_KEY_FILE" ]; then
  age-keygen -o "$SOPS_AGE_KEY_FILE" 2>/dev/null && chmod 600 "$SOPS_AGE_KEY_FILE"
  echo ">> Created the age key at $SOPS_AGE_KEY_FILE. Copy it into the offline password manager now: without it the secrets cannot be decrypted."
fi
if [ ! -f "$secrets/.sops.yaml" ]; then
  printf 'creation_rules:\n  - path_regex: \\.sops\\.(yaml|env)$\n    age: %s\n' "$(age-keygen -y "$SOPS_AGE_KEY_FILE")" > "$secrets/.sops.yaml"
fi
if [ ! -f "$secrets/host.sops.yaml" ]; then
  console=$(openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c 28)
  tmp=$(mktemp "$secrets/.plain.XXXXXX"); trap 'rm -f "$tmp"' EXIT
  cat > "$tmp" <<YAML
hg_admin_console_password: "$console"
hg_admin_password_hash: '$(openssl passwd -6 -stdin <<<"$console")'
hg_wg_private_keys:
  hg-prod: "$(wg genkey)"
hg_alert_smtp_password: ""
YAML
  (cd "$secrets" && sops encrypt --filename-override host.sops.yaml --input-type yaml --output-type yaml "$tmp" > host.sops.yaml.new)
  mv "$secrets/host.sops.yaml.new" "$secrets/host.sops.yaml" && chmod 600 "$secrets/host.sops.yaml"
  echo ">> Created $secrets/host.sops.yaml. Copy the console password (sops decrypt) into the password manager."
  echo "   Add the Resend key later: sops edit $secrets/host.sops.yaml  (hg_alert_smtp_password)"
fi
exec ansible-playbook -i inventory/current.yml current.yml "$@"
