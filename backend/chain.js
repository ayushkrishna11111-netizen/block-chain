const { ethers } = require("ethers");
const { config } = require("./db");

/**
 * Minimal ABI for the AcademicRecordManager contract.
 * Kept human-readable so the backend never needs Hardhat artifacts at runtime.
 */
const CONTRACT_ABI = [
  "function verifyRecord(bytes32) view returns (bytes32 recordHash, string ipfsCID, address issuer, uint256 issueTimestamp, uint8 status, bytes32 replacementId)",
  "function recordExists(bytes32) view returns (bool)",
  "function issueRecord(bytes32 _recordId, bytes32 _recordHash, string _ipfsCID)",
  "function updateRecordStatus(bytes32 _recordId, uint8 _newStatus, bytes32 _replacementId)",
  "function supersedeRecord(bytes32 _oldId, bytes32 _newId, bytes32 _newHash, string _newIpfsCID)",
  "function isIssuer(address) view returns (bool)",
  "function admin() view returns (address)",
  "function setIssuer(address _issuer, bool _enabled)",
  "event RecordIssued(bytes32 indexed recordId, bytes32 recordHash, string ipfsCID, address indexed issuer)",
  "event RecordStatusUpdated(bytes32 indexed recordId, uint8 newStatus, bytes32 replacementId)",
];

const STATUS_NAMES = ["Active", "Revoked", "Superseded"];

let _readContract = null;
let _writeContract = null;

function getProvider() {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

function requireContractAddress() {
  if (!config.chain.contractAddress) {
    throw new Error("CONTRACT_ADDRESS is not set in .env");
  }
  return config.chain.contractAddress;
}

function getReadContract() {
  requireContractAddress();
  if (!_readContract) {
    _readContract = new ethers.Contract(
      config.chain.contractAddress,
      CONTRACT_ABI,
      getProvider()
    );
  }
  return _readContract;
}

function getWriteContract() {
  if (_writeContract) return _writeContract;
  if (!config.chain.privateKey) {
    throw new Error("SIGNER_PRIVATE_KEY is not set in .env");
  }
  const wallet = new ethers.Wallet(config.chain.privateKey, getProvider());
  _writeContract = new ethers.Contract(
    requireContractAddress(),
    CONTRACT_ABI,
    wallet
  );
  return _writeContract;
}

// --------------------------------------------------------------- write path
// Transactions from the issuer signer are serialized: concurrent requests
// would otherwise race for the same account nonce. The nonce is fetched with
// a raw (uncached) eth_getTransactionCount because ethers caches RPC
// responses for 250ms, which can hand back a stale nonce and fail with
// "nonce has already been used".
let _writeQueue = Promise.resolve();

function enqueueWrite(task) {
  const run = _writeQueue.then(task, task);
  _writeQueue = run.catch(() => {});
  return run;
}

async function sendContractTx(build) {
  return enqueueWrite(async () => {
    const provider = getProvider();
    const contract = getWriteContract();
    const from = await contract.runner.getAddress();
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const nonceHex = await provider.send("eth_getTransactionCount", [from, "pending"]);
        const receipt = await build(contract, Number(nonceHex));
        return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
      } catch (err) {
        lastError = err;
        const message = String(err.shortMessage || err.message || "");
        if (!/nonce/i.test(message)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError;
  });
}

/** Human record id -> bytes32 record id used by the contract. */
function recordIdOf(credId) {
  return ethers.id(credId);
}

/** SHA-256 over raw bytes, returned as 0x-prefixed 32-byte hex. */
function sha256Hex(bytes) {
  return ethers.sha256(bytes);
}

/**
 * Canonical JSON: object keys are recursively sorted so the digest is
 * reproducible by any client that rebuilds the same document.
 */
function canonicalJSON(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = sort(v[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** Zero-gas eth_call lookup. Returns a normalized verification payload. */
async function verifyOnChain(credId) {
  const contract = getReadContract();
  const id = recordIdOf(credId);
  const exists = await contract.recordExists(id);
  if (!exists) {
    return { found: false, credId, recordId: id };
  }
  const rec = await contract.verifyRecord(id);
  const statusIndex = Number(rec.status);
  return {
    found: true,
    credId,
    recordId: id,
    recordHash: rec.recordHash,
    ipfsCID: rec.ipfsCID,
    issuer: rec.issuer,
    issueTimestamp: Number(rec.issueTimestamp),
    issuedAt: new Date(Number(rec.issueTimestamp) * 1000).toISOString(),
    status: STATUS_NAMES[statusIndex] || String(statusIndex),
    statusIndex,
    replacementId:
      rec.replacementId === ethers.ZeroHash ? null : rec.replacementId,
    rpcUrl: config.chain.rpcUrl,
    contractAddress: config.chain.contractAddress,
  };
}

/** Anchor a brand-new record on-chain. Returns the transaction hash. */
async function issueOnChain(credId, pdfHash, ipfsCID) {
  return sendContractTx(async (contract, nonce) => {
    const tx = await contract.issueRecord(
      recordIdOf(credId),
      pdfHash,
      ipfsCID || "",
      { nonce }
    );
    return tx.wait();
  });
}

/** Revoke or supersede an existing on-chain record. */
async function updateStatusOnChain(credId, statusIndex, replacementCredId) {
  const replacementId = replacementCredId ? recordIdOf(replacementCredId) : ethers.ZeroHash;
  return sendContractTx(async (contract, nonce) => {
    const tx = await contract.updateRecordStatus(
      recordIdOf(credId),
      statusIndex,
      replacementId,
      { nonce }
    );
    return tx.wait();
  });
}

/** Atomically publish a corrected record and supersede the old one. */
async function supersedeOnChain(oldCredId, newCredId, newHash, newCid) {
  return sendContractTx(async (contract, nonce) => {
    const tx = await contract.supersedeRecord(
      recordIdOf(oldCredId),
      recordIdOf(newCredId),
      newHash,
      newCid || "",
      { nonce }
    );
    return tx.wait();
  });
}

// ------------------------------------------------- client-side signing path
/**
 * Unsigned transaction request the browser (MetaMask) can sign and send.
 * Returns { to, data, chainId }. The backend never signs in this mode.
 */
async function buildTxRequest(action) {
  const provider = getProvider();
  const address = requireContractAddress();
  const contract = new ethers.Contract(address, CONTRACT_ABI, provider);
  const network = await provider.getNetwork();
  const iface = contract.interface;

  const encode = {
    issue: ({ credId, hash, cid }) =>
      iface.encodeFunctionData("issueRecord", [recordIdOf(credId), hash, cid || ""]),
    status: ({ credId, statusIndex, replacementCredId }) =>
      iface.encodeFunctionData("updateRecordStatus", [
        recordIdOf(credId),
        statusIndex,
        replacementCredId ? recordIdOf(replacementCredId) : ethers.ZeroHash,
      ]),
    supersede: ({ oldCredId, newCredId, hash, cid }) =>
      iface.encodeFunctionData("supersedeRecord", [
        recordIdOf(oldCredId),
        recordIdOf(newCredId),
        hash,
        cid || "",
      ]),
  }[action.kind];

  if (!encode) throw new Error(`Unknown tx action: ${action.kind}`);

  return {
    to: address,
    data: encode(action),
    chainId: Number(network.chainId),
  };
}

/**
 * Wait for a client-signed transaction and prove it anchored the expected
 * record. Rejects reverted transactions and transactions emitted by a
 * different contract or for a different record id.
 */
async function confirmClientTx(txHash, { expectedRecordIds = [] } = {}) {
  const provider = getProvider();
  const receipt = await provider.waitForTransaction(txHash, 1, 30_000);
  if (!receipt) throw new Error("Transaction was not mined within 30s");
  if (receipt.status !== 1) throw new Error("Transaction reverted on-chain");

  const address = requireContractAddress().toLowerCase();
  const wrongContract = receipt.logs.some(
    (log) => (log.address || "").toLowerCase() !== address
  );
  if (wrongContract) throw new Error("Transaction logs did not come from AcademicRecordManager");

  if (expectedRecordIds.length) {
    const wanted = new Set(expectedRecordIds.map((id) => recordIdOf(id).toLowerCase()));
    const iface = new ethers.Interface(CONTRACT_ABI);
    const matched = receipt.logs.some((log) => {
      try {
        const parsed = iface.parseLog(log);
        if (!parsed) return false;
        const topic = parsed.args.recordId || parsed.args[0];
        return topic && wanted.has(String(topic).toLowerCase());
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new Error("Transaction did not emit an event for the expected record id");
    }
  }

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, from: receipt.from };
}

/** Is this wallet allowed to write to the contract? (RBAC probe) */
async function isIssuerWallet(address) {
  try {
    return await getReadContract().isIssuer(address);
  } catch {
    return false;
  }
}

/** Grant or revoke issuance rights on-chain (admin wallet only). */
async function setIssuerWallet(address, enabled) {
  return sendContractTx(async (contract, nonce) => {
    const tx = await contract.setIssuer(address, enabled, { nonce });
    return tx.wait();
  });
}

/** Pin a PDF to IPFS via Pinata. Returns { cid, gatewayUrl } or null. */
async function pinToPinata(buffer, fileName) {
  if (!config.pinata.jwt) return null;
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: "application/pdf" }),
    fileName || "transcript.pdf"
  );
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.pinata.jwt}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return {
    cid: data.IpfsHash,
    gatewayUrl: `${config.pinata.gateway}/${data.IpfsHash}`,
  };
}

module.exports = {
  CONTRACT_ABI,
  STATUS_NAMES,
  getProvider,
  getReadContract,
  getWriteContract,
  recordIdOf,
  sha256Hex,
  canonicalJSON,
  verifyOnChain,
  issueOnChain,
  updateStatusOnChain,
  supersedeOnChain,
  buildTxRequest,
  confirmClientTx,
  isIssuerWallet,
  setIssuerWallet,
  pinToPinata,
};
