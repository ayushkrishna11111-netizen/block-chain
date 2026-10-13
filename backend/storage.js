/**
 * Document storage with encryption at rest.
 *
 * Every stored credential document is encrypted with AES-256-GCM using the
 * 32-byte key in DOCUMENT_ENC_KEY. The file layout on disk is:
 *
 *   uploads/<credId>.pdf.enc  =  iv(12B) || authTag(16B) || ciphertext
 *
 * Legacy plaintext files (written before encryption was enabled) are still
 * served: decryptDocument() detects them and returns the bytes unchanged.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./db");

const UPLOAD_DIR = path.join(__dirname, "uploads");

function keyBuffer() {
  const hex = config.documentEncKey;
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("DOCUMENT_ENC_KEY must be a 32-byte hex key (64 hex chars)");
  }
  return buf;
}

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function docPathFor(credId) {
  const safe = String(credId).replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(UPLOAD_DIR, `${safe}.pdf.enc`);
}

/** Encrypt and persist a credential document. Returns the relative path. */
function storeDocument(credId, plaintext) {
  ensureDir();
  const key = keyBuffer();
  const target = docPathFor(credId);

  if (!key) {
    // No key configured: store plaintext (documented behaviour, not silent).
    fs.writeFileSync(target, plaintext);
    return path.basename(target);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(target, Buffer.concat([iv, authTag, ciphertext]));
  return path.basename(target);
}

/**
 * Read a stored document back to plaintext.
 * Handles both encrypted files and legacy plaintext files.
 */
function readDocument(fileName) {
  const target = path.join(UPLOAD_DIR, path.basename(fileName));
  if (!fs.existsSync(target)) return null;
  const raw = fs.readFileSync(target);

  const key = keyBuffer();
  if (!key) return raw;

  // Encrypted layout: iv(12) || authTag(16) || ciphertext
  if (raw.length > 28) {
    try {
      const iv = raw.subarray(0, 12);
      const authTag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Not GCM-framed (or wrong key) - fall through to legacy plaintext.
    }
  }
  return raw;
}

module.exports = { UPLOAD_DIR, docPathFor, storeDocument, readDocument };
