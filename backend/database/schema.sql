-- =====================================================================
--  SnapPrints — full MySQL schema
--    Module 1 kiosks + Module 2 shop computers
--    Customer segments: EDUCATION · RETAIL · GOVERNMENT · PSU
--    Government features: organisations, contracts, approved pricing,
--    form catalogue, GST invoices, settlements, SLA, support tickets,
--    officer logins, DPDP consent records.
--
--  Requires MySQL 8.0 (or MariaDB 10.5+). Safe to re-run: every table
--  uses CREATE TABLE IF NOT EXISTS.
--
--  Easiest way to apply it (new OR existing database):
--      cd backend && npm run migrate
--  The migrate script runs this file and then upgrades an older database
--  (adds missing columns, hashes stored OTPs, masks payment details), so
--  you never have to edit tables by hand.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. admin_users — SnapPrints staff logins (seed with: npm run create-admin)
--    role: SUPER_ADMIN (everything, manages admin users)
--          ADMIN       (everything except admin users)
--          FINANCE     (read all + withdrawals, invoices, settlements, pricing approval)
--          SUPPORT     (read all + tickets, refunds, machine settings)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('SUPER_ADMIN','ADMIN','FINANCE','SUPPORT') NOT NULL DEFAULT 'ADMIN',
  status         ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. vendors — machine operators (your business clients).
--    allowed_modules: 'KIOSK', 'SHOP' or 'KIOSK,SHOP'.
--    segment: who the vendor serves. GOVERNMENT / PSU switch on strict
--             privacy automatically (no file names stored, etc.).
--    strict_privacy: NULL = automatic by segment, 1 = always, 0 = never
--                    (a GOVERNMENT organisation is always strict).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name        VARCHAR(150) NOT NULL,
  email            VARCHAR(190) NOT NULL,
  phone            VARCHAR(20)  NULL,
  password_hash    VARCHAR(255) NOT NULL,
  business_name    VARCHAR(200) NULL,
  gst_number       VARCHAR(20)  NULL,
  address          VARCHAR(500) NULL,
  state            VARCHAR(100) NULL,
  allowed_modules  VARCHAR(20)  NOT NULL DEFAULT 'KIOSK',
  segment          ENUM('EDUCATION','RETAIL','GOVERNMENT','PSU') NOT NULL DEFAULT 'EDUCATION',
  strict_privacy   TINYINT(1)   NULL,
  institution_type VARCHAR(30)  NOT NULL DEFAULT 'COLLEGE',  -- COLLEGE … SHOP, GOVERNMENT_OFFICE, BANK, PSU_OFFICE, OTHER
  contact_designation VARCHAR(100) NULL,
  alt_phone        VARCHAR(20)  NULL,
  pan_number       VARCHAR(10)  NULL,
  billing_address  VARCHAR(500) NULL,
  status           ENUM('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vendors_email (email),
  KEY idx_vendors_segment (segment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. organizations — the customer institution, as a tree.
--    State Transport Dept (DEPARTMENT) → RTO Panvel (OFFICE, office_code MH-46)
--    → Counter 3 (COUNTER). Reports roll up the tree.
--    vendor_id = the operator account that runs machines here (optional).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id         INT UNSIGNED NULL,
  vendor_id         INT UNSIGNED NULL,
  name              VARCHAR(200) NOT NULL,
  org_type          ENUM('DEPARTMENT','OFFICE','COUNTER','CAMPUS','COMPANY','OTHER') NOT NULL DEFAULT 'OFFICE',
  segment           ENUM('EDUCATION','RETAIL','GOVERNMENT','PSU') NOT NULL DEFAULT 'GOVERNMENT',
  office_code       VARCHAR(40)  NULL,
  gstin             VARCHAR(20)  NULL,
  address           VARCHAR(500) NULL,
  city              VARCHAR(100) NULL,
  state             VARCHAR(100) NULL,
  pincode           VARCHAR(10)  NULL,
  contact_name      VARCHAR(150) NULL,
  contact_email     VARCHAR(190) NULL,
  contact_phone     VARCHAR(20)  NULL,
  default_language  ENUM('en','hi','mr') NULL,
  status            ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_org_parent (parent_id),
  KEY idx_org_vendor (vendor_id),
  KEY idx_org_office_code (office_code),
  CONSTRAINT fk_org_parent FOREIGN KEY (parent_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_org_vendor FOREIGN KEY (vendor_id)
    REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. officers — read-only department logins. An officer sees usage,
--    revenue, invoices, SLA and tickets for their organisation and every
--    organisation below it. They can raise support tickets.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS officers (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  INT UNSIGNED NOT NULL,
  name             VARCHAR(150) NOT NULL,
  email            VARCHAR(190) NOT NULL,
  phone            VARCHAR(20)  NULL,
  designation      VARCHAR(120) NULL,
  password_hash    VARCHAR(255) NOT NULL,
  status           ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login_at    DATETIME NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_officers_email (email),
  KEY idx_officers_org (organization_id),
  CONSTRAINT fk_officers_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. contracts — how an organisation pays.
--    SALE          department bought the machines (+ warranty / AMC)
--    REVENUE_SHARE citizens pay per page; the office gets revenue_share_pct
--    PAY_PER_USE   staff print, citizens pay nothing; monthly invoice
--    RENTAL        fixed monthly rent
--    penalty_rules (JSON), e.g.
--      {"tiers":[{"below":98,"amount":1000},{"below":95,"amount":2500}],
--       "max_amount":5000,"ticket_response_hours":4,"ticket_resolution_hours":24}
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_no            VARCHAR(40)  NOT NULL,
  organization_id        INT UNSIGNED NOT NULL,
  vendor_id              INT UNSIGNED NULL,
  contract_type          ENUM('SALE','REVENUE_SHARE','PAY_PER_USE','RENTAL') NOT NULL,
  title                  VARCHAR(200) NULL,
  gem_contract_no        VARCHAR(80)  NULL,
  po_number              VARCHAR(80)  NULL,
  start_date             DATE NOT NULL,
  end_date               DATE NULL,
  warranty_until         DATE NULL,
  amc_until              DATE NULL,
  amc_amount             DECIMAL(12,2) NULL,
  rental_amount_monthly  DECIMAL(12,2) NULL,
  revenue_share_pct      DECIMAL(5,2)  NULL,
  sla_uptime_pct         DECIMAL(5,2)  NOT NULL DEFAULT 98.00,
  penalty_rules          JSON NULL,
  billing_cycle          ENUM('MONTHLY','QUARTERLY') NOT NULL DEFAULT 'MONTHLY',
  status                 ENUM('DRAFT','ACTIVE','EXPIRED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
  notes                  VARCHAR(1000) NULL,
  created_by             INT UNSIGNED NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contracts_no (contract_no),
  KEY idx_contracts_org (organization_id),
  KEY idx_contracts_vendor (vendor_id),
  KEY idx_contracts_gem (gem_contract_no),
  CONSTRAINT fk_contracts_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_contracts_vendor FOREIGN KEY (vendor_id)
    REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. customers — people who print (mobile-OTP login, optional per machine).
--    The login OTP is stored only as an HMAC hash.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(120) NULL,
  phone           VARCHAR(20)  NOT NULL,
  otp_hash        VARCHAR(64)  NULL,
  otp_attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  otp_verified    TINYINT(1)   NOT NULL DEFAULT 0,
  otp_expires_at  DATETIME     NULL,
  deleted_at      DATETIME     NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. locations — where each machine / shop is.
--    open_time / close_time / open_days = office hours (IST) used for SLA.
--    Leave empty for 24 × 7. open_days: 1=Mon … 7=Sun, e.g. '1,2,3,4,5,6'.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(200) NULL,
  address     VARCHAR(500) NULL,
  city        VARCHAR(100) NULL,
  state       VARCHAR(100) NULL,
  pincode     VARCHAR(10)  NULL,
  latitude    DECIMAL(10,7) NULL,
  longitude   DECIMAL(10,7) NULL,
  open_time   TIME NULL,
  close_time  TIME NULL,
  open_days   VARCHAR(20) NULL,           -- ISO days the office is open: "1,2,3,4,5,6"
  weekly_off  VARCHAR(30) NULL,           -- the same as day names: "SUN"
  campus_name VARCHAR(150) NULL,
  building    VARCHAR(100) NULL,
  floor       VARCHAR(50)  NULL,
  spot        VARCHAR(150) NULL,          -- "Library entrance"
  landmark    VARCHAR(200) NULL,
  contact_name  VARCHAR(120) NULL,        -- on-site contact
  contact_phone VARCHAR(20)  NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. machines — one row per deployment.
--    module = 'KIOSK' → Module 1: Raspberry Pi kiosk, OTP/QR unlock
--    module = 'SHOP'  → Module 2: shop computer running the print agent
--    enabled_job_types: what customers can order here (comma-separated)
--       PRINT (upload a file), FORM (government form catalogue),
--       COPY (photocopy at the machine), SCAN (scan to the phone).
--       COPY / SCAN need a multifunction printer and device software that
--       supports them (shop agent 1.1+, kiosk firmware with copy/scan).
--    billing_mode: CUSTOMER  = the citizen pays online
--                  DEPARTMENT = staff enter the staff code, the department
--                               is invoiced monthly (PAY_PER_USE contracts)
--    setup_code_*: one-time code the admin gives to a new device.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machines (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id                VARCHAR(20)  NOT NULL,
  name                      VARCHAR(150) NULL,
  module                    ENUM('KIOSK','SHOP') NOT NULL DEFAULT 'KIOSK',
  require_login             TINYINT(1)   NULL,
  location_id               INT UNSIGNED NULL,
  owner_vendor_id           INT UNSIGNED NULL,
  organization_id           INT UNSIGNED NULL,
  contract_id               INT UNSIGNED NULL,
  enabled_job_types         VARCHAR(40)  NOT NULL DEFAULT 'PRINT,FORM',
  billing_mode              ENUM('CUSTOMER','DEPARTMENT') NOT NULL DEFAULT 'CUSTOMER',
  staff_pin_hash            VARCHAR(255) NULL,
  default_language          ENUM('en','hi','mr') NULL,
  asset_tag                 VARCHAR(60)  NULL,
  printer_model             VARCHAR(120) NULL,
  installed_at              DATE NULL,
  status                    ENUM('PENDING','ACTIVE','INACTIVE','DISABLED') NOT NULL DEFAULT 'PENDING',
  assigned                  TINYINT(1)   NOT NULL DEFAULT 0,
  device_serial             VARCHAR(100) NULL,
  device_name               VARCHAR(150) NULL,
  api_key_hash              VARCHAR(255) NULL,
  setup_code_hash           VARCHAR(64)  NULL,
  setup_code_expires_at     DATETIME     NULL,
  last_seen_at              DATETIME     NULL,
  last_ip                   VARCHAR(64)  NULL,
  is_print_locked           TINYINT(1)   NOT NULL DEFAULT 0,
  paper_threshold           INT          NOT NULL DEFAULT 10,
  critical_paper_threshold  INT          NOT NULL DEFAULT 5,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_machines_machine_id (machine_id),
  UNIQUE KEY uq_machines_device_serial (device_serial),
  KEY idx_machines_owner (owner_vendor_id),
  KEY idx_machines_location (location_id),
  KEY idx_machines_org (organization_id),
  KEY idx_machines_contract (contract_id),
  KEY idx_machines_status_assigned (status, assigned),
  KEY idx_machines_setup_code (setup_code_hash),
  CONSTRAINT fk_machines_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_machines_vendor FOREIGN KEY (owner_vendor_id)
    REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_machines_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_machines_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 9. printers — Module 2 only: copiers/printers attached to a shop computer.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS printers (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id       VARCHAR(20)  NOT NULL,
  system_name      VARCHAR(255) NOT NULL,
  display_name     VARCHAR(120) NOT NULL,
  kind             ENUM('BW','COLOR') NOT NULL DEFAULT 'BW',
  supports_duplex  TINYINT(1)   NOT NULL DEFAULT 0,
  paper_sizes      VARCHAR(60)  NOT NULL DEFAULT 'A4',
  status           ENUM('ONLINE','OFFLINE','ERROR') NOT NULL DEFAULT 'OFFLINE',
  status_message   VARCHAR(255) NULL,
  is_enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  last_seen_at     DATETIME     NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_printers_machine_system (machine_id, system_name),
  CONSTRAINT fk_printers_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 10. form_templates — blank government forms citizens can print without
--     uploading anything (RTO Form 1, 1A, 29, 30 …). Files live in storage
--     under templates/. organization_id NULL = every machine of `segment`
--     (or every machine when segment is NULL); otherwise that organisation
--     and everything below it.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_templates (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             VARCHAR(40)  NOT NULL,
  title            VARCHAR(200) NOT NULL,
  title_hi         VARCHAR(200) NULL,
  title_mr         VARCHAR(200) NULL,
  description      VARCHAR(500) NULL,
  category         VARCHAR(80)  NULL,
  segment          ENUM('EDUCATION','RETAIL','GOVERNMENT','PSU') NULL,
  organization_id  INT UNSIGNED NULL,
  file_path        VARCHAR(512) NULL,
  page_count       INT UNSIGNED NOT NULL DEFAULT 0,
  default_copies   INT UNSIGNED NOT NULL DEFAULT 1,
  color            ENUM('bw','color') NOT NULL DEFAULT 'bw',
  paper_size       ENUM('A4','A3') NOT NULL DEFAULT 'A4',
  print_side       ENUM('single','duplex') NOT NULL DEFAULT 'single',
  source_url       VARCHAR(500) NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order       INT          NOT NULL DEFAULT 0,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_form_templates_code (code),
  KEY idx_forms_active (is_active, segment),
  KEY idx_forms_org (organization_id),
  CONSTRAINT fk_forms_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 11. pricing_rules — approved per-unit rates (₹), with history.
--     A unit is one page, or one sheet (2 pages) when double-sided; SCAN
--     is per page scanned. The most specific ACTIVE rule wins:
--     MACHINE > CONTRACT > GLOBAL, then the rule matching more options.
--     Rules are never edited after approval — change a price by adding a
--     new rule and retiring the old one, so the approval trail stays.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_rules (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope           ENUM('GLOBAL','CONTRACT','MACHINE') NOT NULL DEFAULT 'GLOBAL',
  contract_id     INT UNSIGNED NULL,
  machine_id      VARCHAR(20)  NULL,
  job_type        ENUM('ANY','PRINT','COPY','SCAN','FORM') NOT NULL DEFAULT 'ANY',
  color           ENUM('any','bw','color') NOT NULL DEFAULT 'any',
  paper_size      ENUM('any','A4','A3') NOT NULL DEFAULT 'any',
  print_side      ENUM('any','single','duplex') NOT NULL DEFAULT 'any',
  rate            DECIMAL(8,2) NOT NULL,
  status          ENUM('PENDING','ACTIVE','REJECTED','RETIRED') NOT NULL DEFAULT 'PENDING',
  effective_from  DATE NOT NULL,
  effective_to    DATE NULL,
  approval_ref    VARCHAR(120) NULL,
  notes           VARCHAR(500) NULL,
  created_by      INT UNSIGNED NULL,
  approved_by     INT UNSIGNED NULL,
  approved_at     DATETIME NULL,
  retired_at      DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pricing_scope_status (scope, status),
  KEY idx_pricing_machine (machine_id),
  KEY idx_pricing_contract (contract_id),
  CONSTRAINT fk_pricing_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pricing_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 12. print_jobs — one row per order. Rows are kept after printing
--     (revenue history); the document itself is deleted right after
--     printing (file_path → NULL, file_deleted_at set).
--     job_type: PRINT (uploaded file) · FORM (form_template_id) ·
--               COPY (photocopy at the machine) · SCAN (scan to phone;
--               the scan is result_path until result_expires_at).
--     billing: CUSTOMER (paid online) or DEPARTMENT (invoiced monthly).
--     organization_id / contract_id are copied from the machine when the
--     order is created, so reports stay right if a machine is moved later.
--     Files are encrypted at rest (file_encrypted = 1).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_jobs (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id             VARCHAR(40)  NOT NULL,
  machine_id         VARCHAR(20)  NOT NULL,
  customer_id        INT UNSIGNED NULL,
  organization_id    INT UNSIGNED NULL,
  contract_id        INT UNSIGNED NULL,
  printer_id         INT UNSIGNED NULL,
  job_type           ENUM('PRINT','COPY','SCAN','FORM') NOT NULL DEFAULT 'PRINT',
  form_template_id   INT UNSIGNED NULL,
  billing            ENUM('CUSTOMER','DEPARTMENT') NOT NULL DEFAULT 'CUSTOMER',
  order_code         VARCHAR(8)   NULL,
  file_name          VARCHAR(255) NULL,
  file_path          VARCHAR(512) NULL,
  file_encrypted     TINYINT(1)   NOT NULL DEFAULT 0,
  file_deleted_at    DATETIME     NULL,
  result_path        VARCHAR(512) NULL,
  result_expires_at  DATETIME     NULL,
  color              VARCHAR(10)  NULL,
  copies             INT UNSIGNED NOT NULL DEFAULT 1,
  paper_size         VARCHAR(10)  NULL,
  print_side         VARCHAR(10)  NULL,
  total_pages        INT UNSIGNED NOT NULL DEFAULT 0,
  unit_rate          DECIMAL(8,2) NULL,
  pricing_rule_id    INT UNSIGNED NULL,
  amount             DECIMAL(10,2) NULL,
  status             ENUM('CREATED','PAYING','PAID','PRINTING','PRINTED','FAILED','EXPIRED')
                     NOT NULL DEFAULT 'CREATED',
  fail_reason        VARCHAR(255) NULL,
  payment_order_id   VARCHAR(64)  NULL,
  payment_id         VARCHAR(64)  NULL,
  payment_method     VARCHAR(30)  NULL,
  payment_details    JSON         NULL,
  -- support & refunds
  source             VARCHAR(10)  NULL,          -- UPLOAD | CARD (photo of card) | FORM …
  ref_code           VARCHAR(12)  NULL,          -- "SP-7KQ2MX", shown to the customer
  utr                VARCHAR(40)  NULL,          -- UPI / bank reference from Razorpay
  payer_contact      VARCHAR(15)  NULL,          -- phone typed on the Razorpay checkout
  refund_id          VARCHAR(64)  NULL,
  refund_amount      DECIMAL(10,2) NULL,
  refund_status      VARCHAR(12)  NULL,          -- PROCESSING | PENDING | PROCESSED | FAILED
  refund_reason      VARCHAR(255) NULL,
  refunded_at        DATETIME     NULL,
  printed_at         DATETIME     NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_jobs_job_id (job_id),
  UNIQUE KEY uq_print_jobs_ref_code (ref_code),
  KEY idx_print_jobs_utr (utr),
  KEY idx_print_jobs_payer (payer_contact),
  KEY idx_print_jobs_refund (refund_status),
  KEY idx_print_jobs_machine_status (machine_id, status),
  KEY idx_print_jobs_customer (customer_id),
  KEY idx_print_jobs_status_created (status, created_at),
  KEY idx_print_jobs_created (created_at),
  KEY idx_print_jobs_order (payment_order_id),
  KEY idx_print_jobs_order_code (machine_id, order_code),
  KEY idx_print_jobs_printer (printer_id),
  KEY idx_print_jobs_org_created (organization_id, created_at),
  KEY idx_print_jobs_contract (contract_id, status, created_at),
  KEY idx_print_jobs_result (result_expires_at),
  CONSTRAINT fk_print_jobs_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_print_jobs_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Paid but didn't get my print": customer reports + admin review queue.
-- One case per job. SYSTEM rows come from the cleanup job (stuck printing).
CREATE TABLE IF NOT EXISTS job_issues (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id           VARCHAR(40)  NOT NULL,
  source           VARCHAR(10)  NOT NULL DEFAULT 'CUSTOMER',   -- CUSTOMER | SYSTEM | SUPPORT
  reason           VARCHAR(30)  NOT NULL DEFAULT 'OTHER',      -- NOTHING_PRINTED, MISSING_PAGES, BAD_QUALITY, MACHINE_ERROR, STUCK, OTHER
  details          VARCHAR(500) NULL,
  status           VARCHAR(15)  NOT NULL DEFAULT 'OPEN',       -- OPEN | APPROVED | REJECTED | AUTO_APPROVED
  resolution_note  VARCHAR(500) NULL,
  resolved_by      INT UNSIGNED NULL,
  resolved_at      DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_issues_job (job_id),
  KEY idx_job_issues_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 13. print_job_tokens — Module 1 only: kiosk unlock OTP / QR after payment.
--     *_hash = HMAC (what the kiosk's code is compared with),
--     *_enc  = AES-GCM encrypted copy so the customer's own page can show
--              it again. Plain codes are never stored.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_job_tokens (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id          VARCHAR(40)  NOT NULL,
  otp_hash        VARCHAR(64)  NULL,
  otp_enc         VARCHAR(255) NULL,
  otp_verified    TINYINT(1)   NOT NULL DEFAULT 0,
  otp_expires_at  DATETIME     NULL,
  qr_hash         VARCHAR(64)  NULL,
  qr_enc          VARCHAR(255) NULL,
  qr_expires_at   DATETIME     NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_job_tokens_job (job_id),
  KEY idx_pjt_otp_hash (otp_hash),
  KEY idx_pjt_qr_hash (qr_hash),
  KEY idx_pjt_expires (otp_expires_at),
  CONSTRAINT fk_pjt_job FOREIGN KEY (job_id)
    REFERENCES print_jobs (job_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 14. consents — DPDP Act consent records (one per order / login).
--     ip_hash is an HMAC of the IP address, not the address itself.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consents (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id     INT UNSIGNED NULL,
  job_id          VARCHAR(40)  NULL,
  machine_id      VARCHAR(20)  NULL,
  purpose         VARCHAR(40)  NOT NULL DEFAULT 'PRINT_SERVICE',
  notice_version  VARCHAR(20)  NOT NULL,
  language        VARCHAR(5)   NULL,
  ip_hash         VARCHAR(64)  NULL,
  consented_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_consents_job (job_id),
  KEY idx_consents_customer (customer_id),
  KEY idx_consents_created (consented_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 15. machine_heartbeat_logs (+ UPS / enclosure sensors, all optional)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_heartbeat_logs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id       VARCHAR(20)  NOT NULL,
  cpu_usage        DECIMAL(5,2) NULL,
  paper_level      INT          NULL,
  ink_level        INT          NULL,
  power_source     VARCHAR(10)  NULL,
  ups_battery_pct  INT          NULL,
  door_open        TINYINT(1)   NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'ONLINE',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mhl_machine_created (machine_id, created_at),
  CONSTRAINT fk_mhl_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 16. machine_alerts  (LOW_PAPER, ON_UPS, UPS_LOW, DOOR_OPEN, OFFLINE …)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_alerts (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id   VARCHAR(20)  NOT NULL,
  alert_type   VARCHAR(30)  NOT NULL,
  message      VARCHAR(500) NULL,
  is_resolved  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_alerts_machine_type (machine_id, alert_type, is_resolved),
  KEY idx_alerts_resolved_created (is_resolved, created_at),
  CONSTRAINT fk_alerts_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 17. downtime_events — opened / closed every 5 minutes by the SLA job.
--     excluded = 1 → planned maintenance or excused (not counted).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downtime_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id  VARCHAR(20)  NOT NULL,
  reason      ENUM('OFFLINE','OUT_OF_PAPER','PRINTER_ERROR','MAINTENANCE') NOT NULL,
  started_at  DATETIME NOT NULL,
  ended_at    DATETIME NULL,
  excluded    TINYINT(1) NOT NULL DEFAULT 0,
  notes       VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_downtime_machine_started (machine_id, started_at),
  KEY idx_downtime_open (ended_at),
  CONSTRAINT fk_downtime_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 18. sla_reports — one row per machine per month (recomputed daily).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_reports (
  id                           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id                   VARCHAR(20)  NOT NULL,
  contract_id                  INT UNSIGNED NULL,
  month                        DATE NOT NULL,
  scheduled_minutes            INT UNSIGNED NOT NULL DEFAULT 0,
  downtime_minutes             INT UNSIGNED NOT NULL DEFAULT 0,
  uptime_pct                   DECIMAL(6,3) NOT NULL DEFAULT 100,
  sla_target_pct               DECIMAL(5,2) NULL,
  breached                     TINYINT(1)   NOT NULL DEFAULT 0,
  penalty_amount               DECIMAL(12,2) NOT NULL DEFAULT 0,
  tickets_total                INT UNSIGNED NOT NULL DEFAULT 0,
  tickets_response_breached    INT UNSIGNED NOT NULL DEFAULT 0,
  tickets_resolution_breached  INT UNSIGNED NOT NULL DEFAULT 0,
  is_final                     TINYINT(1)   NOT NULL DEFAULT 0,
  generated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sla_machine_month (machine_id, month),
  KEY idx_sla_contract_month (contract_id, month),
  CONSTRAINT fk_sla_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 19. support_tickets + support_ticket_updates
--     complained_at → first_response_at → resolved_at give the response
--     and resolution times used in SLA reports.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_no          VARCHAR(20)  NULL,
  machine_id         VARCHAR(20)  NULL,
  organization_id    INT UNSIGNED NULL,
  job_id             VARCHAR(40)  NULL,
  raised_by_type     ENUM('OFFICER','VENDOR','ADMIN','CUSTOMER') NOT NULL,
  raised_by_id       INT UNSIGNED NULL,
  contact_phone      VARCHAR(20)  NULL,
  category           ENUM('MACHINE_DOWN','PAPER_TONER','PRINT_QUALITY','PAYMENT','REFUND','OTHER') NOT NULL DEFAULT 'OTHER',
  priority           ENUM('LOW','NORMAL','HIGH','CRITICAL') NOT NULL DEFAULT 'NORMAL',
  subject            VARCHAR(200) NOT NULL,
  description        TEXT NULL,
  status             ENUM('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  complained_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_response_at  DATETIME NULL,
  resolved_at        DATETIME NULL,
  closed_at          DATETIME NULL,
  assigned_to        INT UNSIGNED NULL,
  resolution_notes   VARCHAR(1000) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_no (ticket_no),
  KEY idx_tickets_status (status, complained_at),
  KEY idx_tickets_machine (machine_id, complained_at),
  KEY idx_tickets_org (organization_id),
  KEY idx_tickets_raised (raised_by_type, raised_by_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_ticket_updates (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id    INT UNSIGNED NOT NULL,
  author_type  ENUM('OFFICER','VENDOR','ADMIN','CUSTOMER','SYSTEM') NOT NULL,
  author_id    INT UNSIGNED NULL,
  author_name  VARCHAR(150) NULL,
  message      TEXT NULL,
  status_from  VARCHAR(20) NULL,
  status_to    VARCHAR(20) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_updates_ticket (ticket_id, created_at),
  CONSTRAINT fk_ticket_updates_ticket FOREIGN KEY (ticket_id)
    REFERENCES support_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 20. invoices + invoice_sequences
--     Financial-year numbering (April–March, IST), one series per type:
--       R = customer receipts, D = department invoices, M = manual.
--     invoice_no is at most 16 characters (GST rule 46), e.g. SP/26-27/R000123.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_sequences (
  series          VARCHAR(4) NOT NULL,
  financial_year  CHAR(5)    NOT NULL,
  last_no         INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (series, financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_no       VARCHAR(20)  NOT NULL,
  series           VARCHAR(4)   NOT NULL,
  financial_year   CHAR(5)      NOT NULL,
  invoice_type     ENUM('CUSTOMER_RECEIPT','DEPARTMENT','MANUAL') NOT NULL,
  is_tax_invoice   TINYINT(1)   NOT NULL DEFAULT 0,
  job_id           VARCHAR(40)  NULL,
  contract_id      INT UNSIGNED NULL,
  organization_id  INT UNSIGNED NULL,
  vendor_id        INT UNSIGNED NULL,
  machine_id       VARCHAR(20)  NULL,
  period_start     DATE NULL,
  period_end       DATE NULL,
  buyer_name       VARCHAR(200) NULL,
  buyer_gstin      VARCHAR(20)  NULL,
  buyer_address    VARCHAR(500) NULL,
  place_of_supply  VARCHAR(100) NULL,
  seller_name      VARCHAR(200) NULL,
  seller_gstin     VARCHAR(20)  NULL,
  seller_address   VARCHAR(500) NULL,
  line_items       JSON NOT NULL,
  taxable_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst             DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst             DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst             DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  status           ENUM('ISSUED','PAID','CANCELLED') NOT NULL DEFAULT 'ISSUED',
  issued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date         DATE NULL,
  paid_at          DATETIME NULL,
  payment_ref      VARCHAR(100) NULL,
  cancelled_reason VARCHAR(255) NULL,
  notes            VARCHAR(500) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_no (invoice_no),
  UNIQUE KEY uq_invoices_job (job_id),
  KEY idx_invoices_type_issued (invoice_type, issued_at),
  KEY idx_invoices_org (organization_id, issued_at),
  KEY idx_invoices_contract (contract_id, period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 21. settlements — revenue-share payouts to an office (PAY_TO_ORG), or
--     amounts an organisation owes the operator (RECEIVE_FROM_ORG).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id      INT UNSIGNED NOT NULL,
  organization_id  INT UNSIGNED NOT NULL,
  vendor_id        INT UNSIGNED NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  gross_revenue    DECIMAL(12,2) NOT NULL DEFAULT 0,
  share_pct        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  share_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  direction        ENUM('PAY_TO_ORG','RECEIVE_FROM_ORG') NOT NULL DEFAULT 'PAY_TO_ORG',
  status           ENUM('PENDING','APPROVED','PAID','CANCELLED') NOT NULL DEFAULT 'PENDING',
  reference        VARCHAR(100) NULL,
  paid_at          DATETIME NULL,
  approved_by      INT UNSIGNED NULL,
  approved_at      DATETIME NULL,
  notes            VARCHAR(500) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_settlements_contract (contract_id, period_start),
  KEY idx_settlements_org (organization_id),
  KEY idx_settlements_vendor (vendor_id, status),
  CONSTRAINT fk_settlements_contract FOREIGN KEY (contract_id)
    REFERENCES contracts (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 22. audit_logs — no foreign keys on purpose: logs must survive deletes.
--     action_type is free text (e.g. FILE_DELETED, CONTRACT_CREATED).
--     actor_type + actor_id say who did it; ip is the request address.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id      VARCHAR(20)  NULL,
  job_id          VARCHAR(40)  NULL,
  action_type     VARCHAR(50)  NOT NULL DEFAULT 'OTHER',
  actor_type      ENUM('ADMIN','VENDOR','OFFICER','DEVICE','SYSTEM','CUSTOMER') NOT NULL DEFAULT 'SYSTEM',
  actor_id        INT UNSIGNED NULL,
  actor_admin_id  INT UNSIGNED NULL,
  ip              VARCHAR(64)  NULL,
  details         JSON         NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_machine (machine_id),
  KEY idx_audit_job (job_id),
  KEY idx_audit_action_created (action_type, created_at),
  KEY idx_audit_actor (actor_type, actor_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 23. bank_accounts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vendor_id       INT UNSIGNED NOT NULL,
  bank_name       VARCHAR(150) NOT NULL,
  account_holder  VARCHAR(150) NOT NULL,
  account_number  VARCHAR(34)  NOT NULL,
  ifsc            VARCHAR(11)  NOT NULL,
  branch_name     VARCHAR(150) NULL,
  account_type    ENUM('SAVINGS','CURRENT') NOT NULL DEFAULT 'SAVINGS',
  verified        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_accounts_vendor (vendor_id),
  CONSTRAINT fk_bank_vendor FOREIGN KEY (vendor_id)
    REFERENCES vendors (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 24. withdrawals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vendor_id     INT UNSIGNED NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  status        ENUM('PENDING','APPROVED','REJECTED','PAID') NOT NULL DEFAULT 'PENDING',
  remarks       VARCHAR(500) NULL,
  requested_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at   DATETIME NULL,
  approved_by   INT UNSIGNED NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_withdrawals_vendor_status (vendor_id, status),
  KEY idx_withdrawals_requested (requested_at),
  CONSTRAINT fk_withdrawals_vendor FOREIGN KEY (vendor_id)
    REFERENCES vendors (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_withdrawals_admin FOREIGN KEY (approved_by)
    REFERENCES admin_users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 25. payouts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payouts (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  withdrawal_id  INT UNSIGNED NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  status         ENUM('PENDING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  reference      VARCHAR(100) NULL,
  paid_at        DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payouts_withdrawal (withdrawal_id),
  CONSTRAINT fk_payouts_withdrawal FOREIGN KEY (withdrawal_id)
    REFERENCES withdrawals (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 26. machine_stats_daily
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_stats_daily (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id     VARCHAR(20)  NOT NULL,
  `date`         DATE         NOT NULL,
  total_jobs     INT UNSIGNED NOT NULL DEFAULT 0,
  total_pages    INT UNSIGNED NOT NULL DEFAULT 0,
  total_revenue  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stats_machine_date (machine_id, `date`),
  CONSTRAINT fk_stats_machine FOREIGN KEY (machine_id)
    REFERENCES machines (machine_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
