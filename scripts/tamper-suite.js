/**
 * Systematic tamper (mutation) suite.
 *
 * Proves the acceptance criterion "rejection of modified content" across a
 * broad, deterministic set of mutations instead of a single flipped byte:
 *
 *   1. single-bit flips at positions across the whole document
 *   2. truncation, extension, header corruption, block zeroing, wrong file
 *   3. a modified *transcript* (grade changed) re-hashed by the attacker
 *   4. direct database tampering: the DB digest is overwritten behind the
 *      chain's back and the cross-check must flag the inconsistency
 *
 * Prerequisites: backend + chain + seeded DB running.
 * Run:  node scripts/tamper-suite.js
 */
const { ethers } = require("ethers");
const { canonicalJSON } = require("../backend/chain");
const { pool } = require("../backend/db");

const BASE = process.env.API_BASE || "http://localhost:5001";

const ISSUER = {
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
};

let checked = 0;
let rejected = 0;

function assert(cond, label, extra) {
  if (!cond) {
    console.error(`  ✘ ${label}${extra ? ` — ${JSON.stringify(extra)}` : ""}`);
    throw new Error(`ASSERTION FAILED: ${label}`);
  }
  console.log(`  ✔ ${label}`);
}

async function call(p, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Every mutated document must be rejected by the hash lookup. */
async function expectRejected(bytes, label) {
  checked += 1;
  const digest = ethers.sha256(bytes);
  const res = await call(`/verify/hash/${digest}`);
  if (res.status === 404 && res.data.found === false) {
    rejected += 1;
  } else {
    throw new Error(`TAMPERED DOCUMENT ACCEPTED: ${label} (status ${res.status})`);
  }
}

async function login() {
  const nonce = await call("/auth/nonce", { method: "POST", body: { wallet: ISSUER.wallet } });
  const signature = await new ethers.Wallet(ISSUER.key).signMessage(nonce.data.message);
  const session = await call("/auth/verify", {
    method: "POST",
    body: { wallet: ISSUER.wallet, message: nonce.data.message, signature },
  });
  if (!session.data.token) throw new Error("login failed");
  return session.data.token;
}

async function main() {
  const token = await login();

  const students = await call("/users?role=STUDENT", { token });
  const ada = students.data.find((u) => u.email === "ada@student.edu") || students.data[0];

  // ------------------------------------------------- issue a real PDF record
  // Deterministic multi-KB document so mutations land in varied regions.
  const original = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "utf8"),
    Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 256)),
    Buffer.from("\ntrailer\n%%EOF\n", "utf8"),
  ]);
  const issue = await call("/records", {
    method: "POST",
    token,
    body: {
      studentId: ada.id,
      term: "Tamper-2026",
      pdfBase64: original.toString("base64"),
      fileName: "transcript.pdf",
    },
  });
  assert(issue.status === 201 && issue.data.chain?.anchored, `control record ${issue.data.record?.credId} issued`);
  const controlDigest = ethers.sha256(original);
  assert(issue.data.record.pdfHash === controlDigest, "control digest stored");

  // Control: the untouched document must still verify.
  const ok = await call(`/verify/hash/${controlDigest}`);
  assert(ok.status === 200 && ok.data.found, "untouched document still verifies (control)");

  // ------------------------------------------------------- mutation battery
  console.log("\n• single-bit flips across the document");
  const positions = [0, 1, 7, 32, 100, 511, 1024, 1500, 2048, 2500, 3000, 3500, 4000, original.length - 20, original.length - 2, original.length - 1];
  for (const pos of positions) {
    const mutated = Buffer.from(original);
    mutated[pos] ^= 0x01; // flip exactly one bit
    await expectRejected(mutated, `bit flip @${pos}`);
  }
  assert(rejected === positions.length, `${positions.length} single-bit mutations all rejected`);

  console.log("\n• structural mutations");
  const structural = [
    ["truncated by one byte", original.subarray(0, original.length - 1)],
    ["extended by one byte", Buffer.concat([original, Buffer.from([0x00])])],
    ["header corrupted", Buffer.concat([Buffer.from("%PDQ-1.4\n"), original.subarray(10)])],
    ["middle block zeroed", (() => { const m = Buffer.from(original); m.fill(0, 1024, 1088); return m; })()],
    ["completely different file", Buffer.from("%PDF-1.4\nforged transcript content\n%%EOF\n")],
    ["empty file", Buffer.alloc(0)],
  ];
  for (const [label, bytes] of structural) {
    await expectRejected(bytes, label);
  }
  assert(rejected === positions.length + structural.length, "structural mutations all rejected");

  // ---------------------------------------- modified transcript (re-hashed)
  console.log("\n• modified academic content (attacker re-hashes after editing)");
  const transcript = await call(`/records/${issue.data.record.credId}`, { token });
  const forged = JSON.parse(JSON.stringify(transcript.data.transcript));
  forged.gpa = 4.0; // attacker upgrades the GPA
  forged.courses[0].grade = "A+";
  await expectRejected(Buffer.from(canonicalJSON(forged), "utf8"), "forged transcript JSON");
  assert(rejected === positions.length + structural.length + 1, "forged transcript rejected");

  // ------------------------------------------------ DB-behind-the-chain tamper
  console.log("\n• database tampering behind the chain's back");
  const credId = issue.data.record.credId;
  const [[row]] = await pool.execute(
    "SELECT pdf_hash FROM academic_records WHERE cred_id = ?",
    [credId]
  );
  const fake = ethers.sha256(ethers.toUtf8Bytes("attacker-controlled-digest"));
  try {
    await pool.execute("UPDATE academic_records SET pdf_hash = ? WHERE cred_id = ?", [
      fake,
      credId,
    ]);
    const poisoned = await call(`/verify/${credId}`);
    assert(poisoned.status === 200, "record still exists after DB tampering");
    assert(
      poisoned.data.verification.consistent === false,
      "DB/chain cross-check flags the inconsistency"
    );
    assert(
      poisoned.data.verification.database === "ACTIVE" &&
        poisoned.data.chain.status === "Active",
      "both sides still reported (mismatch visible, not hidden)"
    );
  } finally {
    await pool.execute("UPDATE academic_records SET pdf_hash = ? WHERE cred_id = ?", [
      row.pdf_hash,
      credId,
    ]);
  }
  const restored = await call(`/verify/${credId}`);
  assert(restored.data.verification.consistent === true, "digest restored, consistency back");

  console.log(
    `\nTAMPER SUITE PASSED — ${checked}/${checked} mutations rejected, DB tamper detected`
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("\nTAMPER SUITE FAILED:", err.message);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
