# Selling SnapPrints to government offices (RTO and others)

Government is a **customer segment**, not a third module. A government office still uses Module 1 (kiosk) or Module 2 (counter / shop computer). What changes is who owns the machine, who pays, what it offers and how strictly data is handled.

| Segment | Strict privacy | Typical setup |
|---|---|---|
| `EDUCATION` | off | College kiosk, citizen pays |
| `RETAIL` | off | Xerox shop, citizen pays |
| `GOVERNMENT` | **on** | RTO, tehsil, municipal office — citizen pays or department pays |
| `PSU` | **on** | Banks, PSU offices |

Strict privacy means the file name is never stored (jobs show "Document"), and file names are kept out of logs, receipts and the dashboard. It can be forced on or off per vendor.

---

## What the citizen sees (print page)

- **Language**: English / हिन्दी / मराठी switch on every screen. The machine's default language (Admin → Machine → Government card) applies until the citizen picks one.
- **Accessibility (GIGW / WCAG 2.1 AA basics)**: A− / A / A+ text size, high-contrast mode, focus outlines, screen-reader labels, zoom allowed, 48 px touch targets.
- **Services tab**: Print · Photo of card · Forms · Photocopy · Scan (only those enabled on the machine).
  - **Photo of card**: no file on the phone? The citizen photographs the physical Aadhaar / PAN / licence / voter ID; the page straightens it and prints it at real card size on A4, front above back — no counter staff needed.
  - **Forms**: the office's form catalogue (Form 1, 29, 30 …). Pick, choose copies, pay, collect. No upload.
  - **Photocopy**: say how many pages and copies, pay, hand the originals to the counter staff.
  - **Scan**: pay per page, staff scan, the citizen downloads the PDF from the link on the page (valid 60 min, then deleted).
  - **DigiLocker / Parivahan**: a help panel explains how to download the PDF from DigiLocker or the Parivahan site and upload it in the normal flow. No integration with those systems is needed (or allowed without MeitY approval).
- **Privacy notice (DPDP Act 2023)**: shown before the first upload, with the grievance officer's contact. Consent is recorded with the notice version. Customers can delete their account (Login → History → Delete my account).
- **Department-paid machines**: no payment screen. Counter staff type a 4–8 digit staff code instead.
- **Report a problem** button on every finished order — creates a support ticket.
- **Receipt download** after printing (a GST tax invoice when `SELLER_GSTIN` is set).

## What the department sees (officer portal)

Officers log in on the dashboard (**Login → Officer**) and see only their office and the offices below it:

- Overview: orders, pages, citizen payments, department billing, machines online, uptime, open complaints
- Usage reports by office / machine / month / service, with **CSV download**
- Machines with services, hours, today's count and month uptime
- Uptime (SLA) per machine and downtime events
- Invoices (PDF) and revenue-share settlements
- Contracts and the approved rates for each machine
- Complaints: raise and follow tickets

Officers can't change anything except raising and commenting on complaints.

## What you do (admin)

| Menu | Use it for |
|---|---|
| Organisations | Department → circle / district → office → counter tree. Office code (e.g. MH-46), GSTIN, state (decides CGST+SGST or IGST). Officers are created here. |
| Contracts | SALE (warranty / AMC), REVENUE_SHARE (% to the office), PAY_PER_USE (monthly invoice), RENTAL. GeM contract number, PO, dates, SLA target and penalty tiers. Link machines. |
| Form catalogue | Upload blank form PDFs per office (or global). |
| Pricing rules | Rates per contract or machine, per service / colour / size / sides. **Need a second admin to approve** (maker–checker). Default rates apply when no rule matches. |
| SLA & uptime | Monthly uptime counted in office hours only; mark planned maintenance as excluded; finalise the month. |
| Invoices | Gap-free numbers per financial year: `SP/26-27/R000001` (receipts), `D…` (department), `M…` (manual). Cancelled invoices keep their number. |
| Settlements | Revenue share to the office. Approved settlements are deducted from the operator's withdrawable balance. |
| Support tickets | All complaints; response and resolution times feed the SLA report. |
| Audit log | Every admin, officer, vendor, device and system action with IP. |
| Admin users | Super-admin only. Roles: SUPER_ADMIN, ADMIN, FINANCE, SUPPORT, VIEWER. |

Machine page → **Government / institution** card: organisation, contract, services, who pays, staff code, default language, office hours, asset tag, printer model, installation date.

---

## Hardware for a government counter

- **Multifunction printer** (print + copy + scan) with a duty cycle of at least 50,000 pages/month. A home inkjet will not survive an RTO.
- **Online UPS** (at least 30 minutes). The kiosk reports `power_source`, `ups_battery_pct` in its heartbeat and the dashboard raises **ON_UPS / UPS_LOW** alerts.
- **Lockable enclosure** with a door sensor (`door_open` in the heartbeat → **DOOR_OPEN** alert).
- 4G router as a backup for office Wi-Fi.
- Paper sensor: the machine locks itself when paper runs out and unlocks when the next heartbeat reports paper.

## Before you bid (not legal advice — check with a CA / lawyer)

- **GeM**: register as a seller, list the kiosk (product) and/or "printing services". Most offices buy only through GeM. Keep the GeM contract number on the contract.
- **GST**: set `SELLER_GSTIN`, `SELLER_STATE`, `INVOICE_SAC` and the rate with your CA. Department invoices need the office's GSTIN when it has one.
- **DPDP Act 2023**: the notice, consent records, deletion and grievance contact are built in. You still need a written privacy policy (`PRIVACY_POLICY_URL`), a data-processing agreement with the department and a breach process (below).
- **CERT-In**: report cyber incidents within 6 hours (cert-in.org.in) and keep logs for 180 days. Audit logs are kept; set your log retention on Railway accordingly.
- **Security audit**: many departments ask for a CERT-In empanelled auditor's report before go-live. Budget for it.
- **Data location**: keep the database and R2 bucket in India where the contract asks for it (Railway region / R2 jurisdiction).
- **Hindi and Marathi** texts were written by machine and need a native speaker's review before you show them to a department.
- **SMS OTP**: the SMS gateway is still a mock. Connect a DLT-registered gateway (MSG91, Twilio India …) before switching customer login on. In production the OTP is never written to the logs.

### Breach process (short version)

1. Rotate `JWT_SECRET`, R2 keys and machine API keys (Admin → Machine → New setup code).
2. Look at the audit log for the affected period and export it.
3. Report to CERT-In within 6 hours, and to the Data Protection Board and affected people as the DPDP rules require.
4. Tell the department's nodal officer in writing.

---

## Try it locally

`npm run db:setup` creates a demo government setup:

- Maharashtra Transport Department → RTO Panvel (MH-46) → Counter 1
- Contract **SPC-DEMO-0001** (revenue share 10 %) with machine **MH1002** (kiosk: forms, photocopy, scan, Marathi)
- Contract **SPC-DEMO-0002** (pay per use, billed monthly) with machine **MH1003** (counter, staff code **1234**)
- Operator `govops@snapprints.local / vendor123`, officer `officer@snapprints.local / officer123`

Then open http://localhost:3000/?machine=MH1002 and http://localhost:3000/?machine=MH1003. Run the kiosk simulator for MH1002 (`npm run kiosk:sim -- register <code>`, then `unlock <OTP>`), and the shop agent for MH1003 (`npm run agent:setup` with its code). Photocopy and scan orders appear on the shop screen with **Start / Done / Upload scan** buttons.
