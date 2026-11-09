# SnapPrints Kiosk (Raspberry Pi)

## First-time setup on a new Pi

1. Install **Raspberry Pi OS with desktop**, connect it to the internet, and connect the printer by USB.
2. Copy this folder to the Pi as `~/kiosk` (any user works; it doesn't have to be `pi`).
3. In a terminal:
   ```bash
   cd ~/kiosk
   bash setup-pi.sh
   ```
4. Add the printer in CUPS (`http://localhost:631` on the Pi, or Preferences → Print Settings) and make it the **default** printer.
5. In the admin panel create a **Kiosk** machine (SPK…). Copy its **setup code** into `config.json` (see `config.example.json`):
   ```json
   { "API_BASE": "https://<your-backend>/api", "SETUP_CODE": "ABCD-EFGH" }
   ```
   The code works once and for 48 hours; the Pi deletes it after registering.
6. `sudo reboot`. The kiosk opens full-screen by itself, registers this Pi, and shows the OTP screen.

## Photocopy and scan orders (version 1.1)

If the machine offers **Photocopy** or **Scan** (Admin → Machine → services), connect a **multifunction printer** and check `scanimage -L` lists it (setup-pi.sh installs SANE). After the customer types the OTP, the screen shows *Place page 1 of N on the glass → Scan page*:

- **Photocopy:** each scanned page is printed straight away (the number of copies the customer paid for). *Finish* completes the order.
- **Scan:** the pages become one PDF that appears on the customer's phone after *Finish*.
- *Cancel* before any page refunds the customer; an order left alone for 10 minutes is closed automatically (finished if pages were done, refunded if not).

Without a scanner the kiosk refuses the order and the customer is refunded automatically.

## Paper status

The heartbeat now reads the printer's state from CUPS (`lpstat -l -p`). When the printer reports *media-empty*, the kiosk sends paper 0 % and the server stops taking payments until paper is back. Printers that don't report paper status are treated as having paper.

## How the Pi gets its machine

On first start, `config.json` has no machine. With a `SETUP_CODE` the Pi calls `POST /api/devices/register` and gets exactly the machine the admin created, plus a fresh API key; both are saved in `config.json`.

Older way (no setup code): `POST /api/register-machine` with the hardware serial number gives the **oldest unassigned Kiosk machine**. The server only allows this while `ALLOW_LEGACY_PI_REGISTRATION=true`; turn it off once every Pi is registered.

To move a Pi to a different machine, delete `MACHINE_ID` and `API_KEY` from `config.json`, add the new machine's `SETUP_CODE` (Admin → Machine → New setup code), and restart.

## Useful commands

| What | Command |
|---|---|
| Watch the log | `tail -f ~/kiosk/logs/kiosk.log` |
| Restart the kiosk | `pkill -f electron` (it starts again in 5 s) |
| Stop it for maintenance | `pkill -f start-kiosk.sh; pkill -f electron` |
| Test without a screen | `node kioskCore.js` (type an OTP at the prompt) |
| Check the printer | `lpstat -d -p` |
| Check the clock (signed requests need it) | `timedatectl` |

## Files

- `index.js`: Electron window; runs the kiosk logic once in the main process.
- `preload.js`: bridge from the screen to the kiosk logic (IPC only).
- `kioskCore.js`: registration, heartbeat, socket, file download, printing.
- `index.html`: the kiosk screen.
- `start-kiosk.sh`: auto-start loop, restarts the app if it exits, writes `logs/kiosk.log`.
- `setup-pi.sh`: one-time Pi setup.
- `config.json`: backend address, and (after first start) this Pi's machine ID, key, serial and printer. **Keep it private.**
