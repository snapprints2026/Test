# SnapPrints Shop Print Agent (Module 2)

Runs on the xerox shop's computer. When a customer pays on their phone, the agent
prints the document on the right copier (B&W or colour), with no OTP and nobody
at the computer needed.

## Install (Windows)

1. Install **Node.js LTS** (nodejs.org).
2. Install the copiers' printer drivers and check that each one prints a Windows test page.
3. Copy this folder to the PC, open a terminal in it, and run:
   ```
   npm install
   npm run setup
   ```
   - **Server address:** `https://<your-backend>/api` (on your laptop: `http://localhost:5000/api`)
   - **Setup code:** from the admin panel (Machines → your Module 2 machine)
   - Pick the printers, and say which one is colour, double-sided and A3.
4. Double-click **`start-agent.bat`**. It keeps the agent running and opens the shop screen.
5. Double-click **`install-autostart.bat`** to start it automatically at login.

## The shop screen: http://localhost:7300

Opens on this computer only. It shows:

- connection status
- the printers, with **Pause / Resume** (a paused printer gets no new orders)
- what's printing now
- today's orders with their **pickup codes**

When something goes wrong:

| Button | Use it when |
|---|---|
| **Print again** | Paper jam: the order goes back in the queue |
| **Mark done** | It printed fine but still shows "Printing" |
| **Refund** | It can't be printed; the customer gets their money back |

## Good to know

- A print that fails is tried once more (on another suitable printer if there is one). If that fails too, the order is refunded automatically.
- "Printed" means Windows accepted the job into the print queue. If the copier then jams, use **Print again**.
- Paid orders nobody prints within 2 hours (PC off, printers paused) are refunded automatically by the server.
- `config.json` holds this computer's API key. Don't share it. To move to a new PC, create a **New setup code** in the admin panel and run `npm run setup` there.
- `npm run printers` lists the printers Windows knows about, and their status.
- **Testing without a printer:** answer **y** to dry-run during setup. Orders are saved as PDFs in `dry-run-prints/` instead of being printed.
- Mac/Linux work too (through CUPS `lp`), but Windows is the main target.
