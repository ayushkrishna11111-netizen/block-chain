const express = require("express");
const { ethers } = require("ethers");
const { pool } = require("../db");
const { verifyOnChain } = require("../chain");
const { verifyCredentialSignature } = require("../credential");
const { recentAudit } = require("../audit");

const router = express.Router();

/**
 * Public, zero-authentication verification by record id.
 *
 * Outcomes are deliberately distinct:
 *   - unknown id          -> 404 (neither database nor chain knows it)
 *   - chain unreachable    -> 200 with chainError + chainAvailable:false
 *                             (service unavailable, NEVER "tampered")
 *   - known id             -> database status, chain status, consistency flag,
 *                             and the issuer credential-signature check
 */
async function lookupByCredId(req, res) {
  const credId = String(req.params.credId || "").trim();
  if (!credId) return res.status(400).json({ error: "recordId is required" });

  const [rows] = await pool.execute(
    `SELECT r.cred_id, r.status AS db_status, r.tx_hash, r.ipfs_cid, r.pdf_hash,
            r.superseded_by, r.issued_at, r.issuer_wallet, r.issuer_signature,
            r.issuer_signer, u.full_name AS student_name,
            p.program_name, p.degree_title
       FROM academic_records r
       JOIN users u ON u.id = r.student_id
       LEFT JOIN programs p ON p.id = r.program_id
      WHERE r.cred_id = ? OR r.record_id = ?`,
    [credId, credId]
  );
  const dbRow = rows[0] || null;

  let chain = null;
  let chainError = null;
  try {
    chain = await verifyOnChain(credId);
  } catch (err) {
    chainError = err.shortMessage || err.message;
  }

  if (!dbRow && (!chain || !chain.found)) {
    return res.status(404).json({
      found: false,
      message: "No academic record found for this ID (database and chain)",
    });
  }

  const credential = verifyCredentialSignature({
    credId: dbRow ? dbRow.cred_id : credId,
    digest: dbRow ? dbRow.pdf_hash : (chain ? chain.recordHash : null),
    signature: dbRow ? dbRow.issuer_signature : null,
    signer: dbRow ? dbRow.issuer_signer : null,
  });
  credential.matchesChainIssuer =
    credential.valid &&
    Boolean(chain && chain.found) &&
    credential.signer.toLowerCase() === String(chain.issuer).toLowerCase();

  const statusConsistent =
    Boolean(dbRow && chain && chain.found) &&
    dbRow.db_status.toUpperCase() === chain.status.toUpperCase();
  // The anchored digest must also match the presented bytes: a database row
  // edited behind the chain's back fails this check even when the status agrees.
  const digestMatches =
    Boolean(dbRow && chain && chain.found) &&
    String(dbRow.pdf_hash || "").toLowerCase() ===
      String(chain.recordHash || "").toLowerCase();

  res.json({
    found: true,
    credId,
    verification: {
      database: dbRow ? dbRow.db_status : null,
      chain: chain && chain.found ? chain.status : null,
      chainAvailable: !chainError,
      consistent: statusConsistent && digestMatches,
      statusConsistent,
      digestMatches,
      signature: credential,
    },
    record: dbRow
      ? {
          credId: dbRow.cred_id,
          studentName: dbRow.student_name,
          program: dbRow.program_name,
          degree: dbRow.degree_title,
          status: dbRow.db_status,
          txHash: dbRow.tx_hash,
          ipfsCID: dbRow.ipfs_cid,
          pdfHash: dbRow.pdf_hash,
          supersededBy: dbRow.superseded_by,
          issuedAt: dbRow.issued_at,
          issuerWallet: dbRow.issuer_wallet,
        }
      : null,
    chain: chain || { found: false },
    chainError,
  });
}

/** GET /api/verify/:credId — zero-gas eth_call + database cross-check */
router.get("/:credId", lookupByCredId);

/** GET /api/verify/hash/:pdfHash — drop-a-PDF flow */
router.get("/hash/:pdfHash", async (req, res, next) => {
  try {
    const pdfHash = String(req.params.pdfHash || "").toLowerCase();
    const [rows] = await pool.execute(
      "SELECT cred_id FROM academic_records WHERE LOWER(pdf_hash) = ? LIMIT 1",
      [pdfHash]
    );
    if (!rows.length) {
      return res.status(404).json({
        found: false,
        message: "No issued record matches this document hash",
      });
    }
    req.params.credId = rows[0].cred_id;
    return lookupByCredId(req, res);
  } catch (err) {
    next(err);
  }
});

/** GET /api/verify — recent public activity feed for the landing view */
router.get("/", async (_req, res, next) => {
  try {
    const logs = await recentAudit(15);
    res.json({ activity: logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
