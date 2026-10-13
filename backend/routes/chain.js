const express = require("express");
const { ethers } = require("ethers");
const { config, pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { isIssuerWallet, setIssuerWallet, getProvider, getReadContract } = require("../chain");
const { audit } = require("../audit");

const router = express.Router();

/**
 * GET /api/chain/capability — who signs transactions from this browser?
 * mode 'server'  : the backend signer anchors records (default)
 * mode 'client'  : the connected wallet is whitelisted and can sign itself
 */
router.get("/capability", requireAuth, async (req, res) => {
  const wallet = req.user.wallet_address;
  let onChainIssuer = false;
  try {
    onChainIssuer = await isIssuerWallet(wallet);
  } catch {
    onChainIssuer = false;
  }
  let signerAddress = null;
  try {
    if (config.chain.privateKey) {
      signerAddress = new ethers.Wallet(config.chain.privateKey).address;
    }
  } catch {
    signerAddress = null;
  }
  res.json({
    contractAddress: config.chain.contractAddress || null,
    rpcUrl: config.chain.rpcUrl,
    signerAddress,
    wallet,
    walletIsIssuer: onChainIssuer,
    mode: onChainIssuer ? "client" : "server",
  });
});

/**
 * Whitelist or un-whitelist an issuer wallet on-chain.
 * POST /api/chain/issuers { address, enabled }
 * The caller must be the contract admin (the server signer normally is).
 */
router.post(
  "/issuers",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const { address, enabled } = req.body || {};
      if (!address || !ethers.isAddress(address)) {
        return res.status(400).json({ error: "A valid 0x address is required" });
      }
      const tx = await setIssuerWallet(address, Boolean(enabled));
      await audit(
        enabled ? "ISSUER_WHITELISTED" : "ISSUER_REMOVED",
        req.user.wallet_address,
        String(address).toLowerCase(),
        tx.txHash
      );
      res.json({ ok: true, txHash: tx.txHash });
    } catch (err) {
      res.status(502).json({ error: err.shortMessage || err.message });
    }
  }
);

/** GET /api/chain/issuers — known issuer wallets from the DB + on-chain flag */
router.get("/issuers", requireAuth, async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, wallet_address, full_name, role FROM users WHERE role IN ('ADMIN','ISSUER') ORDER BY id"
    );
    const out = [];
    for (const r of rows) {
      let onChain = false;
      try {
        onChain = await getReadContract().isIssuer(r.wallet_address);
      } catch {
        onChain = false;
      }
      out.push({
        id: r.id,
        wallet: r.wallet_address,
        fullName: r.full_name,
        role: r.role,
        onChain,
      });
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
