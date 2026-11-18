#!/usr/bin/env bash
# Installs the phr deploy kit on hetzner-prod from a checkout of this repo.
#
#   ./deploy/install.sh            tool files into /opt/phr-deploy (as jake)
#   sudo ./deploy/install.sh --system   also systemd timers, /etc/phr, backup dir
#
# After the first install, prod deploys keep bin/, lib/ and compose/ up to date
# themselves (self_update in phr-deploy); --system is only needed when
# systemd/ or config/ change.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/opt/phr-deploy
OWNER=${PHR_OWNER:-jake}

install -d -o "$OWNER" -g "$OWNER" "$DEST" "$DEST/bin" "$DEST/lib" "$DEST/compose" "$DEST/systemd" "$DEST/state" "$DEST/previews"
install -o "$OWNER" -g "$OWNER" -m 755 "$SRC"/bin/* "$DEST/bin/"
install -o "$OWNER" -g "$OWNER" -m 644 "$SRC"/lib/* "$DEST/lib/"
install -o "$OWNER" -g "$OWNER" -m 644 "$SRC"/compose/* "$DEST/compose/"
install -o "$OWNER" -g "$OWNER" -m 644 "$SRC"/systemd/* "$DEST/systemd/"
install -o "$OWNER" -g "$OWNER" -m 755 "$SRC/install.sh" "$DEST/install.sh"
echo "tool installed in $DEST"

if [ "${1:-}" = --system ]; then
  [ "$(id -u)" = 0 ] || { echo "--system needs sudo" >&2; exit 1; }
  install -d -m 750 -o root -g "$OWNER" /etc/phr
  for f in backup monitor; do
    [ -f /etc/phr/$f.env ] || install -m 640 -o root -g "$OWNER" "$SRC/config/$f.env.example" /etc/phr/$f.env
  done
  install -d -m 700 -o "$OWNER" -g "$OWNER" /var/backups/phr
  install -m 644 "$SRC"/systemd/* /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now phr-backup@prod.timer phr-backup@dev.timer phr-monitor.timer
  systemctl list-timers 'phr-*' --no-pager
fi
