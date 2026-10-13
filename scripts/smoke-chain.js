/**
 * Chain-layer smoke test: exercises the backend's blockchain service
 * (backend/chain.js) against a locally deployed AcademicRecordManager.
 *
 * Requires a running node + deployment:
 *   npx hardhat node --port 8546
 *   npx hardhat run scripts/deploy.js --network localhost
 *
 * Run:  node scripts/smoke-chain.js
 */
const { ethers } = require("ethers");
const {
  issueOnChain,
  verifyOnChain,
  updateStatusOnChain,
  supersedeOnChain,
  sha256Hex,
  recordIdOf,
  getWriteContract,
} = require("../backend/chain");

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
  passed += 1;
  console.log(`  ✔ ${label}`);
}

async function main() {
  const hash = sha256Hex(ethers.toUtf8Bytes("canonical-transcript-v1"));
  const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  const credId = `SMOKE-${Date.now()}`;

  console.log(`Record: ${credId}`);

  const issued = await issueOnChain(credId, hash, cid);
  assert(issued.txHash, `issued on-chain (tx ${issued.txHash.slice(0, 12)}…)`);

  let rec = await verifyOnChain(credId);
  assert(rec.found && rec.status === "Active", "verifyRecord returns Active");
  assert(rec.recordHash === hash, "digest round-trips through the contract");
  assert(rec.ipfsCID === cid, "IPFS CID round-trips");

  const signer = await getWriteContract().runner.getAddress();
  assert(rec.issuer.toLowerCase() === signer.toLowerCase(), "issuer is the signing wallet");

  const missing = await verifyOnChain(`${credId}-NOPE`);
  assert(missing.found === false, "unknown record reports found=false");

  const correctedHash = sha256Hex(ethers.toUtf8Bytes("canonical-transcript-v2"));
  const newId = `${credId}-V2`;
  await supersedeOnChain(credId, newId, correctedHash, cid);

  const oldRec = await verifyOnChain(credId);
  const newRec = await verifyOnChain(newId);
  assert(oldRec.status === "Superseded", "old record marked Superseded");
  assert(
    oldRec.replacementId === recordIdOf(newId),
    "replacementId points at the corrected record"
  );
  assert(newRec.status === "Active" && newRec.recordHash === correctedHash, "corrected record Active");

  await updateStatusOnChain(newId, 1, null);
  const revokedRec = await verifyOnChain(newId);
  assert(revokedRec.status === "Revoked", "verifyRecord returns Revoked");

  console.log(`\nCHAIN SMOKE TEST PASSED — ${passed} assertions`);
}

main().catch((err) => {
  console.error("CHAIN SMOKE TEST FAILED:", err.shortMessage || err.message);
  process.exit(1);
});
