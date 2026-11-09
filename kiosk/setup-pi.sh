#!/usr/bin/env bash
# setup-pi.sh — run ONCE on a new Raspberry Pi (Raspberry Pi OS with desktop).
#
#   cd ~/kiosk
#   bash setup-pi.sh
#   sudo reboot
#
# What it does:
#   1. Installs Node.js 20 (if missing) and the printing tools (CUPS).
#   2. Installs the kiosk app's packages.
#   3. Makes the Pi log straight into the desktop on boot (no password).
#   4. Turns off screen blanking.
#   5. Starts the kiosk automatically every time the desktop starts.
set -e

KIOSK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 Kiosk folder: $KIOSK_DIR"

# ---------- 1. Node.js + CUPS ----------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "⬇️  Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "✅ Node.js $(node -v) already installed"
fi

echo "⬇️  Installing printing + scanning tools (CUPS, SANE)..."
sudo apt-get install -y cups cups-client sane-utils unclutter || sudo apt-get install -y cups cups-client sane-utils
sudo usermod -aG scanner "$USER" || true
sudo usermod -aG lpadmin "$USER" || true

# ---------- 2. App packages ----------
echo "⬇️  Installing kiosk packages (this can take a few minutes)..."
cd "$KIOSK_DIR"
if [ -f package-lock.json ]; then npm ci --omit=dev || npm install --omit=dev; else npm install --omit=dev; fi

chmod +x "$KIOSK_DIR/start-kiosk.sh"
mkdir -p "$KIOSK_DIR/logs"

# ---------- 3 + 4. Auto-login to desktop, no screen blanking ----------
if command -v raspi-config >/dev/null 2>&1; then
  echo "⚙️  Enabling desktop auto-login..."
  sudo raspi-config nonint do_boot_behaviour B4 || echo "⚠️  Could not set auto-login — do it in raspi-config → System Options → Boot / Auto Login"
  echo "⚙️  Disabling screen blanking..."
  sudo raspi-config nonint do_blanking 1 || echo "⚠️  Could not disable blanking — do it in raspi-config → Display Options"
else
  echo "⚠️  raspi-config not found — set desktop auto-login and disable screen blanking manually."
fi

# ---------- 5. Autostart ----------
AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/snapprints-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=SnapPrints Kiosk
Comment=Starts the SnapPrints kiosk on login
Exec=$KIOSK_DIR/start-kiosk.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
echo "✅ Autostart entry created: $AUTOSTART_DIR/snapprints-kiosk.desktop"

# labwc (newer Raspberry Pi OS) also reads its own autostart file — add the
# kiosk there too, once, as a fallback.
LABWC_AUTOSTART="$HOME/.config/labwc/autostart"
if [ -d /etc/xdg/labwc ] || [ -d "$HOME/.config/labwc" ]; then
  mkdir -p "$HOME/.config/labwc"
  if [ -f /etc/xdg/labwc/autostart ] && [ ! -f "$LABWC_AUTOSTART" ]; then
    cp /etc/xdg/labwc/autostart "$LABWC_AUTOSTART"   # keep the desktop's normal start-up items
  fi
  touch "$LABWC_AUTOSTART"
  if ! grep -q "start-kiosk.sh" "$LABWC_AUTOSTART"; then
    # start-kiosk.sh exits by itself if it is already running.
    echo "$KIOSK_DIR/start-kiosk.sh &" >> "$LABWC_AUTOSTART"
  fi
fi

cat <<EOF

✅ Setup finished.

Next:
  1. Add the printer: open http://localhost:631 on the Pi (or Preferences → Print Settings),
     add it, and set it as the DEFAULT printer.
  2. Create the machine (SPK…) in the admin panel and copy its SETUP CODE into
     config.json:   { "API_BASE": "https://<backend>/api", "SETUP_CODE": "ABCD-EFGH" }
  3. Photocopy / scan orders: connect a multifunction printer and check that
     "scanimage -L" lists it.
  4. sudo reboot   → the kiosk opens by itself and registers this Pi.

Logs: $KIOSK_DIR/logs/kiosk.log     (tail -f $KIOSK_DIR/logs/kiosk.log)
EOF
