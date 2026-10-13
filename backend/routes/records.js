const express = require("express");
const { pool, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  recordIdOf,
  sha256Hex,
  canonicalJSON,
  issueOnChain,
  updateStatusOnChain,
  supersedeOnChain,
  pinToPinata,
  getReadContract,
  buildTxRequest,
  confirmClientTx,
} = require("../chain");
const {
  credentialMessage,
  signCredentialServer,
  verifyCredentialSignature,
} = require("../credential");
const { storeDocument, readDocument } = require("../storage");
const { computeGpa } = require("../grades");
const { audit } = require("../audit");

const router = express.Router();

const STATUS_TO_CHAIN = { REVOKED: 1, SUPERSEDED: 2 };

/**
 * A CRED id is usable only if it is free both in MySQL and on-chain
 * (a database restored from backup can collide with records already anchored
 * on a persistent chain). Returns true when the id is free or when the chain
 * cannot be reached, so issuance is never blocked by a read failure.
 */
async function isFreeOnChain(credId) {
  try {
    const exists = await getReadContract().recordExists(recordIdOf(credId));
    return !exists;
  } catch {
    return true;
  }
}

/** Generate the next human-readable record id: CRED-2026-001 */
async function nextCredId() {
  const year = new Date().getFullYear();
  const [rows] = await pool.execute("SELECT COUNT(*) AS c FROM academic_records");
  let seq = Number(rows[0].c) + 1;
  let credId = `CRED-${year}-${String(seq).padStart(3, "0")}`;

  // Guard against collisions in either the database or the ledger.
  for (let i = 0; i < 500; i++) {
    credId = `CRED-${year}-${String(seq).padStart(3, "0")}`;
    const [dup] = await pool.execute(
      "SELECT id FROM academic_records WHERE cred_id = ?",
      [credId]
    );
    if (!dup.length && (await isFreeOnChain(credId))) return credId;
    seq += 1;
  }
  throw new Error("Could not allocate a unique CRED id");
}

/** Build the canonical transcript document from live academic data. */
async function buildTranscript({ credId, studentId, term, programId }) {
  const [users] = await pool.execute(
    `SELECT id, wallet_address, full_name, email, program_id FROM users WHERE id = ?`,
    [Number(studentId)]
  );
  const student = users[0];
  if (!student) return null;

  const [courses] = await pool.execute(
    `SELECT e.term, e.grade, e.grade_points, e.status,
            c.course_code, c.title, c.credits
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.student_id = ? AND e.status = 'COMPLETED'
      ORDER BY e.term, c.course_code`,
    [Number(studentId)]
  );

  const effectiveProgramId = programId || student.program_id || null;
  let program = null;
  if (effectiveProgramId) {
    const [programs] = await pool.execute(
      "SELECT id, program_code, program_name, degree_title, total_credits FROM programs WHERE id = ?",
      [effectiveProgramId]
    );
    program = programs[0] || null;
  }

  const gpa = computeGpa(courses);
  const totalCredits = courses.reduce((sum, c) => sum + Number(c.credits || 0), 0);

  return {
    credId,
    programId: effectiveProgramId,
    schema: "https://www.w3.org/2018/credentials/v1",
    type: ["VerifiableCredential", "AcademicTranscript"],
    student: {
      id: student.id,
      name: student.full_name,
      wallet: student.wallet_address,
    },
    program: program
      ? {
          code: program.program_code,
          name: program.program_name,
          degree: program.degree_title,
          totalCredits: Number(program.total_credits),
        }
      : null,
    term,
    issuedFor: new Date().toISOString(),
    courses: courses.map((c) => ({
      code: c.course_code,
      title: c.title,
      credits: Number(c.credits),
      grade: c.grade,
      term: c.term,
    })),
    gpa,
    totalCredits,
  };
}

function serializeRow(r) {
  return {
    id: r.id,
    credId: r.cred_id,
    recordId: r.record_id,
    studentId: r.student_id,
    studentName: r.student_name,
    studentWallet: r.student_wallet,
    programId: r.program_id,
    programName: r.program_name,
    term: r.term,
    gpa: r.gpa === null ? null : Number(r.gpa),
    totalCredits: r.total_credits,
    pdfHash: r.pdf_hash,
    ipfsCID: r.ipfs_cid,
    txHash: r.tx_hash,
    status: r.status,
    supersededBy: r.superseded_by,
    issuerWallet: r.issuer_wallet,
    issuerSigner: r.issuer_signer || null,
    issuedAt: r.issued_at,
    createdAt: r.created_at,
    hasDocument: Boolean(r.doc_path),
  };
}

const SELECT_RECORDS = `
  SELECT r.*, u.full_name AS student_name, u.wallet_address AS student_wallet,
         p.program_name
    FROM academic_records r
    JOIN users u ON u.id = r.student_id
    LEFT JOIN programs p ON p.id = r.program_id
`;

// ---------------------------------------------------------------- listing
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { status, studentId, q } = req.query;
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push("r.status = ?");
      params.push(String(status).toUpperCase());
    }
    if (studentId) {
      clauses.push("r.student_id = ?");
      params.push(Number(studentId));
    }
    if (q) {
      clauses.push("(r.cred_id LIKE ? OR u.full_name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    // Students may only read their own records unless issuer/admin.
    if (!["ADMIN", "ISSUER"].includes(req.user.role)) {
      clauses.push("r.student_id = ?");
      params.push(req.user.id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.execute(
      `${SELECT_RECORDS} ${where} ORDER BY r.id DESC LIMIT 200`,
      params
    );
    res.json(rows.map(serializeRow));
  } catch (err) {
    next(err);
  }
});

router.get("/stats", requireAuth, async (_req, res, next) => {
  try {
    const [[counts]] = await pool.execute(
      `SELECT
         SUM(status = 'ACTIVE')   AS active,
         SUM(status = 'REVOKED')  AS revoked,
         SUM(status = 'SUPERSEDED') AS superseded,
         SUM(status = 'DRAFT')    AS draft,
         COUNT(*)                 AS total
       FROM academic_records`
    );
    const [[people]] = await pool.execute(
      `SELECT
         SUM(role = 'STUDENT') AS students,
         SUM(role = 'ISSUER')  AS issuers,
         SUM(role = 'ADMIN')   AS admins,
         COUNT(*)              AS users
       FROM users`
    );
    const [[academics]] = await pool.execute(
      `SELECT (SELECT COUNT(*) FROM courses) AS courses,
              (SELECT COUNT(*) FROM programs) AS programs,
              (SELECT COUNT(*) FROM enrollments WHERE status = 'COMPLETED') AS completedGrades`
    );
    res.json({
      records: {
        active: Number(counts.active || 0),
        revoked: Number(counts.revoked || 0),
        superseded: Number(counts.superseded || 0),
        draft: Number(counts.draft || 0),
        total: Number(counts.total || 0),
      },
      users: {
        students: Number(people.students || 0),
        issuers: Number(people.issuers || 0),
        admins: Number(people.admins || 0),
        total: Number(people.users || 0),
      },
      academics,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:credId", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`${SELECT_RECORDS} WHERE r.cred_id = ?`, [
      req.params.credId,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Record not found" });
    const row = rows[0];
    if (
      !["ADMIN", "ISSUER"].includes(req.user.role) &&
      row.student_id !== req.user.id
    ) {
      return res.status(403).json({ error: "You can only read your own records" });
    }
    const [full] = await pool.execute(
      "SELECT transcript_json, issuer_signature, issuer_signer FROM academic_records WHERE cred_id = ?",
      [req.params.credId]
    );
    res.json({
      ...serializeRow(row),
      transcript: JSON.parse(full[0].transcript_json),
      credential: verifyCredentialSignature({
        credId: row.cred_id,
        digest: row.pdf_hash,
        signature: full[0].issuer_signature,
        signer: full[0].issuer_signer,
      }),
      credentialMessage: credentialMessage(row.cred_id, row.pdf_hash),
    });
  } catch (err) {
    next(err);
  }
});

/** Download the stored (encrypted-at-rest) credential document. */
router.get("/:credId/document", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT doc_path, student_id, status FROM academic_records WHERE cred_id = ?",
      [req.params.credId]
    );
    if (!rows.length || !rows[0].doc_path) {
      return res.status(404).json({ error: "No stored document for this record" });
    }
    if (
      !["ADMIN", "ISSUER"].includes(req.user.role) &&
      rows[0].student_id !== req.user.id
    ) {
      return res.status(403).json({ error: "You can only read your own records" });
    }
    const bytes = readDocument(rows[0].doc_path);
    if (!bytes) return res.status(404).json({ error: "Stored document is missing" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.credId}.pdf"`
    );
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- issuance
/**
 * Issue (or supersede) an academic record.
 * POST /api/records
 * body: { studentId, term, programId?, replaces?, pdfBase64?, fileName?,
 *         mode?: 'server' | 'client' }
 *
 * mode 'server' (default): the backend signs the anchoring transaction.
 * mode 'client': the record stays DRAFT and the response carries an unsigned
 * transaction request for the browser wallet (MetaMask) to sign; the client
 * then calls POST /api/records/:credId/confirm with the transaction hash.
 */
router.post("/", requireAuth, requireRole("ADMIN", "ISSUER"), async (req, res, next) => {
  try {
    const { studentId, term, programId, replaces, pdfBase64, fileName, mode } =
      req.body || {};
    if (!studentId || !term) {
      return res.status(400).json({ error: "studentId and term are required" });
    }
    if (String(term).length > 20) {
      return res
        .status(400)
        .json({ error: "term must be 20 characters or fewer (e.g. Spring-2026)" });
    }

    if (replaces) {
      const [oldRows] = await pool.execute(
        "SELECT status FROM academic_records WHERE cred_id = ?",
        [replaces]
      );
      if (!oldRows.length) return res.status(404).json({ error: "Record to replace not found" });
      if (oldRows[0].status !== "ACTIVE") {
        return res.status(409).json({ error: "Only ACTIVE records can be superseded" });
      }
    }

    const clientMode = mode === "client";
    const credId = await nextCredId();
    const transcript = await buildTranscript({ credId, studentId, term, programId });
    if (!transcript) return res.status(404).json({ error: "Student not found" });

    const canonical = canonicalJSON(transcript);
    let documentBytes = Buffer.from(canonical, "utf8");
    let ipfsCID = null;

    if (pdfBase64) {
      documentBytes = Buffer.from(pdfBase64, "base64");
      const pinned = await pinToPinata(documentBytes, fileName || `${credId}.pdf`);
      if (pinned) ipfsCID = pinned.cid;
    }

    const pdfHash = sha256Hex(documentBytes);
    const recordId = recordIdOf(credId);

    const docPath = pdfBase64 ? storeDocument(credId, documentBytes) : null;
    const credential = clientMode ? null : signCredentialServer(credId, pdfHash);

    const insertedId = await withTransaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO academic_records
           (cred_id, record_id, student_id, program_id, term, gpa, total_credits,
            transcript_json, pdf_hash, ipfs_cid, doc_path, status, issuer_wallet,
            issuer_signature, issuer_signer, replaces_cred_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
        [
          credId,
          recordId,
          Number(studentId),
          programId || transcript.programId || null,
          term,
          transcript.gpa,
          transcript.totalCredits,
          canonical,
          pdfHash,
          ipfsCID,
          docPath,
          req.user.wallet_address,
          credential ? credential.signature : null,
          credential ? credential.signer : null,
          replaces || null,
        ]
      );
      return result.insertId;
    });

    // ---- client-signed mode: hand the unsigned transaction to the wallet.
    if (clientMode) {
      const txRequest = await buildTxRequest(
        replaces
          ? { kind: "supersede", oldCredId: replaces, newCredId: credId, hash: pdfHash, cid: ipfsCID }
          : { kind: "issue", credId, hash: pdfHash, cid: ipfsCID }
      );
      const [rows] = await pool.execute(`${SELECT_RECORDS} WHERE r.id = ?`, [insertedId]);
      return res.status(201).json({
        record: serializeRow(rows[0]),
        transcript,
        chain: { anchored: false, mode: "client" },
        txRequest,
        credentialMessage: credentialMessage(credId, pdfHash),
      });
    }

    // ---- anchor on-chain (verification feature, wrapped around the DB record)
    let chain = { anchored: false, txHash: null, error: null };
    try {
      const tx = replaces
        ? await supersedeOnChain(replaces, credId, pdfHash, ipfsCID)
        : await issueOnChain(credId, pdfHash, ipfsCID);
      chain = { anchored: true, txHash: tx.txHash, blockNumber: tx.blockNumber };

      await pool.execute(
        `UPDATE academic_records
            SET status = 'ACTIVE', tx_hash = ?, issued_at = NOW()
          WHERE id = ?`,
        [tx.txHash, insertedId]
      );

      if (replaces) {
        await pool.execute(
          `UPDATE academic_records
              SET status = 'SUPERSEDED', superseded_by = ?
            WHERE cred_id = ?`,
          [recordId, replaces]
        );
      }
      await audit(
        replaces ? "RECORD_SUPERSEDED" : "RECORD_ISSUED",
        req.user.wallet_address,
        credId,
        replaces ? `replaces ${replaces} tx ${tx.txHash}` : `tx ${tx.txHash}`
      );
    } catch (err) {
      chain.error = err.shortMessage || err.message;
      await audit(
        "RECORD_ANCHOR_FAILED",
        req.user.wallet_address,
        credId,
        chain.error.slice(0, 480)
      );
    }

    const [rows] = await pool.execute(`${SELECT_RECORDS} WHERE r.id = ?`, [insertedId]);
    res.status(201).json({ record: serializeRow(rows[0]), transcript, chain });
  } catch (err) {
    next(err);
  }
});

/**
 * Finalise a client-signed issuance.
 * POST /api/records/:credId/confirm
 * body: { txHash, credentialSignature?, credentialSigner? }
 */
router.post(
  "/:credId/confirm",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { txHash, credentialSignature, credentialSigner } = req.body || {};
      if (!txHash) return res.status(400).json({ error: "txHash is required" });

      const [rows] = await pool.execute("SELECT * FROM academic_records WHERE cred_id = ?", [
        req.params.credId,
      ]);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Record not found" });
      if (row.status !== "DRAFT") {
        return res.status(409).json({ error: `Record is already ${row.status}` });
      }

      const expected = [row.cred_id];
      if (row.replaces_cred_id) expected.push(row.replaces_cred_id);

      let receiptInfo;
      try {
        receiptInfo = await confirmClientTx(txHash, { expectedRecordIds: expected });
      } catch (err) {
        await audit(
          "RECORD_ANCHOR_FAILED",
          req.user.wallet_address,
          row.cred_id,
          String(err.message).slice(0, 480)
        );
        return res.status(422).json({ error: err.message });
      }

      // The credential signature must come from the wallet that sent the tx.
      if (credentialSignature) {
        const check = verifyCredentialSignature({
          credId: row.cred_id,
          digest: row.pdf_hash,
          signature: credentialSignature,
          signer: credentialSigner || receiptInfo.from,
        });
        if (!check.valid) {
          return res.status(422).json({ error: "Credential signature does not verify" });
        }
        if (check.signer.toLowerCase() !== String(receiptInfo.from).toLowerCase()) {
          return res
            .status(422)
            .json({ error: "Credential signer is not the transaction sender" });
        }
        await pool.execute(
          "UPDATE academic_records SET issuer_signature = ?, issuer_signer = ? WHERE id = ?",
          [credentialSignature, check.signer, row.id]
        );
      }

      await pool.execute(
        `UPDATE academic_records
            SET status = 'ACTIVE', tx_hash = ?, issued_at = NOW()
          WHERE id = ?`,
        [receiptInfo.txHash, row.id]
      );

      if (row.replaces_cred_id) {
        await pool.execute(
          `UPDATE academic_records
              SET status = 'SUPERSEDED', superseded_by = ?
            WHERE cred_id = ?`,
          [row.record_id, row.replaces_cred_id]
        );
      }

      await audit(
        row.replaces_cred_id ? "RECORD_SUPERSEDED" : "RECORD_ISSUED",
        req.user.wallet_address,
        row.cred_id,
        `client-signed tx ${receiptInfo.txHash}`
      );

      const [fresh] = await pool.execute(`${SELECT_RECORDS} WHERE r.id = ?`, [row.id]);
      res.json({ ok: true, record: serializeRow(fresh[0]), txHash: receiptInfo.txHash });
    } catch (err) {
      next(err);
    }
  }
);

/** Retry anchoring a DRAFT record. POST /api/records/:credId/anchor */
router.post(
  "/:credId/anchor",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        "SELECT * FROM academic_records WHERE cred_id = ?",
        [req.params.credId]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Record not found" });
      if (row.status !== "DRAFT") {
        return res.status(409).json({ error: `Record is already ${row.status}` });
      }
      const tx = await issueOnChain(row.cred_id, row.pdf_hash, row.ipfs_cid);
      await pool.execute(
        `UPDATE academic_records SET status = 'ACTIVE', tx_hash = ?, issued_at = NOW() WHERE id = ?`,
        [tx.txHash, row.id]
      );
      if (!row.issuer_signature) {
        const credential = signCredentialServer(row.cred_id, row.pdf_hash);
        if (credential) {
          await pool.execute(
            "UPDATE academic_records SET issuer_signature = ?, issuer_signer = ? WHERE id = ?",
            [credential.signature, credential.signer, row.id]
          );
        }
      }
      await audit("RECORD_ANCHORED", req.user.wallet_address, row.cred_id, tx.txHash);
      res.json({ ok: true, txHash: tx.txHash });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------------- revocation
/**
 * Revoke a record.
 * POST /api/records/:credId/status { status: 'REVOKED', reason?, txHash? }
 * txHash present => client-signed path (the wallet already sent the tx).
 */
router.post(
  "/:credId/status",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { status, reason, txHash } = req.body || {};
      if (status !== "REVOKED") {
        return res
          .status(400)
          .json({ error: "Only REVOKED is supported through this endpoint" });
      }
      const [rows] = await pool.execute(
        "SELECT * FROM academic_records WHERE cred_id = ?",
        [req.params.credId]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Record not found" });
      if (row.status !== "ACTIVE") {
        return res.status(409).json({ error: `Record is already ${row.status}` });
      }

      let chain;
      if (txHash) {
        try {
          const receiptInfo = await confirmClientTx(txHash, {
            expectedRecordIds: [row.cred_id],
          });
          chain = { anchored: true, txHash: receiptInfo.txHash, mode: "client" };
        } catch (err) {
          return res.status(422).json({ error: err.message });
        }
      } else {
        try {
          const tx = await updateStatusOnChain(row.cred_id, STATUS_TO_CHAIN.REVOKED, null);
          chain = { anchored: true, txHash: tx.txHash, mode: "server" };
        } catch (err) {
          const detail = err.shortMessage || err.message;
          return res.status(502).json({ error: "On-chain revocation failed", detail });
        }
      }

      await pool.execute(
        "UPDATE academic_records SET status = 'REVOKED', tx_hash = ? WHERE id = ?",
        [chain.txHash, row.id]
      );
      await audit(
        "RECORD_REVOKED",
        req.user.wallet_address,
        row.cred_id,
        reason || chain.txHash
      );
      res.json({ ok: true, chain });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
