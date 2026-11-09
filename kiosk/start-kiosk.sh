#!/usr/bin/env bash
# start-kiosk.sh — launched automatically when the Pi's desktop starts.
# Keeps the kiosk app running: if it ever exits or crashes, it starts again.
# Output goes to logs/kiosk.log (last ~5 MB kept).

KIOSK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$KIOSK_DIR/logs"
LOG_FILE="$LOG_DIR/kiosk.log"
mkdir -p "$LOG_DIR"
cd "$KIOSK_DIR" || exit 1

# Only one copy of this script may run (it can be started from two autostart files).
exec 9>"$LOG_DIR/.start-kiosk.lock"
flock -n 9 || exit 0

# Hide the mouse pointer on touch screens if 'unclutter' is installed (X11 only).
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 -root >/dev/null 2>&1 &

# Wayland (Raspberry Pi OS Bookworm) or X11 — let Electron pick automatically.
ELECTRON_FLAGS="--ozone-platform-hint=auto"

while true; do
  # Simple log rotation
  if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE")" -gt 5000000 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi

  echo "===== $(date '+%Y-%m-%d %H:%M:%S') starting kiosk =====" >> "$LOG_FILE"
  ./node_modules/.bin/electron . $ELECTRON_FLAGS >> "$LOG_FILE" 2>&1
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') kiosk exited (code $?) — restarting in 5s =====" >> "$LOG_FILE"
  sleep 5
done
