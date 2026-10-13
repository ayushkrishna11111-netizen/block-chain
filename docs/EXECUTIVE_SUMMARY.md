# Executive Summary — Blockchain Academic Record System

_Tue, 13 Oct 2026 05:58:11 GMT · local Hardhat node (automining)_

## 1. What is happening
- **Issuance** — canonical transcript JSON → SHA-256 digest (PDF bytes when supplied) → MySQL DRAFT → on-chain anchor → ACTIVE only after the receipt.
- **Lifecycle** — Active → Revoked / Superseded; corrections are atomic (new record published + old retired in one transaction).
- **Verification** — zero-gas `eth_call` by record ID or dropped document, cross-checked against MySQL (status **and** digest), plus issuer-signature check. 404 for unknown; chain outage reported as *unavailable*, never *tampered*.
- **Identity** — MetaMask personal_sign, stateless 12 h sessions, roles enforced by API and independently by the contract issuer whitelist.
- **New in this build** — QR + shareable verify links, MetaMask client-side transaction signing, AES-256-GCM encryption at rest, issuer credential signatures, systematic tamper suite, automated chain-outage tests.

## 2. What is used
React 18 + Vite 5 · Node.js/Express · MySQL 8 · Solidity 0.8.24 (Hardhat) · ethers v6 · IPFS/Pinata (optional) · AES-256-GCM at rest.

| Operation | Trials | Min | Mean | Max | Gas |
|---|---|---|---|---|---|
| Public verification | 10 | 45 ms | 54.7 ms | 69 ms | 0 |
| Issuance | 3 | 211 ms | 304 ms | 384 ms | 1,01,548 |
| Revocation | 1 | — | 331 ms | — | 53,179 |
| Supersession | 1 | — | 174 ms | — | 1,50,684 |
| Throughput | 20 | — | 194.2 tx/s | — | 1,01,560/tx |

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
