const express = require("express");
const { pool, config } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const ROLES = ["ADMIN", "ISSUER", "STUDENT", "VERIFIER"];

/**
 * List users. GET /api/users?role=ISSUER
 * Any authenticated user may list students (needed by the issuer UI);
 * full listing is available to ISSUER/ADMIN.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { role, q } = req.query;
    const clauses = [];
    const params = [];
    if (role) {
      clauses.push("role = ?");
      params.push(String(role));
    }
    if (q) {
      clauses.push("(full_name LIKE ? OR email LIKE ? OR wallet_address LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.execute(
      `SELECT id, wallet_address, full_name, email, role, department, created_at
         FROM users ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        wallet: r.wallet_address,
        fullName: r.full_name,
        email: r.email,
        role: r.role,
        department: r.department,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/** Register a user with an explicit role (invite-code protected if configured). */
router.post("/", async (req, res, next) => {
  try {
    const { wallet_address, full_name, email, role, department, code } = req.body || {};
    if (!wallet_address || !full_name || !email || !role) {
      return res
        .status(400)
        .json({ error: "wallet_address, full_name, email and role are required" });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (config.registrationCode && code !== config.registrationCode) {
      return res.status(403).json({ error: "Invalid registration code" });
    }

    const [result] = await pool.execute(
      `INSERT INTO users (wallet_address, full_name, email, role, department)
       VALUES (?, ?, ?, ?, ?)`,
      [wallet_address.toLowerCase(), full_name, email, role, department || null]
    );
    res.status(201).json({ id: result.insertId, wallet: wallet_address.toLowerCase(), role });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Wallet or email already registered" });
    }
    next(err);
  }
});

/** Update role / profile. PATCH /api/users/:id (ADMIN) */
router.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { full_name, email, role, department } = req.body || {};
    const fields = [];
    const params = [];
    if (full_name) {
      fields.push("full_name = ?");
      params.push(full_name);
    }
    if (email) {
      fields.push("email = ?");
      params.push(email);
    }
    if (role) {
      if (!ROLES.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      fields.push("role = ?");
      params.push(role);
    }
    if (department !== undefined) {
      fields.push("department = ?");
      params.push(department || null);
    }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

    params.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
