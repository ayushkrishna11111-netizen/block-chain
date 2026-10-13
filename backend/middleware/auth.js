const { ethers } = require("ethers");
const { pool } = require("../db");

/**
 * Stateless wallet-session tokens.
 *
 * token = base64url(JSON { wallet, exp }) + "." + hex(ethers.signMessage(message))
 * message = "Academic Record System login\nwallet: <wallet>\nexp: <iso>"
 *
 * No server secret is required: the signature itself proves wallet ownership.
 */
function buildLoginMessage(wallet, expEpochSeconds) {
  return `Academic Record System login\nwallet: ${wallet}\nexp: ${new Date(
    expEpochSeconds * 1000
  ).toISOString()}`;
}

function b64urlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function issueToken(wallet, ttlSeconds = 60 * 60 * 12) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64urlEncode(JSON.stringify({ wallet, exp }));
  const message = buildLoginMessage(wallet, exp);
  // Signature is supplied by the client; issueToken is only used when we
  // already verified a signature. Kept for symmetry / future server sessions.
  return { payload, message, exp };
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, signature] = token.split(".");
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  const { wallet, exp } = payload || {};
  if (!wallet || !exp || exp * 1000 < Date.now()) return null;

  const message = buildLoginMessage(wallet, exp);
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) return null;
  } catch {
    return null;
  }
  // Preserve the wallet's original case: it must reproduce the signed message.
  return { wallet, exp };
}

async function loadUser(wallet) {
  const [rows] = await pool.execute(
    "SELECT id, wallet_address, full_name, email, role, department, created_at FROM users WHERE wallet_address = ?",
    [wallet]
  );
  return rows[0] || null;
}

function bearerFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function requireAuth(req, res, next) {
  const session = verifyToken(bearerFrom(req));
  if (!session) {
    return res.status(401).json({ error: "Missing or expired wallet session" });
  }
  const user = await loadUser(session.wallet.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Wallet is not registered" });
  }
  req.user = user;
  req.session = session;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Forbidden: requires role ${roles.join(" or ")}` });
    }
    next();
  };
}

module.exports = {
  buildLoginMessage,
  issueToken,
  verifyToken,
  requireAuth,
  requireRole,
  loadUser,
};
