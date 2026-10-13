#!/usr/bin/env bash
# Add a machine as a HalalGoes self-hosted GitHub Actions runner, sandboxed. The OWNER runs this
# once per machine, as the user the runner should run as (never root).
#
#   scripts/ci/setup-self-hosted-runner.sh [--name NAME] [--labels LIST] [--repo OWNER/NAME]
#                                          [--version X.Y.Z] [--memory-max SIZE]
#
# What it does:
#   1. Downloads the runner (latest release, or --version) into ~/actions-runner/NAME and checks
#      its SHA-256 against the one in that release's notes. A mismatch stops everything.
#   2. Gets a registration token from GitHub with gh and registers the runner with the labels
#      in LIST (default: hg,laptop; GitHub adds self-hosted, Linux and X64). The token is never
#      printed and never put on a command line: config.sh reads it from its environment.
#   3. Writes the systemd user unit ~/.config/systemd/user/hg-actions-runner.service, with the
#      workstation's settings: low priority (Nice=10, CPUWeight=50, MemoryMax, default 6G),
#      Restart=always, and the sandbox (your home hidden behind a tmpfs, only ~/actions-runner
#      visible, HOME and caches under it, private /tmp and user namespace, no new privileges).
#   4. Starts it, then checks the sandbox from inside the running service: your home (a canary
#      file and ~/.ssh) must be invisible, the runner folder visible. If a check fails, it stops
#      the runner again and says why.
#
# Run it again on a configured machine and it skips 1 and 2 and only rewrites and checks the unit.
# Needs: Linux (x64 or arm64), bash, curl, tar, sha256sum, systemd (user manager), nsenter
# (util-linux), gh signed in with admin rights on the repo. Docker for jobs with containers.
# Docs: docs/ci/self-hosted-runners.md

set -euo pipefail
umask 077

NAME="hg-laptop"
LABELS="hg,laptop"
REPO=""
VERSION=""
MEMORY_MAX="6G"
UNIT="hg-actions-runner.service"

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }
say() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:?--name needs a value}"; shift 2 ;;
    --labels) LABELS="${2:?--labels needs a comma-separated list}"; shift 2 ;;
    --repo) REPO="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --version) VERSION="${2:?--version needs X.Y.Z}"; VERSION="${VERSION#v}"; shift 2 ;;
    --memory-max) MEMORY_MAX="${2:?--memory-max needs a size, e.g. 6G}"; shift 2 ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

case "$NAME" in *[!A-Za-z0-9._-]*|'') die "--name may use letters, digits, '.', '_' and '-' only" ;; esac
case "$LABELS" in *[!A-Za-z0-9.,_-]*|'') die "--labels is a comma-separated list of plain words" ;; esac
case "$MEMORY_MAX" in *[!0-9KMGT%]*|'') die "--memory-max is a systemd size, e.g. 6G" ;; esac

# ---------------------------------------------------------------------------------- checks
[ "$(id -u)" -ne 0 ] || die "run this as the user the runner should run as, not as root"
[ "$(uname -s)" = Linux ] || die "this script sets up Linux runners only"
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
for tool in curl tar sha256sum gh systemctl nsenter; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done
gh auth status >/dev/null 2>&1 || die "gh is not signed in (run: gh auth login)"
systemctl --user show-environment >/dev/null 2>&1 || die "no systemd user manager for $(id -un)"
if ! command -v docker >/dev/null; then
  warn "docker is not installed: jobs with service containers or testcontainers (migrations, Go tests, coverage) will fail here"
elif ! docker info >/dev/null 2>&1; then
  warn "docker is installed but $(id -un) cannot reach it (not in the docker group, or the daemon is down)"
fi
[ -e /dev/kvm ] || say "no /dev/kvm here: this machine cannot run Android emulator jobs"

[ -n "$REPO" ] || REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
[ -n "$REPO" ] || REPO="shaiknoorullah/hg-mono"
case "$REPO" in */*) ;; *) die "--repo must be OWNER/NAME" ;; esac

ROOT="$HOME/actions-runner"          # the only part of $HOME the sandbox shows the runner
DIR="$ROOT/$NAME"
RUNNER_HOME="$ROOT/home"             # HOME for jobs: their caches land here, not in yours
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$DIR" "$RUNNER_HOME/.cache" "$UNIT_DIR"

# ---------------------------------------------------------------- 1. download and verify
if [ -f "$DIR/.runner" ]; then
  say "$DIR is already a configured runner; skipping download and registration"
else
  if [ -z "$VERSION" ]; then
    VERSION="$(gh api repos/actions/runner/releases/latest --jq .tag_name)"
    VERSION="${VERSION#v}"
  fi
  case "$VERSION" in *[!0-9.]*|'') die "unexpected runner version: $VERSION" ;; esac
  TARBALL="actions-runner-linux-$ARCH-$VERSION.tar.gz"
  say "runner $VERSION ($TARBALL) for $REPO, into $DIR"

  # The release notes list each package's SHA-256 between <!-- BEGIN SHA linux-x64 --> markers.
  NOTES="$(gh api "repos/actions/runner/releases/tags/v$VERSION" --jq .body)"
  SHA="$(printf '%s\n' "$NOTES" | sed -n "s/.*<!-- BEGIN SHA linux-$ARCH -->\([0-9a-f]\{64\}\)<!-- END SHA linux-$ARCH -->.*/\1/p" | head -n 1)"
  [ -n "$SHA" ] || die "no SHA-256 for linux-$ARCH in the v$VERSION release notes; not installing an unverified runner"

  TMP="$(mktemp -d "$ROOT/.download.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 3 -o "$TMP/$TARBALL" "https://github.com/actions/runner/releases/download/v$VERSION/$TARBALL"
  printf '%s  %s\n' "$SHA" "$TMP/$TARBALL" | sha256sum -c --quiet - || die "SHA-256 mismatch for $TARBALL; not installing it"
  say "SHA-256 verified: $SHA"
  tar -xzf "$TMP/$TARBALL" -C "$DIR"

  # ------------------------------------------------------------------------ 2. register
  # Repo admin only. Read into a variable, handed to config.sh through its environment
  # (ACTIONS_RUNNER_INPUT_TOKEN), so it never shows up in a process list or the terminal.
  TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  [ -n "$TOKEN" ] || die "could not get a registration token (do you have admin rights on $REPO?)"
  say "registering $NAME with labels self-hosted,Linux,${ARCH^^},$LABELS"
  (cd "$DIR" && ACTIONS_RUNNER_INPUT_TOKEN="$TOKEN" ./config.sh --unattended \
      --url "https://github.com/$REPO" --name "$NAME" --labels "$LABELS" --work _work)
  unset TOKEN
fi

# ------------------------------------------------------------------- 3. the systemd unit
# Same settings as the workstation's live unit, plus PrivateUsers=yes. Keep the two in step.
say "writing $UNIT_DIR/$UNIT"
cat > "$UNIT_DIR/$UNIT" <<EOF
[Unit]
Description=GitHub Actions self-hosted runner for HalalGoes ($NAME)
After=network-online.target

[Service]
WorkingDirectory=%h/actions-runner/$NAME
ExecStart=%h/actions-runner/$NAME/run.sh
Restart=always
RestartSec=15
Nice=10
CPUWeight=50
MemoryMax=$MEMORY_MAX
# Sandbox: CI jobs run PR code, so hide the owner's home (SSH keys, gh and
# Claude credentials, browser profiles) and give the runner only its own folder.
ProtectHome=tmpfs
BindPaths=%h/actions-runner
Environment=HOME=%h/actions-runner/home
Environment=XDG_CACHE_HOME=%h/actions-runner/home/.cache
PrivateTmp=yes
PrivateUsers=yes
NoNewPrivileges=yes
KillMode=mixed
KillSignal=SIGINT
TimeoutStopSec=60

[Install]
WantedBy=default.target
EOF

# Without lingering, a user's services stop at logout and do not start at boot.
if [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" != yes ]; then
  loginctl enable-linger "$(id -un)" || warn "could not enable lingering; the runner stops when you log out (run: sudo loginctl enable-linger $(id -un))"
fi

systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null
systemctl --user restart "$UNIT"

# --------------------------------------------------------------------- 4. check the sandbox
# A canary in the real home, then a look from inside the running service's namespaces, which
# is what every job step inherits.
CANARY="$HOME/.hg-runner-sandbox-canary"
: > "$CANARY"
trap 'rm -f "$CANARY"; [ -z "${TMP:-}" ] || rm -rf "$TMP"' EXIT

PID=""
for _ in $(seq 1 20); do
  PID="$(systemctl --user show "$UNIT" --property=MainPID --value)"
  [ -n "$PID" ] && [ "$PID" != 0 ] && break
  sleep 1
done
[ -n "$PID" ] && [ "$PID" != 0 ] || die "$UNIT did not start; see: journalctl --user -u $UNIT"

inside() { nsenter --target "$PID" --user --mount --preserve-credentials -- "$@"; }
fail=0
if inside test -e "$CANARY"; then
  printf 'sandbox: FAIL  your home is visible to jobs (%s)\n' "$CANARY"; fail=1
else
  printf 'sandbox: ok    your home is hidden from jobs\n'
fi
if inside test -e "$HOME/.ssh"; then
  printf 'sandbox: FAIL  %s is visible to jobs\n' "$HOME/.ssh"; fail=1
else
  printf 'sandbox: ok    ~/.ssh is hidden from jobs\n'
fi
if inside test -x "$DIR/run.sh"; then
  printf 'sandbox: ok    the runner folder is visible to jobs\n'
else
  printf 'sandbox: FAIL  the runner cannot see its own folder (%s)\n' "$DIR"; fail=1
fi
if [ "$fail" -ne 0 ]; then
  systemctl --user stop "$UNIT"
  die "the sandbox is not working, so the runner is stopped. Check that unprivileged user namespaces are enabled, then run this again."
fi

say "done: $NAME is running. Status: systemctl --user status $UNIT · logs: journalctl --user -u $UNIT -f"
say "it takes jobs only while the repository variable HG_RUNS_ON is set (docs/ci/self-hosted-runners.md)"
