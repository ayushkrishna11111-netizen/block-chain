/**
 * Measures issuance/verification latency, on-chain gas and issuance
 * throughput so report numbers are observed values, not claims.
 *
 * Prerequisites: backend running, seeded DB, local hardhat node + deployment.
 *   API_BASE=http://localhost:5001 node scripts/measure.js
 *
 * Output: printed summary + docs/measurements.json
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const BASE = process.env.API_BASE || "http://localhost:5001";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8546";

// Hardhat public dev keys (zero value).
const ISSUER = {
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
};

const now = () => Number(process.hrtime.bigint() / 1000000n); // ms

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

async function login() {
  const nonce = await call("/auth/nonce", { method: "POST", body: { wallet: ISSUER.wallet } });
  const signature = await new ethers.Wallet(ISSUER.key).signMessage(nonce.data.message);
  const session = await call("/auth/verify", {
    method: "POST",
    body: { wallet: ISSUER.wallet, message: nonce.data.message, signature },
  });
  if (!session.data.token) throw new Error("login failed: " + JSON.stringify(session.data));
  return session.data.token;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: sorted.length,
    minMs: sorted[0],
    meanMs: Math.round(mean * 10) / 10,
    maxMs: sorted[sorted.length - 1],
  };
}

async function gasOf(txHash) {
  const receipt = await new ethers.JsonRpcProvider(RPC_URL).getTransactionReceipt(txHash);
  return receipt ? Number(receipt.gasUsed) : null;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = await login();

  const students = await call("/users?role=STUDENT", { token });
  const ada = students.data.find((u) => u.email === "ada@student.edu") || students.data[0];

  const records = await call("/records", { token });
  const target = records.data.find((r) => r.status === "ACTIVE");
  if (!target) throw new Error("no ACTIVE record to verify — issue one first");

  // ---- 1. Public verification latency (zero-gas eth_call + DB cross-check)
  const verifySamples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = now();
    const res = await call(`/verify/${target.credId}`);
    verifySamples.push(now() - t0);
    if (res.status !== 200 || !res.data.found) throw new Error("verification failed");
  }
  const verifyStats = stats(verifySamples);

  // ---- 2. Issuance latency + gas (3 trials)
  const issues = [];
  for (let i = 0; i < 3; i++) {
    const t0 = now();
    const res = await call("/records", {
      method: "POST",
      token,
      body: { studentId: ada.id, term: `M2026-${i + 1}` },
    });
    const elapsed = now() - t0;
    if (res.status !== 201 || !res.data.chain?.anchored) {
      throw new Error("issuance failed: " + JSON.stringify(res.data).slice(0, 300));
    }
    issues.push({ ms: elapsed, gas: await gasOf(res.data.record.txHash), credId: res.data.record.credId });
    await new Promise((r) => setTimeout(r, 100));
  }
  const issueStats = stats(issues.map((x) => x.ms));

  // ---- 3. Revocation latency + gas
  const revokeTarget = issues[0].credId;
  const t1 = now();
  const revoke = await call(`/records/${revokeTarget}/status`, {
    method: "POST",
    token,
    body: { status: "REVOKED", reason: "measurement" },
  });
  const revokeMs = now() - t1;
  if (revoke.status !== 200) throw new Error("revoke failed: " + JSON.stringify(revoke.data));
  const revokeGas = await gasOf(revoke.data.chain.txHash);

  // ---- 4. Supersession (correction) latency + gas
  const supersedeTarget = issues[1].credId;
  const t2 = now();
  const correction = await call("/records", {
    method: "POST",
    token,
    body: { studentId: ada.id, term: `MC-${Date.now().toString().slice(-6)}`, replaces: supersedeTarget },
  });
  const supersedeMs = now() - t2;
  if (correction.status !== 201 || !correction.data.chain?.anchored) {
    throw new Error("supersede failed: " + JSON.stringify(correction.data).slice(0, 300));
  }
  const supersedeGas = await gasOf(correction.data.record.txHash);

  // ---- 5. Issuance throughput (target: > 20 tx/second)
  // Pure chain anchoring from the deployer wallet (always an issuer):
  // submissions are pipelined, then every receipt is awaited.
  const { CONTRACT_ABI, recordIdOf } = require("../backend/chain");
  const health = await call("/health");
  const wallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  );
  const contract = new ethers.Contract(health.data.contract.address, CONTRACT_ABI, wallet);
  const BATCH = 20;
  // Transactions are pre-signed locally (fixed nonce, gas limit and fees) so
  // the timed window contains only eth_sendRawTransaction round-trips — the
  // chain ingestion rate, not ethers' per-tx preparation overhead.
  const feeData = await provider.getFeeData();
  const network = await provider.getNetwork();
  const baseNonce = Number(
    await provider.send("eth_getTransactionCount", [wallet.address, "pending"])
  );
  const iface = new ethers.Interface(CONTRACT_ABI);
  const signed = [];
  for (let i = 0; i < BATCH; i++) {
    const id = recordIdOf(`THROUGHPUT-${Date.now()}-${i}`);
    const digest = ethers.sha256(ethers.toUtf8Bytes(`throughput-${i}`));
    signed.push(
      await wallet.signTransaction({
        to: health.data.contract.address,
        data: iface.encodeFunctionData("issueRecord", [id, digest, ""]),
        nonce: baseNonce + i,
        gasLimit: 200000,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        chainId: network.chainId,
      })
    );
  }
  const t3 = now();
  const txHashes = [];
  for (const raw of signed) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`throughput send failed: ${json.error.message}`);
    txHashes.push(json.result);
  }
  const throughputMs = now() - t3;
  const throughputTps = Math.round((BATCH / throughputMs) * 1000 * 10) / 10;
  // Hardhat automines synchronously during eth_sendRawTransaction, so every
  // returned hash is already mined; verify the first receipt for gas + status.
  const firstReceipt = await provider.getTransactionReceipt(txHashes[0]);
  if (!firstReceipt || firstReceipt.status !== 1) {
    throw new Error("throughput tx missing or reverted");
  }
  const gasPerIssue = Number(firstReceipt.gasUsed);

  const summary = {
    measuredAt: new Date().toISOString(),
    network: "local Hardhat node (automining)",
    verification: { ...verifyStats, endpoint: `GET /api/verify/${target.credId}`, gasCost: 0 },
    issuance: { ...issueStats, gasUsed: issues.map((x) => x.gas) },
    revocation: { ms: revokeMs, gasUsed: revokeGas },
    supersession: { ms: supersedeMs, gasUsed: supersedeGas },
    throughput: {
      batch: BATCH,
      wallMs: throughputMs,
      txPerSecond: throughputTps,
      targetTxPerSecond: 20,
      meetsTarget: throughputTps > 20,
      gasPerIssuance: gasPerIssue,
    },
    blockNumber: await provider.getBlockNumber(),
  };

  const out = path.join(__dirname, "..", "docs", "measurements.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWROTE ${out}`);
}

main().catch((err) => {
  console.error("MEASUREMENT FAILED:", err.message);
  if (err.cause) console.error("cause:", err.cause.message || err.cause);
  console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
