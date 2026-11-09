// scripts/seed-dev.js — test data for your LAPTOP (refuses to run in production).
//
//   npm run seed:dev
//
// Creates (only if missing):
//   admin    admin@snapprints.local    / admin123    (SUPER_ADMIN)
//   vendor   vendor@snapprints.local   / vendor123   (college / xerox shop, Kiosk + Shop)
//   vendor   govops@snapprints.local   / vendor123   (GOVERNMENT operator)
//   officer  officer@snapprints.local  / officer123  (read-only, Transport Department)
//   Organisations: Maharashtra Transport Department → RTO Panvel (MH-46) → Counter 1
//   Contracts: revenue share 10 % (RTO Panvel), pay-per-use (Counter 1)
//   MH1000  Module 1 kiosk — college library
//   MH1001  Module 2 shop computer — xerox shop
//   MH1002  Module 1 kiosk — RTO Panvel waiting hall (print, forms, photocopy, scan)
//   MH1003  Module 2 shop computer — RTO Counter 1, billed to the department (staff code 1234)
//   A sample "form" PDF (replace with official forms from parivahan.gov.in)
// and prints a fresh setup code for each machine.
require("../src/config/env");
const bcrypt = require("bcrypt");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const db = require("../src/database/db");
const env = require("../src/config/env");
const storage = require("../src/services/storage.service");
const { issueSetupCode } = require("../src/services/machine.service");
const { today } = require("../src/services/time.service");

async function one(sql, params) {
  const [[row]] = await db.query(sql, params);
  return row || null;
}

async function ensureMachine(machineId, name, module, vendorId, locationName, extra = {}) {
  const m = await one(`SELECT id FROM machines WHERE machine_id=?`, [machineId]);
  if (!m) {
    const [loc] = await db.query(
      `INSERT INTO locations (name, city, state, open_time, close_time, open_days) VALUES (?, ?, 'Maharashtra', ?, ?, ?)`,
      [locationName, extra.city || "Pune", extra.openTime || null, extra.closeTime || null, extra.openDays || null]
    );
    await db.query(
      `INSERT INTO machines (machine_id, name, module, require_login, location_id, owner_vendor_id, organization_id,
         contract_id, enabled_job_types, billing_mode, staff_pin_hash, default_language, status, assigned)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', FALSE)`,
      [machineId, name, module, loc.insertId, vendorId, extra.organizationId || null, extra.contractId || null,
       extra.jobTypes || "PRINT,FORM", extra.billingMode || "CUSTOMER",
       extra.staffPin ? await bcrypt.hash(extra.staffPin, 10) : null, extra.language || null]
    );
    console.log(`✓ machine ${machineId} (${module}) created`);
  }
  return issueSetupCode(machineId);
}

async function ensureOrg(name, fields) {
  const o = await one(`SELECT id FROM organizations WHERE name=?`, [name]);
  if (o) return o.id;
  const cols = ["name", ...Object.keys(fields)];
  const [r] = await db.query(
    `INSERT INTO organizations (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    [name, ...Object.values(fields)]
  );
  console.log(`✓ organisation ${name}`);
  return r.insertId;
}

async function ensureContract(no, fields) {
  const c = await one(`SELECT id FROM contracts WHERE contract_no=?`, [no]);
  if (c) return c.id;
  const cols = ["contract_no", ...Object.keys(fields)];
  const [r] = await db.query(
    `INSERT INTO contracts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    [no, ...Object.values(fields)]
  );
  console.log(`✓ contract ${no}`);
  return r.insertId;
}

async function samplePdf(title, pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = pdf.addPage([595.28, 841.89]);
    p.drawText(title, { x: 50, y: 780, size: 18, font });
    p.drawText(`SAMPLE ONLY — page ${i + 1} of ${pages}`, { x: 50, y: 750, size: 11, font });
    p.drawText("Replace with the official blank form from the issuing department.", { x: 50, y: 730, size: 11, font });
    for (let y = 680; y > 120; y -= 32) p.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  }
  return Buffer.from(await pdf.save());
}

async function ensureForm(code, title, extra) {
  const f = await one(`SELECT id FROM form_templates WHERE code=?`, [code]);
  if (f) return;
  const pages = extra.pages || 1;
  const [r] = await db.query(
    `INSERT INTO form_templates (code, title, title_hi, title_mr, description, category, segment, page_count, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 'GOVERNMENT', ?, 0, ?)`,
    [code, title, extra.hi || null, extra.mr || null, extra.description || null, extra.category || "RTO", pages, extra.sort || 0]
  );
  const key = `templates/${r.insertId}/sample.pdf`;
  await storage.putBuffer(key, await samplePdf(`${code}: ${title}`, pages), "application/pdf");
  await db.query(`UPDATE form_templates SET file_path=?, is_active=1 WHERE id=?`, [key, r.insertId]);
  console.log(`✓ sample form ${code}`);
}

async function run() {
  if (env.IS_PROD) throw new Error("seed:dev is for local testing only");

  if (!(await one(`SELECT id FROM admin_users WHERE email='admin@snapprints.local'`))) {
    await db.query(
      `INSERT INTO admin_users (name, email, password_hash, role) VALUES ('Local Admin', 'admin@snapprints.local', ?, 'SUPER_ADMIN')`,
      [await bcrypt.hash("admin123", 10)]
    );
    console.log("✓ admin created");
  }

  let vendor = await one(`SELECT id FROM vendors WHERE email='vendor@snapprints.local'`);
  if (!vendor) {
    const [r] = await db.query(
      `INSERT INTO vendors (full_name, email, phone, password_hash, business_name, allowed_modules, segment)
       VALUES ('Test Vendor', 'vendor@snapprints.local', '9876543210', ?, 'Test Xerox Shop', 'KIOSK,SHOP', 'EDUCATION')`,
      [await bcrypt.hash("vendor123", 10)]
    );
    vendor = { id: r.insertId };
    console.log("✓ vendor created");
  }
  let gov = await one(`SELECT id FROM vendors WHERE email='govops@snapprints.local'`);
  if (!gov) {
    const [r] = await db.query(
      `INSERT INTO vendors (full_name, email, phone, password_hash, business_name, allowed_modules, segment, state)
       VALUES ('Gov Ops', 'govops@snapprints.local', '9876500000', ?, 'SnapPrints Government Operations', 'KIOSK,SHOP', 'GOVERNMENT', 'Maharashtra')`,
      [await bcrypt.hash("vendor123", 10)]
    );
    gov = { id: r.insertId };
    console.log("✓ government vendor created");
  }

  // Organisation tree
  const dept = await ensureOrg("Maharashtra Transport Department", {
    org_type: "DEPARTMENT", segment: "GOVERNMENT", state: "Maharashtra", city: "Mumbai", default_language: "mr",
  });
  const rto = await ensureOrg("RTO Panvel", {
    parent_id: dept, org_type: "OFFICE", segment: "GOVERNMENT", office_code: "MH-46", state: "Maharashtra",
    city: "Panvel", vendor_id: gov.id, default_language: "mr",
  });
  const counter = await ensureOrg("RTO Panvel — Counter 1", {
    parent_id: rto, org_type: "COUNTER", segment: "GOVERNMENT", office_code: "MH-46-C1", state: "Maharashtra", city: "Panvel",
  });

  const rs = await ensureContract("SPC-DEMO-0001", {
    organization_id: rto, vendor_id: gov.id, contract_type: "REVENUE_SHARE", title: "Citizen print kiosk — revenue share",
    gem_contract_no: "GEMC-511687700000000", start_date: today(), revenue_share_pct: 10, sla_uptime_pct: 98,
    penalty_rules: JSON.stringify({ tiers: [{ below: 98, amount: 500 }, { below: 95, amount: 1500 }], max_amount: 3000, ticket_response_hours: 4, ticket_resolution_hours: 24 }),
  });
  const ppu = await ensureContract("SPC-DEMO-0002", {
    organization_id: counter, vendor_id: gov.id, contract_type: "PAY_PER_USE", title: "Counter printing — billed monthly",
    po_number: "PO/RTO/2026/17", start_date: today(), sla_uptime_pct: 97,
  });

  // Officer
  if (!(await one(`SELECT id FROM officers WHERE email='officer@snapprints.local'`))) {
    await db.query(
      `INSERT INTO officers (organization_id, name, email, designation, password_hash) VALUES (?, 'Test Officer', 'officer@snapprints.local', 'Deputy RTO', ?)`,
      [dept, await bcrypt.hash("officer123", 10)]
    );
    console.log("✓ officer created");
  }

  // Approved rates for the revenue-share contract (B&W ₹2, colour ₹10, scan ₹5)
  if (!(await one(`SELECT id FROM pricing_rules WHERE contract_id=?`, [rs]))) {
    const admin = await one(`SELECT id FROM admin_users ORDER BY id LIMIT 1`);
    for (const [jobType, color, rate] of [["ANY", "bw", 2], ["ANY", "color", 10], ["SCAN", "any", 5]]) {
      await db.query(
        `INSERT INTO pricing_rules (scope, contract_id, job_type, color, rate, status, effective_from, approval_ref, created_by, approved_by, approved_at)
         VALUES ('CONTRACT', ?, ?, ?, ?, 'ACTIVE', ?, 'RTO/MH-46/OO/2026/12', ?, ?, NOW())`,
        [rs, jobType, color, rate, today(), admin.id, admin.id]
      );
    }
    console.log("✓ approved rates for SPC-DEMO-0001");
  }

  await ensureForm("RTO-FORM-1", "Form 1 — Self-declaration of physical fitness", {
    hi: "फॉर्म 1 — शारीरिक फिटनेस का स्व-घोषणा पत्र", mr: "फॉर्म 1 — शारीरिक तंदुरुस्तीचे स्व-घोषणापत्र", category: "Driving licence", sort: 1,
  });
  await ensureForm("RTO-FORM-29", "Form 29 — Notice of transfer of ownership", {
    hi: "फॉर्म 29 — स्वामित्व हस्तांतरण की सूचना", mr: "फॉर्म 29 — मालकी हस्तांतरणाची सूचना", category: "Vehicle registration", pages: 2, sort: 2,
  });

  const kiosk = await ensureMachine("MH1000", "Test Kiosk", "KIOSK", vendor.id, "College Library");
  const shop = await ensureMachine("MH1001", "Test Xerox Shop", "SHOP", vendor.id, "Main Road Xerox");
  const rtoKiosk = await ensureMachine("MH1002", "RTO Panvel Kiosk", "KIOSK", gov.id, "RTO Panvel — Waiting hall", {
    organizationId: rto, contractId: rs, jobTypes: "PRINT,FORM,COPY,SCAN", language: "mr", city: "Panvel",
    openTime: "09:45", closeTime: "17:45", openDays: "1,2,3,4,5,6",
  });
  const rtoCounter = await ensureMachine("MH1003", "RTO Counter 1", "SHOP", gov.id, "RTO Panvel — Counter 1", {
    organizationId: counter, contractId: ppu, jobTypes: "PRINT,FORM,COPY,SCAN", billingMode: "DEPARTMENT",
    staffPin: "1234", city: "Panvel", openTime: "09:45", closeTime: "17:45", openDays: "1,2,3,4,5,6",
  });

  console.log(`
──────────────────────────────────────────────────────────────
 Dashboard   admin@snapprints.local   / admin123     (admin)
             vendor@snapprints.local  / vendor123    (vendor)
             govops@snapprints.local  / vendor123    (government operator)
             officer@snapprints.local / officer123   (officer — read-only)

 MH1000  Kiosk (Module 1), college     setup code: ${kiosk.setupCode}
 MH1001  Shop  (Module 2), xerox shop  setup code: ${shop.setupCode}
 MH1002  Kiosk, RTO Panvel             setup code: ${rtoKiosk.setupCode}
 MH1003  Shop, RTO counter (staff code 1234, billed to dept)  setup code: ${rtoCounter.setupCode}
 (codes work once, for 48 hours — run this again for new ones)

 Print page links:
   http://localhost:3000/?machine=MH1000   college kiosk
   http://localhost:3000/?machine=MH1001   xerox shop
   http://localhost:3000/?machine=MH1002   RTO kiosk (forms, photocopy, scan, Marathi)
   http://localhost:3000/?machine=MH1003   RTO counter (staff code)
──────────────────────────────────────────────────────────────`);
  process.exit(0);
}

run().catch((err) => {
  console.error("SEED ERROR:", err.message);
  process.exit(1);
});
