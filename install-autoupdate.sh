#!/usr/bin/env bash
# Enables the daily rclone auto-update. Run from inside the syncdeck folder.
set -e
sudo install -m 755 deploy/rclone-autoupdate.sh /usr/local/sbin/rclone-autoupdate.sh
sudo cp deploy/rclone-autoupdate.service deploy/rclone-autoupdate.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-autoupdate.timer
sudo systemctl start rclone-autoupdate.service
echo "--- first run result ---"
journalctl -u rclone-autoupdate.service -n 15 --no-pager
echo "Next runs: systemctl list-timers rclone-autoupdate.timer"
