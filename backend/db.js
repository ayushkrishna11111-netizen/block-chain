const path = require("path");
const fs = require("fs");
const rootEnv = path.resolve(__dirname, "../.env");
const localEnv = path.join(__dirname, ".env");
const dotenvResult = fs.existsSync(rootEnv)
  ? require("dotenv").config({ path: rootEnv })
  : require("dotenv").config({ path: localEnv });
const fileEnv = dotenvResult.parsed || {};

const mysql = require("mysql2/promise");

function resolvePort() {
  // An explicit process env (tests, outage harness) wins over the .env file;
  // ignore junk values such as PORT=0 exported by some shells/CI runners.
  for (const candidate of [process.env.PORT, fileEnv.PORT]) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 5000;
}

const config = {
  port: resolvePort(),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  registrationCode: process.env.REGISTRATION_CODE || "",
  documentEncKey: process.env.DOCUMENT_ENC_KEY || "",
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "academic_db",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  },
  chain: {
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    privateKey: process.env.SIGNER_PRIVATE_KEY || "",
    contractAddress: process.env.CONTRACT_ADDRESS || "",
  },
  pinata: {
    jwt: process.env.PINATA_JWT || "",
    gateway: process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs",
  },
};

const pool = mysql.createPool(config.db);

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function pingDb() {
  await pool.query("SELECT 1");
  return true;
}

module.exports = { config, pool, withTransaction, pingDb };
