/**
 * Chain-outage failure-path test.
 *
 * Spawns a second API instance whose RPC endpoint is dead and asserts the
 * system reports *unavailability* — never "tampered" — while the database
 * keeps answering:
 *
 *   1. /api/health              -> database true, chain false + chainError
 *   2. /api/verify/:knownId     -> 200, chainAvailable false, DB status intact
 *   3. /api/verify/:unknownId   -> 404 (not "invalid")
 *
 * Run:  node scripts/chain-outage.js
 */
const { spawn } = require("child_process");
const path = require("path");
const { pool } = require("../backend/db");

const DEAD_RPC = "http://127.0.0.1:9"; // port 9: guaranteed refused locally
const TEST_PORT = "5099";

let passed = 0;
function assert(cond, label, extra) {
  if (!cond) {
    console.error(`  ✘ ${label}${extra ? ` — ${JSON.stringify(extra)}` : ""}`);
    throw new Error(`ASSERTION FAILED: ${label}`);
  }
  passed += 1;
  console.log(`  ✔ ${label}`);
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // A real, known record id and an unknown one.
  const [[known]] = await pool.execute(
    "SELECT cred_id FROM academic_records ORDER BY id DESC LIMIT 1"
  );
  if (!known) throw new Error("No records in the database — run smoke-api.js first");
  const knownId = known.cred_id;

  const child = spawn(process.execPath, [path.join(__dirname, "..", "backend", "server.js")], {
    env: { ...process.env, PORT: TEST_PORT, RPC_URL: DEAD_RPC },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));

  try {
    // Wait for readiness (bounded).
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      try {
        const probe = await getJson(`http://localhost:${TEST_PORT}/api/health`);
        ready = probe.status === 200;
      } catch {
        await sleep(250);
      }
    }
    if (!ready) throw new Error(`outage API never became ready:\n${childLog}`);
    console.log(`outage API ready on :${TEST_PORT} with dead RPC ${DEAD_RPC}\n`);

    // 1. health separates database from chain
    const health = await getJson(`http://localhost:${TEST_PORT}/api/health`);
    assert(health.data.api === "ok", "API itself is alive");
    assert(health.data.database === true, "database still reachable");
    assert(
      health.data.chain === false && Boolean(health.data.chainError),
      "chain reported down with an explicit error (not silently true)"
    );

    // 2. known record: served from the DB, chain explicitly unavailable
    const knownRes = await getJson(`http://localhost:${TEST_PORT}/api/verify/${knownId}`);
    assert(knownRes.status === 200 && knownRes.data.found, "known record still verifiable from DB");
    assert(
      knownRes.data.verification.chainAvailable === false &&
        Boolean(knownRes.data.chainError),
      "chain marked unavailable — outage is not reported as tampering"
    );
    assert(
      knownRes.data.verification.consistent === false &&
        knownRes.data.verification.database !== null,
      "DB status still returned while consistency is withheld"
    );

    // 3. unknown record stays a plain 404 even with the chain down
    const unknownRes = await getJson(`http://localhost:${TEST_PORT}/api/verify/CRED-0000-000`);
    assert(
      unknownRes.status === 404 && unknownRes.data.found === false,
      "unknown record still returns 404 during chain outage"
    );

    console.log(`\nCHAIN OUTAGE TEST PASSED — ${passed} assertions`);
  } finally {
    child.kill();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nCHAIN OUTAGE TEST FAILED:", err.message);
  process.exit(1);
});
