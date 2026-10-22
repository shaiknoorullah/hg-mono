#!/usr/bin/env bash
# What the device can say about a process having been killed, saved after the flows have run.
#
# A design capture's `uiautomator dump` has been killed on the CI emulator: the device's shell
# reports `Killed` and `rc=137`. That is SIGKILL, and it names the signal, not the sender
# (https://github.com/shaiknoorullah/hg-mono/issues/1026). The three candidates leave their traces in
# different places, so all three are collected:
#
#   - the userspace low-memory killer (lmkd) and ActivityManager's own kills → logcat, system buffer;
#   - the kernel's OOM killer                                               → dmesg, which needs root;
#   - anything to do with the automation connection                        → logcat, main buffer.
#
# `run.sh` keeps only `ReactNativeJS:V AndroidRuntime:E '*:S'`, so none of these lines survives an
# ordinary run. This is why "it was killed" could not be turned into "X killed it".
#
# Runs AFTER the flows, never during: `adb root` restarts adbd, which would drop Maestro's
# connection mid-journey. Never fails the job — it is evidence, not a step.
set -uo pipefail

out="${E2E_OUT:-e2e-out}/logs"
mkdir -p "$out"
file="$out/kill-evidence.txt"

{
  echo "=== free memory, as the device sees it now ==="
  adb shell cat /proc/meminfo 2>&1 | head -4

  echo
  echo "=== logcat: kills, memory pressure, and the automation connection ==="
  # -d drains what is buffered and exits. The buffers hold a bounded history, so a kill early in a
  # long run may already have scrolled away; that is a reason to read "(nothing)" as "not found
  # here", never as "did not happen".
  adb logcat -d -b main,system,events 2>&1 |
    grep -iE 'lowmemorykiller|lmkd|am_kill|killing|out of memory|oom|uiautomat|UiAutomation' |
    tail -80 || echo '(nothing matched)'

  echo
  echo "=== dmesg: the kernel's own OOM killer ==="
  if adb root >/dev/null 2>&1; then
    adb wait-for-device
    adb shell dmesg 2>&1 | grep -iE 'out of memory|killed process|oom-kill' | tail -40 || echo '(nothing matched)'
    adb unroot >/dev/null 2>&1 || true
    adb wait-for-device
  else
    echo '(adb root was refused, so the kernel log could not be read)'
  fi
  echo
  echo "=== the same dump, now that the flows are over and Maestro is not driving ==="
  # The controlled half of the question. During a flow the dump is killed; here nothing else holds
  # the device. Succeeds here and fails during → something about a flow being in progress, and the
  # automation connection is the candidate, since Maestro's driver holds UiAutomation throughout.
  # Fails here too → the dump is broken on this image regardless, and the flows are a red herring.
  after=$(adb shell 'uiautomator dump /sdcard/hg-after-flows.xml 2>&1; echo "rc=$?"' 2>&1)
  echo "$after"
  case "$after" in
    *"dumped to"*) echo "VERDICT: the dump works when no flow is running." ;;
    *) echo "VERDICT: the dump fails even with nothing else driving the device." ;;
  esac
} >"$file" 2>&1 || true

# Into the job log as well as the artifact. The artifact is ~28 MB and downloading it to read a few
# lines has taken minutes and sometimes failed outright, while `gh run view --log | grep` answers in
# seconds. Evidence nobody can read quickly does not get read.
echo "kill-evidence: wrote $file"
cat "$file"
