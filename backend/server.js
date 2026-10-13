const express = require("express");
const cors = require("cors");
const { config, pingDb } = require("./db");
const { getProvider, getReadContract } = require("./chain");
const { recentAudit } = require("./audit");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const academicRoutes = require("./routes/academics");
const recordRoutes = require("./routes/records");
const verifyRoutes = require("./routes/verify");
const ipfsRoutes = require("./routes/ipfs");
const chainRoutes = require("./routes/chain");

const app = express();

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: "25mb" })); // PDFs arrive base64-encoded

app.get("/api/health", async (_req, res) => {
  const health = { api: "ok", database: false, chain: false, contract: null };
  try {
    await pingDb();
    health.database = true;
  } catch (err) {
    health.databaseError = err.message;
  }
  try {
    const block = await getProvider().getBlockNumber();
    health.chain = true;
    health.blockNumber = block;
  } catch (err) {
    health.chainError = err.shortMessage || err.message;
  }
  if (health.chain && config.chain.contractAddress) {
    try {
      const { id } = require("ethers");
      await getReadContract().recordExists(id("PING"));
      health.contract = { address: config.chain.contractAddress, reachable: true };
    } catch (err) {
      health.contract = {
        address: config.chain.contractAddress,
        reachable: false,
        error: err.shortMessage || err.message,
      };
    }
  }
  res.json(health);
});

app.get("/api/activity", async (_req, res, next) => {
  try {
    res.json({ activity: await recentAudit(20) });
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/academics", academicRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/ipfs", ipfsRoutes);
app.use("/api/chain", chainRoutes);

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  console.error("[api]", err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Academic Record API listening on http://localhost:${config.port}`);
  console.log(`  MySQL   : ${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`  RPC     : ${config.chain.rpcUrl}`);
  console.log(`  Contract: ${config.chain.contractAddress || "(not set)"}`);
});
