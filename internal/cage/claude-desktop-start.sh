#!/usr/bin/env bash
set -euo pipefail
if systemctl is-active --quiet cage-claude-desktop.service; then
  test -f /run/cage-desktop/keyring-ready || { echo 'Save and close the existing Claude Desktop first, then reopen it with your Cage account.' >&2; exit 1; }
  exit 0
fi
if systemctl is-failed --quiet cage-claude-desktop.service; then
  sudo systemctl reset-failed cage-claude-desktop.service
fi
sudo systemctl start --no-block cage-claude-desktop.service
for i in $(seq 1 150); do
  if [ -p /run/cage-desktop/unlock ]; then break; fi
  if systemctl is-failed --quiet cage-claude-desktop.service; then
    echo 'The graphical session could not start.' >&2; exit 1
  fi
  sleep .1
done
test -p /run/cage-desktop/unlock || { echo 'Timed out waiting for the credentials unlock channel.' >&2; exit 1; }
# The internal random key comes exclusively from SSH stdin, never argv or disk.
timeout 10 sh -c 'cat > /run/cage-desktop/unlock'
for i in $(seq 1 300); do
  if systemctl is-active --quiet cage-claude-desktop.service; then exit 0; fi
  if systemctl is-failed --quiet cage-claude-desktop.service; then
    echo 'Claude Desktop could not start or the keyring could not be unlocked. Existing sign-in data is unchanged.' >&2; exit 1
  fi
  sleep .1
done
echo 'Claude Desktop timed out starting.' >&2
exit 1
