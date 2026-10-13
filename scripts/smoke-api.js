/**
 * End-to-end REST API smoke test.
 *
 * Prerequisites (all local):
 *   1. MySQL with `npm run db:init -w backend && npm run db:seed -w backend`
 *   2. npx hardhat node --port 8546
 *   3. npx hardhat run scripts/deploy.js --network localhost
 *   4. backend running: node backend/server.js
 *
 * Run:  API_BASE=http://localhost:5001 node scripts/smoke-api.js
 *
 * Uses the public Hardhat dev keys to simulate MetaMask's personal_sign.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { CONTRACT_ABI, recordIdOf } = require("../backend/chain");

const BASE = process.env.API_BASE || "http://localhost:5001";

// Hardhat dev accounts (public, zero value).
const ADMIN = {
  wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
};
const ISSUER = {
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
};
const STUDENT = {
  wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  key: "0x5de4111afa1a4b94908f83103eb1f1706367f2e68ca870fc3fb9a804cdab365a",
};
// An "unknown" wallet: address derived from the key so the pair always matches.
const STRANGER_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const STRANGER = {
  wallet: new ethers.Wallet(STRANGER_KEY).address,
  key: STRANGER_KEY,
};

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8546";

let passed = 0;
function assert(cond, label, extra) {
  if (!cond) {
    console.error(`  ✘ ${label}${extra ? ` — ${JSON.stringify(extra)}` : ""}`);
    throw new Error(`ASSERTION FAILED: ${label}`);
  }
  passed += 1;
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

async function callRaw(p, { token } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

/** Simulates the MetaMask wallet login flow. */
async function login({ wallet, key }) {
  const nonce = await call("/auth/nonce", { method: "POST", body: { wallet } });
  assert(nonce.status === 200 && nonce.data.message, `nonce issued for ${wallet.slice(0, 10)}…`);
  const walletSigner = new ethers.Wallet(key);
  const signature = await walletSigner.signMessage(nonce.data.message);
  const session = await call("/auth/verify", {
    method: "POST",
    body: { wallet, message: nonce.data.message, signature },
  });
  assert(
    session.status === 200 && session.data.token,
    `signature verified, session opened (role ${session.data.user?.role})`,
    session.data
  );
  return session.data;
}

async function main() {
  console.log(`API base: ${BASE}\n`);

  // ---------------------------------------------------------------- health
  const health = await call("/health");
  assert(health.data.api === "ok", "API alive");
  assert(health.data.database === true, "MySQL connected");
  assert(health.data.chain === true, "EVM node reachable");
  assert(health.data.contract?.reachable === true, "smart contract reachable");

  // ------------------------------------------------------------ auth / RBAC
  console.log("\n• authentication & RBAC");
  const admin = await login(ADMIN);
  assert(admin.user.role === "ADMIN", "admin wallet resolves to ADMIN role");

  const issuer = await login(ISSUER);
  assert(issuer.user.role === "ISSUER", "issuer wallet resolves to ISSUER role");

  const noAuth = await call("/records");
  assert(noAuth.status === 401, "unauthenticated record access rejected (401)");

  const stranger = await login(STRANGER);
  assert(stranger.user.role === "STUDENT", "unknown wallet auto-provisioned as STUDENT");

  const forbidden = await call("/records", {
    method: "POST",
    token: stranger.token,
    body: { studentId: 1, term: "Fall-2026" },
  });
  assert(forbidden.status === 403, "student blocked from issuing records (403)");

  // --------------------------------------------------------------- academics
  console.log("\n• academic data");
  const students = await call("/users?role=STUDENT", { token: issuer.token });
  const ada = students.data.find((u) => u.email === "ada@student.edu") || students.data[0];
  assert(ada, `student list loaded (${students.data.length} students)`);

  const stats = await call("/records/stats", { token: issuer.token });
  assert(stats.data.academics.courses >= 6, "course catalogue visible in stats");

  // ------------------------------------------------------- record issuance
  console.log("\n• record issuance (DB + on-chain anchor)");
  const issue = await call("/records", {
    method: "POST",
    token: issuer.token,
    body: { studentId: ada.id, term: "Fall-2026" },
  });
  assert(
    issue.status === 201 && issue.data.chain?.anchored === true,
    `record ${issue.data.record?.credId} issued and anchored (tx ${String(
      issue.data.record?.txHash
    ).slice(0, 12)}…)`,
    issue.data
  );
  assert(issue.data.record.status === "ACTIVE", "record status ACTIVE in MySQL");
  assert(
    String(issue.data.record.pdfHash).startsWith("0x") &&
      issue.data.record.pdfHash.length === 66,
    "SHA-256 digest stored (32 bytes hex)"
  );
  const credId = issue.data.record.credId;
  const transcript = issue.data.transcript;
  assert(transcript.courses.length === 5, "transcript compiled from completed grades");
  assert(Number(transcript.gpa) > 3, `GPA computed from grades (${transcript.gpa})`);

  // ----------------------------------------------- issuer credential signature
  console.log("\n• issuer credential signature");
  const detail = await call(`/records/${credId}`, { token: issuer.token });
  assert(
    detail.data.credential?.present === true && detail.data.credential?.valid === true,
    "credential carries a valid issuer signature"
  );
  assert(
    detail.data.credential.signer.toLowerCase() ===
      issue.data.record.issuerSigner.toLowerCase(),
    "stored signer address matches the record"
  );

  // -------------------------------------------------- public verification
  console.log("\n• zero-gas public verification");
  const pub = await call(`/verify/${credId}`);
  assert(pub.status === 200 && pub.data.found, "public lookup by CRED id");
  assert(pub.data.chain.found && pub.data.chain.status === "Active", "chain returns Active");
  assert(pub.data.verification.consistent === true, "MySQL and chain agree");
  assert(
    pub.data.verification.signature.valid === true &&
      pub.data.verification.signature.matchesChainIssuer === true,
    "signature re-verified against the on-chain issuer"
  );

  const bad = await call("/verify/CRED-0000-999");
  assert(bad.status === 404, "unknown record id returns 404");

  // --------------------------------------------- document-hash verification
  console.log("\n• drop-a-PDF verification");
  const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n%%EOF\n", "utf8");
  const issuedPdf = await call("/records", {
    method: "POST",
    token: issuer.token,
    body: {
      studentId: ada.id,
      term: "Spring-2026",
      pdfBase64: fakePdf.toString("base64"),
      fileName: "ada.pdf",
    },
  });
  assert(issuedPdf.status === 201 && issuedPdf.data.chain?.anchored, "PDF record issued");
  const expectedHash = ethers.sha256(fakePdf); // 0x-prefixed SHA-256
  assert(
    issuedPdf.data.record.pdfHash === expectedHash,
    "server-side SHA-256 of the PDF matches the client-side digest"
  );
  const byHash = await call(`/verify/hash/${expectedHash}`);
  assert(byHash.status === 200 && byHash.data.found, "verification by document hash");
  const pdfCredId = issuedPdf.data.record.credId;

  // Tampered content must not match any issued record (acceptance criterion).
  const tampered = Buffer.from(fakePdf);
  tampered[10] = (tampered[10] + 1) % 256;
  const tamperedHash = ethers.sha256(tampered);
  const byTampered = await call(`/verify/hash/${tamperedHash}`);
  assert(
    byTampered.status === 404 && byTampered.data.found === false,
    "tampered document rejected (hash matches no issued record)"
  );

  // ------------------------------------------- encryption at rest (documents)
  console.log("\n• encrypted document storage");
  const download = await callRaw(`/records/${pdfCredId}/document`, { token: issuer.token });
  assert(download.status === 200, "stored document downloads");
  assert(download.buf.equals(fakePdf), "decrypted download equals the original PDF");
  const encPath = path.join(__dirname, "..", "backend", "uploads", `${pdfCredId}.pdf.enc`);
  const onDisk = fs.existsSync(encPath) ? fs.readFileSync(encPath) : Buffer.alloc(0);
  assert(onDisk.length > 0 && !onDisk.equals(fakePdf), "file on disk is AES-GCM ciphertext");

  // ------------------------------------------ capability + wallet-side signing
  console.log("\n• client-side signing path (MetaMask-compatible)");
  const capBefore = await call("/chain/capability", { token: issuer.token });
  assert(
    capBefore.data.mode === (capBefore.data.walletIsIssuer ? "client" : "server"),
    "capability mode is consistent with the on-chain whitelist"
  );
  const white = await call("/chain/issuers", {
    method: "POST",
    token: admin.token,
    body: { address: ISSUER.wallet, enabled: true },
  });
  assert(white.status === 200 && white.data.ok, "admin whitelists the issuer wallet on-chain");
  const capAfter = await call("/chain/capability", { token: issuer.token });
  assert(capAfter.data.mode === "client", "capability flips to client mode after whitelist");

  const clientIssue = await call("/records", {
    method: "POST",
    token: issuer.token,
    body: { studentId: ada.id, term: "Spring-2026", mode: "client" },
  });
  assert(
    clientIssue.status === 201 && clientIssue.data.record.status === "DRAFT" &&
      Boolean(clientIssue.data.txRequest?.data),
    `client-mode record ${clientIssue.data.record?.credId} staged as DRAFT with unsigned tx`,
    clientIssue.data
  );
  const clientCredId = clientIssue.data.record.credId;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const issuerWallet = new ethers.Wallet(ISSUER.key, provider);
  const sent = await issuerWallet.sendTransaction({
    to: clientIssue.data.txRequest.to,
    data: clientIssue.data.txRequest.data,
  });
  const mined = await sent.wait();
  assert(mined.status === 1, `wallet-signed issuance mined (tx ${sent.hash.slice(0, 12)}…)`);

  const credentialSignature = await issuerWallet.signMessage(
    clientIssue.data.credentialMessage
  );
  const confirm = await call(`/records/${clientCredId}/confirm`, {
    method: "POST",
    token: issuer.token,
    body: { txHash: sent.hash, credentialSignature, credentialSigner: ISSUER.wallet },
  });
  assert(
    confirm.status === 200 && confirm.data.record.status === "ACTIVE",
    "client-signed transaction confirmed, record ACTIVE"
  );
  const clientPub = await call(`/verify/${clientCredId}`);
  assert(
    clientPub.data.verification.consistent === true &&
      clientPub.data.verification.signature.matchesChainIssuer === true,
    "client-signed record verifies against chain + signature"
  );

  // -------------------------------------------------------- revocation
  console.log("\n• lifecycle: revoke (server-signed)");
  const revoke = await call(`/records/${credId}/status`, {
    method: "POST",
    token: issuer.token,
    body: { status: "REVOKED", reason: "smoke test" },
  });
  assert(
    revoke.status === 200 && revoke.data.chain?.anchored,
    "revocation mined on-chain",
    revoke.data
  );
  const afterRevoke = await call(`/verify/${credId}`);
  assert(afterRevoke.data.chain.status === "Revoked", "chain now reports Revoked");
  assert(afterRevoke.data.verification.consistent, "MySQL + chain stay consistent after revoke");

  // ----------------------------------- revocation signed by the wallet itself
  const iface = new ethers.Interface(CONTRACT_ABI);
  const revokeData = iface.encodeFunctionData("updateRecordStatus", [
    recordIdOf(clientCredId),
    1,
    ethers.ZeroHash,
  ]);
  const revokeTx = await issuerWallet.sendTransaction({
    to: capAfter.data.contractAddress,
    data: revokeData,
  });
  await revokeTx.wait();
  const clientRevoke = await call(`/records/${clientCredId}/status`, {
    method: "POST",
    token: issuer.token,
    body: { status: "REVOKED", txHash: revokeTx.hash },
  });
  assert(
    clientRevoke.status === 200 && clientRevoke.data.chain?.mode === "client",
    "wallet-signed revocation accepted"
  );

  // -------------------------------------------------------- supersession
  console.log("\n• lifecycle: supersede (transcript correction)");
  const correction = await call("/records", {
    method: "POST",
    token: issuer.token,
    body: { studentId: ada.id, term: "Fall-2026", replaces: pdfCredId },
  });
  assert(
    correction.status === 201 && correction.data.chain?.anchored,
    `corrected record ${correction.data.record?.credId} published`
  );
  const oldView = await call(`/verify/${pdfCredId}`);
  const newView = await call(`/verify/${correction.data.record.credId}`);
  assert(oldView.data.chain.status === "Superseded", "old record marked Superseded");
  assert(
    oldView.data.chain.replacementId === newView.data.chain.recordId,
    "old record points at its replacement"
  );
  assert(newView.data.chain.status === "Active", "corrected record is Active");

  // -------------------------------------------------------- student scope
  console.log("\n• student data scoping");
  const studentView = await call("/records", { token: stranger.token });
  assert(
    Array.isArray(studentView.data) && studentView.data.every((r) => r.studentId === stranger.user.id),
    "students only see their own records"
  );

  console.log(`\nAPI SMOKE TEST PASSED — ${passed} assertions`);
}

main().catch((err) => {
  console.error("\nAPI SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
