#!/usr/bin/env bash
# The checks that need no server: every playbook's syntax, ansible-lint (production
# profile), and shellcheck on every script. tests/inventory.yml is never a real server.
#   deploy/host/tests/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ansible-galaxy collection install -r requirements.yml -p ./.collections >/dev/null
for playbook in site.yml bootstrap.yml standby.yml offline.yml; do
  ansible-playbook -i tests/inventory.yml --syntax-check "$playbook"
done
ANSIBLE_INVENTORY=tests/inventory.yml ansible-lint
shellcheck -x provision.sh tests/check.sh roles/*/files/hg-*
echo "all checks passed"
