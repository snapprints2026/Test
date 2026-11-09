// src/middleware/rateLimit.js
// Small in-memory rate limiter (one Railway instance is enough for this).
//   router.post("/login", rateLimit({ max: 10, windowMinutes: 15 }), handler)
// key defaults to the client IP; pass keyFn to limit per phone number etc.
function rateLimit({ max = 20, windowMinutes = 15, keyFn = null, message = "Too many attempts. Try again later." } = {}) {
  const hits = new Map();
  const windowMs = windowMinutes * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.since > windowMs) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : null) || req.ip || "unknown";
    const now = Date.now();
    const h = hits.get(key) || { n: 0, since: now };
    if (now - h.since > windowMs) { h.n = 0; h.since = now; }
    h.n += 1;
    hits.set(key, h);
    if (h.n > max) return res.status(429).json({ error: message });
    next();
  };
}

module.exports = { rateLimit };
