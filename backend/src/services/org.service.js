// src/services/org.service.js
// Organisation tree helpers: State Transport Dept → RTO Panvel → Counter 3.
// Reports for an organisation include everything below it.
const db = require("../database/db");

const SEGMENTS = ["EDUCATION", "RETAIL", "GOVERNMENT", "PSU"];
const ORG_TYPES = ["DEPARTMENT", "OFFICE", "COUNTER", "CAMPUS", "COMPANY", "OTHER"];
// Strict privacy (no file names kept) by default — see the segments document:
// Education, Government and PSU strict; Retail standard. A vendor can override it.
const STRICT_SEGMENTS = new Set(["EDUCATION", "GOVERNMENT", "PSU"]);

/* The organisation and every organisation below it → [ids] */
async function descendantIds(orgId, conn = db) {
  if (!orgId) return [];
  const [rows] = await conn.query(
    `WITH RECURSIVE t AS (
       SELECT id FROM organizations WHERE id=?
       UNION ALL
       SELECT o.id FROM organizations o JOIN t ON o.parent_id = t.id
     ) SELECT id FROM t`,
    [orgId]
  );
  return rows.map((r) => r.id);
}

/* The organisation and every organisation above it → [ids], nearest first */
async function ancestorIds(orgId, conn = db) {
  if (!orgId) return [];
  const [rows] = await conn.query(
    `WITH RECURSIVE t AS (
       SELECT id, parent_id, 0 AS depth FROM organizations WHERE id=?
       UNION ALL
       SELECT o.id, o.parent_id, t.depth + 1 FROM organizations o JOIN t ON o.id = t.parent_id
       WHERE t.depth < 20
     ) SELECT id FROM t ORDER BY depth`,
    [orgId]
  );
  return rows.map((r) => r.id);
}

/* "Transport Dept › RTO Panvel › Counter 3" */
async function orgPath(orgId) {
  const ids = await ancestorIds(orgId);
  if (!ids.length) return "";
  const [rows] = await db.query(`SELECT id, name FROM organizations WHERE id IN (?)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.slice().reverse().map((id) => byId.get(id)).join(" › ");
}

/* Would making `parentId` the parent of `orgId` create a loop? */
async function wouldCreateCycle(orgId, parentId) {
  if (!parentId) return false;
  if (Number(orgId) === Number(parentId)) return true;
  const below = await descendantIds(orgId);
  return below.includes(Number(parentId));
}

/* Flat list with depth + path, ordered as a tree (for dropdowns and tables). */
async function listTree(rootIds = null) {
  const [rows] = await db.query(
    `SELECT o.*, v.full_name AS vendor_name,
            (SELECT COUNT(*) FROM machines m WHERE m.organization_id=o.id) AS machine_count,
            (SELECT COUNT(*) FROM officers f WHERE f.organization_id=o.id) AS officer_count
     FROM organizations o LEFT JOIN vendors v ON v.id=o.vendor_id
     ORDER BY o.name`
  );
  const children = new Map();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    const key = r.parent_id && byId.has(r.parent_id) ? r.parent_id : 0;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(r);
  }
  const out = [];
  const walk = (parentKey, depth, path) => {
    for (const r of children.get(parentKey) || []) {
      const p = path ? `${path} › ${r.name}` : r.name;
      out.push({ ...r, depth, path: p });
      walk(r.id, depth + 1, p);
    }
  };
  if (rootIds && rootIds.length) {
    for (const id of rootIds) {
      const r = byId.get(Number(id));
      if (!r) continue;
      out.push({ ...r, depth: 0, path: r.name });
      walk(r.id, 1, r.name);
    }
  } else {
    walk(0, 0, "");
  }
  return out;
}

module.exports = { SEGMENTS, ORG_TYPES, STRICT_SEGMENTS, descendantIds, ancestorIds, orgPath, wouldCreateCycle, listTree };
