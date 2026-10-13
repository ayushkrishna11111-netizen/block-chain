# 🎓 Academic Record Management System (Web3 SIS)

A full-stack Student Information System where **managing academic records is the product**
and **verification is one integrated feature**.

- **Primary module:** issuance, corrections (supersession), revocation, degree/program
  mapping, enrollment & grade posting, transcript lifecycle.
- **Integrated feature:** on-chain anchoring of a SHA-256 digest + IPFS CID, and a
  **zero-gas public verification** page backed by a read-only `eth_call`.
- **This build also includes:** QR codes + shareable `/verify/<id>` links, MetaMask
  client-side transaction signing (server signer as fallback), AES-256-GCM encryption
  at rest for stored PDFs, issuer credential signatures, a systematic tamper suite and
  automated chain-outage failure-path tests.

---

## Architecture

```
+-----------------------------------------------------------------------------------+
|                                 APPLICATION LAYER                                  |
|    React + Vite UI (Dashboard · Records · Students · Student Portal · Verify)      |
+------------------------------------+---------------------------------------------+
                                     |  REST /api (wallet-signature sessions)
                                     v
+------------------------------------+     +-----------------------------------------+
|  MySQL 8 (source of truth)        |     |  EVM CHAIN + IPFS                       |
|  users · programs · courses ·     |     |  AcademicRecordManager.sol              |
|  enrollments · academic_records · |     |   - recordHash (SHA-256)                |
|  audit_logs                        |     |   - ipfsCID · issuer · status           |
|  (mutable academic data)          |     |   - Active / Revoked / Superseded       |
+------------------------------------+     +-----------------------------------------+
        |                                              ^
        |  write path: issue / supersede / revoke      |  read path: verifyRecord()
        v                                              |  (zero gas, no wallet)
        Express backend  ------------------------------+
```

**Design rule:** MySQL stores the *mutable* academic data; the chain stores only the
*immutable evidence* (digest + CID + lifecycle status). Verification is a `view` function,
so external verifiers pay nothing and never connect a wallet.

---

## Project structure

```
.
├── contracts/AcademicRecordManager.sol   # State registry (RBAC issuers, lifecycle)
├── scripts/deploy.js                     # Deploys + prints CONTRACT_ADDRESS
├── scripts/smoke-chain.js                # Chain-layer smoke test (10 assertions)
├── scripts/smoke-api.js                  # End-to-end REST test (52 assertions)
├── scripts/tamper-suite.js               # 23-mutation tamper rejection suite
├── scripts/chain-outage.js               # Dead-RPC failure-path test
├── scripts/measure.js                    # Latency/gas/throughput -> docs/measurements.json
├── scripts/build-summary-pdf.js          # Executive summary -> docs/EXECUTIVE_SUMMARY.pdf
├── test/AcademicRecordManager.test.js    # 14 Hardhat unit tests
├── docs/                                 # measurements.json + executive summary (md/html/pdf)
├── backend/
│   ├── server.js                         # Express app + /api/health
│   ├── schema.sql                        # MySQL schema (creates AND selects the DB)
│   ├── dbInit.js                         # Applies schema + in-place upgrades
│   ├── seed.js                           # Demo program, courses, users, grades
│   ├── db.js · chain.js · grades.js · audit.js · credential.js · storage.js
│   ├── middleware/auth.js                # Wallet-signature sessions (no server secret)
│   ├── uploads/                          # Credential PDFs, AES-256-GCM encrypted
│   └── routes/                           # auth · users · academics · records · verify · ipfs · chain
└── client/
    ├── index.html · vite.config.js       # Dev proxy -> backend port from .env
    └── src/
        ├── App.jsx · main.jsx · auth.jsx · api.js
        ├── components.jsx · styles.css   # Dark glassmorphism design system (+ QR, copy-link)
        ├── utils/hash.js                 # Browser-side SHA-256 (matches server digest)
        └── pages/                        # Dashboard · Records · Students · Verify · MyRecords
```

---

## Prerequisites

- Node.js 18+ (tested on Node 26)
- MySQL 8.0 running on `127.0.0.1:3306`
- MetaMask (only needed for the issuer/student pages — verification is wallet-free)

---

## Run it (5 steps)

### 1. Install

```bash
npm install
```

### 2. Database

```bash
npm run db:init -w backend     # creates + selects academic_db (idempotent)
npm run db:seed -w backend     # demo program, courses, users, grades
```

### 3. Chain

```bash
npx hardhat node --port 8546                          # local development node
npm run deploy:local                                  # prints CONTRACT_ADDRESS
```

Copy the printed `CONTRACT_ADDRESS=` line into the project-root `.env`.

### 4. Configure `.env`

```bash
cp backend/.env.example .env   # then edit:
# PORT=5001            (5000 is often taken on this machine)
# RPC_URL=http://127.0.0.1:8546
# SIGNER_PRIVATE_KEY=<hardhat account #0 — public dev key>
# DOCUMENT_ENC_KEY=<64 hex chars — AES-256-GCM key for stored PDFs>
```

### 5. Run

```bash
npm run dev            # API (:5001) + web client (:5174)
```

Open **http://localhost:5174** — sign in with MetaMask using one of the seeded wallets:

| Role    | Wallet                                        |
|---------|-----------------------------------------------|
| ADMIN   | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`  |
| ISSUER  | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`  |
| STUDENT | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`  |

(public Hardhat dev keys — local development only)

> **Client-side signing:** whitelist the ISSUER wallet on-chain (Students → *Issuer
> wallets* tab, as ADMIN). The Records page then shows "(wallet signs)" and every
> issuance/revocation transaction is signed in MetaMask instead of by the server key.

---

## Verification & measurements (all repeatable)

| Command | Result |
|---|---|
| `npx hardhat test` | **14/14** unit tests |
| `node scripts/smoke-api.js` | **52/52** end-to-end assertions |
| `node scripts/smoke-chain.js` | **10/10** chain-service assertions |
| `node scripts/tamper-suite.js` | **23/23** mutations rejected + DB tamper detected |
| `node scripts/chain-outage.js` | **7/7** outage assertions (unavailable ≠ tampered) |
| `node scripts/measure.js` | latency/gas/throughput → `docs/measurements.json` |
| `npm run build -w client` | production build |
| `npm run summary:pdf` | executive summary → `docs/EXECUTIVE_SUMMARY.pdf` |

Latest measured values (local automining node): verification ≈ 50–75 ms mean at **0 gas**,
issuance ≈ 300 ms (101,560 gas), revocation 53,191 gas, supersession 150,684 gas,
throughput measured well above the 20 tx/s target.

---

## Security notes

- `.env` is gitignored; `.env.example` contains placeholders only.
- Stored PDFs are AES-256-GCM encrypted (`DOCUMENT_ENC_KEY`); legacy plaintext files are
  still served.
- Session tokens are self-verifying signatures (no server secret, 12 h expiry).
- The contract enforces the issuer whitelist independently of the API.

## Honest limitations

- Sepolia deployment and IPFS pinning are **configured but not exercised** here (no
  funded testnet key / Pinata JWT was available).
- The issuer credential signature is a wallet signature over the record digest — not a
  W3C Data Integrity proof; no standards compliance is claimed.
- QR codes link to the public verification page; camera-based QR scanning is not implemented.
