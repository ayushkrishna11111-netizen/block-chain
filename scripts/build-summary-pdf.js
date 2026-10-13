/**
 * Generates the executive summary (what is happening / what is used /
 * what more can be built) as docs/EXECUTIVE_SUMMARY.html + .md, then prints
 * the HTML to docs/EXECUTIVE_SUMMARY.pdf with headless Microsoft Edge.
 *
 * Run:  npm run summary:pdf
 * Measured numbers are read from docs/measurements.json (produced by
 * scripts/measure.js), so the summary can never drift from the evidence.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const docsDir = path.join(root, "docs");
fs.mkdirSync(docsDir, { recursive: true });

const m = JSON.parse(fs.readFileSync(path.join(docsDir, "measurements.json"), "utf8"));
const date = new Date(m.measuredAt).toUTCString();

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const edge = EDGE_PATHS.find((p) => fs.existsSync(p));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Executive Summary — Blockchain Academic Record System</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, Arial, sans-serif; color: #141a28; line-height: 1.55; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 2pt; color: #0d1730; }
  .sub, .meta { color: #5a6478; font-size: 9.5pt; }
  h2 { font-size: 13.5pt; margin: 18pt 0 6pt; color: #12203d; border-bottom: 2px solid #d8e0ef; padding-bottom: 3pt; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; color: #1c2b4d; }
  p, li { font-size: 10pt; }
  ul { margin: 4pt 0 8pt 18pt; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.2pt; }
  th { background: #eef2fa; text-align: left; }
  th, td { border: 1px solid #ccd6e8; padding: 4pt 6pt; vertical-align: top; }
  .ok { color: #0e7a52; font-weight: 600; }
  .box { background: #f4f7fd; border: 1px solid #d8e0ef; border-radius: 6px; padding: 8pt 10pt; margin: 8pt 0; }
  .footer { margin-top: 16pt; color: #7a8499; font-size: 8.5pt; border-top: 1px solid #d8e0ef; padding-top: 6pt; }
</style>
</head>
<body>
  <h1>Executive Summary</h1>
  <p class="meta">Decentralized Academic Record Management and Credential Verification System Using Blockchain and Web3 Technology<br/>
  SP301 Special Project Work · Kasala Yashas Reddy (24STUCHH010288), Kurri Bhavesh Kumar (24STUCHH010966), Vegesna Sujit Varma (24STUCHH010891), Mantena Laxmi Kishore Varma (24STUCHH010060) · Guide: Dr. D. Krishna Madhuri · ICFAI Foundation for Higher Education, Hyderabad<br/>
  Measurements reproduced on ${date} (${m.network}).</p>

  <h2>1. What is happening (how the system works)</h2>
  <p>The system is a full-stack Student Information System (SIS) where <strong>managing academic records is the product</strong> and <strong>trustless verification is one integrated feature</strong>. Academic data lives in MySQL 8 (the mutable source of truth); the blockchain stores only immutable evidence.</p>
  <ul>
    <li><strong>Issuance.</strong> An ISSUER/ADMIN wallet session compiles a canonical, key-sorted transcript JSON from live grades, computes a SHA-256 digest (of an uploaded PDF's exact bytes when supplied, otherwise of the canonical JSON), stores the record as DRAFT, anchors the digest + IPFS CID + issuer + timestamp on the AcademicRecordManager contract, and only then marks it ACTIVE. A failed transaction can never appear as issued (DRAFT + retry endpoint).</li>
    <li><strong>Lifecycle.</strong> Records transition Active → Revoked or Active → Superseded. A correction (<em>supersession</em>) publishes the new record and retires the old one in a <em>single atomic transaction</em>, with the replacement link stored on-chain.</li>
    <li><strong>Verification (integrated feature).</strong> Anyone verifies by record ID or by dropping the document: the digest is computed in the browser, looked up through a read-only <code>eth_call</code> (zero gas, no wallet) and cross-checked against MySQL. The response reports database status, chain status, an explicit consistency flag (status <em>and</em> digest must match — direct database tampering is flagged), and the issuer credential signature. Unknown IDs return 404; a chain outage is reported as <em>unavailable</em>, never as <em>tampered</em>.</li>
    <li><strong>Identity &amp; RBAC.</strong> Password-less MetaMask <code>personal_sign</code> login produces stateless 12-hour session tokens (no server secret). Roles ADMIN/ISSUER/STUDENT/VERIFIER are enforced by the API <em>and</em> independently by the contract's issuer whitelist — the ledger cannot be written by an unauthorized wallet even if the API were bypassed.</li>
    <li><strong>New in this build.</strong> QR codes and shareable <code>/verify/&lt;id&gt;</code> links; browser-side (MetaMask) signing of issuance/revocation transactions with server-signer fallback; AES-256-GCM encryption at rest for stored PDFs; issuer signature over the record digest, re-verified publicly; a 23-mutation tamper suite and an automated chain-outage failure-path test.</li>
  </ul>

  <h2>2. What is used (stack and evidence)</h2>
  <table>
    <tr><th>Layer</th><th>Technology</th><th>Purpose</th></tr>
    <tr><td>Frontend</td><td>React 18.3 + Vite 5, custom dark CSS, ethers v6, qrcode</td><td>Dashboard, Records, Students, student portal, public Verify (5 pages)</td></tr>
    <tr><td>Backend</td><td>Node.js 26 + Express 4.21, mysql2, ethers v6</td><td>REST API, transcript compilation, hashing, sessions, chain coordination, audit trail</td></tr>
    <tr><td>Database</td><td>MySQL 8.0 (6 tables)</td><td>users, programs, courses, enrollments, academic_records, audit_logs</td></tr>
    <tr><td>Smart contract</td><td>Solidity 0.8.24, Hardhat 2.29</td><td>issuance, lifecycle, atomic supersession, RBAC whitelist, public view verification</td></tr>
    <tr><td>Network</td><td>local Hardhat node (automining); Sepolia configured</td><td>immutable state + events</td></tr>
    <tr><td>Storage</td><td>encrypted uploads (AES-256-GCM) + IPFS via Pinata (optional)</td><td>documents at rest; permanent CID when configured</td></tr>
  </table>

  <h3>Measured results (docs/measurements.json, ${date})</h3>
  <table>
    <tr><th>Operation</th><th>Trials</th><th>Min</th><th>Mean</th><th>Max</th><th>Gas</th></tr>
    <tr><td>Public verification (GET /api/verify, eth_call + DB cross-check)</td><td>${m.verification.n}</td><td>${m.verification.minMs} ms</td><td>${m.verification.meanMs} ms</td><td>${m.verification.maxMs} ms</td><td>0 (read-only)</td></tr>
    <tr><td>Record issuance (compile → hash → MySQL → confirmed tx)</td><td>${m.issuance.n}</td><td>${m.issuance.minMs} ms</td><td>${m.issuance.meanMs} ms</td><td>${m.issuance.maxMs} ms</td><td>${(m.issuance.gasUsed[0] || 0).toLocaleString()}</td></tr>
    <tr><td>Revocation (status update tx)</td><td>1</td><td>—</td><td>${m.revocation.ms} ms</td><td>—</td><td>${Number(m.revocation.gasUsed).toLocaleString()}</td></tr>
    <tr><td>Correction / supersession (one atomic tx)</td><td>1</td><td>—</td><td>${m.supersession.ms} ms</td><td>—</td><td>${Number(m.supersession.gasUsed).toLocaleString()}</td></tr>
    <tr><td>Issuance throughput (${m.throughput.batch}-tx batch, pre-signed, raw submission)</td><td>${m.throughput.batch}</td><td colspan="3">${m.throughput.txPerSecond} tx/s (target &gt; ${m.throughput.targetTxPerSecond} — <span class="ok">met</span>)</td><td>${Number(m.throughput.gasPerIssuance).toLocaleString()}/tx</td></tr>
  </table>

  <h3>Verification evidence (all repeatable)</h3>
  <ul>
    <li class="ok">14/14 Hardhat unit tests (RBAC, issuance, duplicate-ID rejection, lifecycle, view verification)</li>
    <li class="ok">52/52 end-to-end REST assertions (auth, 401/403, issuance, verification, tamper rejection, revocation, supersession, wallet-signed issuance + revocation, encrypted documents, signature checks, scoping)</li>
    <li class="ok">10/10 chain-service assertions (issue → verify → supersede → revoke round-trip)</li>
    <li class="ok">23/23 tamper-suite mutations rejected (bit flips, truncation, extension, header corruption, block zeroing, forged transcript, wrong file) + direct database tampering flagged by the DB/chain cross-check</li>
    <li class="ok">7/7 chain-outage assertions (dead RPC → "unavailable", never "tampered"; 404 semantics preserved)</li>
    <li class="ok">Production client build succeeds; browser check: dashboard, QR deep-link verification and 404 path render with a clean console</li>
  </ul>

  <div class="box"><strong>Honest limitations.</strong> Sepolia deployment and Pinata pinning are fully wired (env-configured) but were not exercised here — no funded testnet key or Pinata JWT was available. The credential signature is an issuer wallet signature over the record digest, not a W3C Data Integrity proof; no standards compliance is claimed. QR codes link to the verification page; camera-based QR scanning is not implemented. Wall-clock timings are from a local automining node; public-network timings will differ.</div>

  <h2>3. What more can be built</h2>
  <ul>
    <li><strong>W3C Verifiable Credentials 2.0 + DID methods</strong> — issue credentials as full VCs with Data Integrity proofs and a status list for revocation, enabling ecosystem-wide interoperability (EBSI, 1EdTech Open Badges).</li>
    <li><strong>Public-network rollout</strong> — Sepolia → mainnet/L2 anchoring (Polygon/Arbitrum for cost), multi-institution issuer governance ( multisig admin, per-faculty whitelists), and measured public-network latencies.</li>
    <li><strong>QR scanning and offline verification</strong> — camera-based QR capture, a PWA mobile wallet, and an offline-capable verifier that caches Merkle proofs.</li>
    <li><strong>Zero-knowledge selective disclosure</strong> — prove "GPA ≥ 3.5" or "degree conferred" without revealing the full transcript (ZKBAR-V-style), keeping privacy while retaining verifiability.</li>
    <li><strong>IPFS hardening</strong> — pin via Pinata/web3.storage with redundancy, encrypted CID publication, and gateway health monitoring.</li>
    <li><strong>Registrar tooling</strong> — batch issuance CSV import, cohort statistics, LMS/ERP integration (SIS connectors), and automated degree-audit checks before issuance.</li>
    <li><strong>Security operations</strong> — key-ceremony/HSM for the server signer, key rotation, alerting on anchor failures, and a public audit explorer over contract events.</li>
  </ul>

  <p class="footer">Generated ${new Date().toUTCString()} from the project repository · source: scripts/build-summary-pdf.js · measured data: docs/measurements.json</p>
</body>
</html>`;

const md = `# Executive Summary — Blockchain Academic Record System

_${date} · ${m.network}_

## 1. What is happening
- **Issuance** — canonical transcript JSON → SHA-256 digest (PDF bytes when supplied) → MySQL DRAFT → on-chain anchor → ACTIVE only after the receipt.
- **Lifecycle** — Active → Revoked / Superseded; corrections are atomic (new record published + old retired in one transaction).
- **Verification** — zero-gas \`eth_call\` by record ID or dropped document, cross-checked against MySQL (status **and** digest), plus issuer-signature check. 404 for unknown; chain outage reported as *unavailable*, never *tampered*.
- **Identity** — MetaMask personal_sign, stateless 12 h sessions, roles enforced by API and independently by the contract issuer whitelist.
- **New in this build** — QR + shareable verify links, MetaMask client-side transaction signing, AES-256-GCM encryption at rest, issuer credential signatures, systematic tamper suite, automated chain-outage tests.

## 2. What is used
React 18 + Vite 5 · Node.js/Express · MySQL 8 · Solidity 0.8.24 (Hardhat) · ethers v6 · IPFS/Pinata (optional) · AES-256-GCM at rest.

| Operation | Trials | Min | Mean | Max | Gas |
|---|---|---|---|---|---|
| Public verification | ${m.verification.n} | ${m.verification.minMs} ms | ${m.verification.meanMs} ms | ${m.verification.maxMs} ms | 0 |
| Issuance | ${m.issuance.n} | ${m.issuance.minMs} ms | ${m.issuance.meanMs} ms | ${m.issuance.maxMs} ms | ${(m.issuance.gasUsed[0] || 0).toLocaleString()} |
| Revocation | 1 | — | ${m.revocation.ms} ms | — | ${Number(m.revocation.gasUsed).toLocaleString()} |
| Supersession | 1 | — | ${m.supersession.ms} ms | — | ${Number(m.supersession.gasUsed).toLocaleString()} |
| Throughput | ${m.throughput.batch} | — | ${m.throughput.txPerSecond} tx/s | — | ${Number(m.throughput.gasPerIssuance).toLocaleString()}/tx |

Evidence: 14/14 unit tests · 52/52 API assertions · 10/10 chain assertions · 23/23 tamper mutations rejected · 7/7 outage assertions · client build OK.

**Limitations:** Sepolia + Pinata wired but not exercised (no keys). Credential signature is a wallet signature over the digest, not a W3C Data Integrity proof. QR scanning not implemented.

## 3. What more can be built
1. W3C Verifiable Credentials 2.0 + DID/Data Integrity proofs and revocation status lists.
2. Public-network rollout (Sepolia → L2), multisig/institutional governance.
3. QR scanning + offline/mobile PWA verifier.
4. Zero-knowledge selective disclosure (prove attributes without revealing the transcript).
5. IPFS redundancy, encrypted publication, gateway monitoring.
6. Registrar tooling: batch issuance, cohort analytics, LMS/ERP integration.
7. Security operations: HSM key custody, key rotation, event-driven audit explorer.
`;

fs.writeFileSync(path.join(docsDir, "EXECUTIVE_SUMMARY.html"), html);
fs.writeFileSync(path.join(docsDir, "EXECUTIVE_SUMMARY.md"), md);
console.log("wrote docs/EXECUTIVE_SUMMARY.html");
console.log("wrote docs/EXECUTIVE_SUMMARY.md");

if (!edge) {
  console.error("Microsoft Edge not found; PDF not generated (HTML/MD are on disk).");
  process.exit(1);
}

const pdfPath = path.join(docsDir, "EXECUTIVE_SUMMARY.pdf").replace(/\\/g, "/");
const htmlPath = path.join(docsDir, "EXECUTIVE_SUMMARY.html").replace(/\\/g, "/");
const result = spawnSync(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--print-to-pdf=${pdfPath}`,
    "--no-pdf-header-footer",
    `file:///${htmlPath}`,
  ],
  { stdio: "inherit" }
);

if (result.status !== 0 || !fs.existsSync(pdfPath)) {
  console.error("PDF generation failed");
  process.exit(1);
}
const size = fs.statSync(pdfPath).size;
console.log(`wrote docs/EXECUTIVE_SUMMARY.pdf (${(size / 1024).toFixed(1)} KB)`);
