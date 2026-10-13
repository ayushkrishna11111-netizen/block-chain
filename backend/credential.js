/**
 * Issuer credential signature.
 *
 * The issuer signs `AcademicRecord:<credId>:<digest>` - a compact message
 * binding the human record id to the anchored SHA-256 digest. The signature
 * and the signer address are stored with the record and re-checked by the
 * public verification endpoint.
 *
 * This is an integrity signature produced by the issuing wallet (MetaMask on
 * the client-signing path, the server signer otherwise). It is NOT a W3C
 * Data Integrity proof and no standards compliance is claimed.
 */
const { ethers } = require("ethers");
const { config } = require("./db");

function credentialMessage(credId, digest) {
  return `AcademicRecord:${credId}:${digest}`;
}

/** Server-side signing with SIGNER_PRIVATE_KEY (the on-chain issuer). */
function signCredentialServer(credId, digest) {
  if (!config.chain.privateKey) return null;
  const wallet = new ethers.Wallet(config.chain.privateKey);
  return {
    signature: wallet.signMessageSync(credentialMessage(credId, digest)),
    signer: wallet.address,
  };
}

/**
 * Re-check a stored credential signature.
 * Returns { present, valid, signer, matchesSigner }.
 */
function verifyCredentialSignature({ credId, digest, signature, signer }) {
  if (!signature || !signer) {
    return { present: false, valid: false, signer: null, matchesSigner: false };
  }
  let recovered = null;
  try {
    recovered = ethers.verifyMessage(credentialMessage(credId, digest), signature);
  } catch {
    recovered = null;
  }
  const matchesSigner =
    recovered && recovered.toLowerCase() === String(signer).toLowerCase();
  return {
    present: true,
    valid: Boolean(matchesSigner),
    signer,
    matchesSigner: Boolean(matchesSigner),
  };
}

module.exports = { credentialMessage, signCredentialServer, verifyCredentialSignature };
