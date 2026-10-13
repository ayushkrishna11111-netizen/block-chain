const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { pinToPinata } = require("../chain");
const { config } = require("../db");

const router = express.Router();

/**
 * Direct IPFS pinning for issuer-side assets.
 * POST /api/ipfs/pin { fileName, contentBase64 }
 */
router.post("/pin", requireAuth, requireRole("ADMIN", "ISSUER"), async (req, res, next) => {
  try {
    const { fileName, contentBase64 } = req.body || {};
    if (!contentBase64) return res.status(400).json({ error: "contentBase64 is required" });
    if (!config.pinata.jwt) {
      return res.status(503).json({ error: "PINATA_JWT is not configured on the server" });
    }
    const buffer = Buffer.from(contentBase64, "base64");
    const pinned = await pinToPinata(buffer, fileName || "document.pdf");
    res.json(pinned);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
