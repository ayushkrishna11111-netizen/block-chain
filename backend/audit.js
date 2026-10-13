const { pool } = require("./db");

/** Append an entry to the immutable audit trail. */
async function audit(action, performedBy, target, details) {
  try {
    await pool.execute(
      "INSERT INTO audit_logs (action, performed_by, target, details) VALUES (?, ?, ?, ?)",
      [action, String(performedBy || "").toLowerCase(), target || null, details || null]
    );
  } catch (err) {
    // Auditing must never break the main flow; surface it in the logs instead.
    console.error("[audit] failed:", err.message);
  }
}

/** Most recent audit entries. */
async function recentAudit(limit = 25) {
  const [rows] = await pool.execute(
    `SELECT id, action, performed_by, target, details, created_at
       FROM audit_logs ORDER BY id DESC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    performedBy: r.performed_by,
    target: r.target,
    details: r.details,
    createdAt: r.created_at,
  }));
}

module.exports = { audit, recentAudit };
