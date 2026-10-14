/**
 * Wallet addresses used by the demo — single source of truth.
 *
 * ROLE_WALLETS are the MetaMask accounts you import and sign in with
 * (kept in sync with the table in README.md).
 *
 * TEST_WALLETS are the public Hardhat dev accounts. They keep their roles
 * in the database because the automated test scripts (smoke-api, measure,
 * tamper-suite) sign login messages with their well-known private keys.
 *
 * Required by backend/seed.js and scripts/deploy.js (local funding).
 */
module.exports = {
  ROLE_WALLETS: {
    ADMIN: "0x057ade225c0f0c46460d3ce41edf98c7d47bf214",
    ISSUER: "0xa16cf79729ae63c63bc7dd36953bac9d5d7401fe",
    STUDENT: "0x47eebe257132d4c25759bc13c938c35d22303e89",
  },
  TEST_WALLETS: {
    // Hardhat account #0 (public dev key — zero value).
    ADMIN: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    // Hardhat account #1.
    ISSUER: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    // Hardhat account #2.
    STUDENT: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  },
};
