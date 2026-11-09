// middleware/verifyCustomerToken.js
const jwt = require("jsonwebtoken");

function readToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

// Strict — blocks the request if token missing/invalid
function verifyCustomerToken(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: "Missing or expired session" });
    req.customer = jwt.verify(token, process.env.JWT_SECRET); // { customerId, mobile, role }
    if (req.customer.role !== "customer") return res.status(401).json({ error: "Invalid session" });
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

/* Used on the upload / job / payment routes.
   Attaches req.customer when a valid customer token is sent, otherwise continues
   as a guest. Whether a login is REQUIRED is decided per machine
   (machines.require_login, falling back to REQUIRE_CUSTOMER_LOGIN) inside the
   controllers that know the machine: upload-url and create-payment. */
function customerAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === "customer") req.customer = decoded;
    return next();
  } catch {
    // An expired token must not silently turn into a guest on a login-required
    // machine — tell the page so it can show the login screen again.
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }
}

/* SQL condition limiting a query to jobs this requester owns.
   Logged-in customer → only their jobs.
   Guest              → only guest jobs (customer_id IS NULL); the random jobId identifies the job. */
function jobOwnerFilter(req) {
  return req.customer
    ? { sql: "customer_id=?", params: [req.customer.customerId] }
    : { sql: "customer_id IS NULL", params: [] };
}

module.exports = { verifyCustomerToken, customerAuth, jobOwnerFilter };
