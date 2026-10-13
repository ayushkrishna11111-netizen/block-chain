const express = require("express");
const { ethers } = require("ethers");
const { pool } = require("../db");
const { buildLoginMessage, verifyToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

const isAddress = (w) => typeof w === "string" && ethers.isAddress(w);

/**
 * Step 1 of wallet login: hand the client the exact message to sign.
 * POST /api/auth/nonce { wallet }
 */
router.post("/nonce", (req, res) => {
  const { wallet } = req.body || {};
  if (!isAddress(wallet)) {
    return res.status(400).json({ error: "A valid 0x wallet address is required" });
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  res.json({ wallet: wallet.toLowerCase(), message: buildLoginMessage(wallet, exp), exp });
});

/**
 * Step 2: verify the signature and open a session.
 * If the wallet has never been seen, a STUDENT account is auto-provisioned.
 * POST /api/auth/verify { wallet, message, signature }
 */
router.post("/verify", async (req, res, next) => {
  try {
    const { wallet, message, signature } = req.body || {};
    if (!isAddress(wallet) || !message || !signature) {
      return res.status(400).json({ error: "wallet, message and signature are required" });
    }

    let recovered;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      return res.status(401).json({ error: "Signature could not be verified" });
    }
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ error: "Signature does not match wallet" });
    }

    const messageExp = message.match(/exp: (.+)/);
    const exp = messageExp ? Math.floor(new Date(messageExp[1]).getTime() / 1000) : 0;
    if (!exp || exp * 1000 < Date.now()) {
      return res.status(401).json({ error: "Login challenge expired, retry" });
    }

    const walletLower = wallet.toLowerCase();
    let [rows] = await pool.execute("SELECT * FROM users WHERE wallet_address = ?", [
      walletLower,
    ]);
    let user = rows[0];

    if (!user) {
      const short = `${walletLower.slice(0, 6)}…${walletLower.slice(-4)}`;
      await pool.execute(
        "INSERT INTO users (wallet_address, full_name, email, role) VALUES (?, ?, ?, 'STUDENT')",
        [walletLower, `Wallet ${short}`, `${walletLower.slice(2, 12)}@wallet.local`]
      );
      [rows] = await pool.execute("SELECT * FROM users WHERE wallet_address = ?", [
        walletLower,
      ]);
      user = rows[0];
    }

    const token = `${Buffer.from(JSON.stringify({ wallet, exp })).toString(
      "base64url"
    )}.${signature}`;

    res.json({
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      user: {
        id: user.id,
        wallet: user.wallet_address,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Current session. GET /api/auth/me */
router.get("/me", requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    wallet: u.wallet_address,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    department: u.department,
  });
});

/** Token introspection helper used by the frontend to restore a session. */
router.post("/session", (req, res) => {
  const session = verifyToken((req.body && req.body.token) || "");
  res.json({ valid: Boolean(session), wallet: session ? session.wallet : null });
});

module.exports = router;
