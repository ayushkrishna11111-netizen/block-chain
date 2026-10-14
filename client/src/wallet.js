/**
 * Local-chain helpers shared by the sign-in flow (auth.jsx) and the
 * client-side signing path (pages/Records.jsx).
 *
 * CHAIN_ID / RPC_URL must match `networks.hardhat.chainId` and RPC_URL in
 * .env (hardhat.config.js). The chain id is intentionally 31338, not the
 * Hardhat default 31337: MetaMask's built-in "Localhost 8545" network claims
 * 31337, so a switch request could silently land on the wrong node. A unique
 * id lets wallet_addEthereumChain create a fresh, unambiguous entry.
 */
export const LOCAL_CHAIN = {
  chainId: "0x7a6a", // 31338
  chainName: "Hardhat Local (8546)",
  rpcUrls: ["http://127.0.0.1:8546"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const LOCAL_CHAIN_ID = 31338;

/** True when the injected wallet is already on the app's chain. */
export async function isLocalChain() {
  if (!window.ethereum) return false;
  try {
    const current = await window.ethereum.request({ method: "eth_chainId" });
    return parseInt(current, 16) === LOCAL_CHAIN_ID;
  } catch {
    return false;
  }
}

function errorCode(err) {
  return err?.code ?? err?.data?.originalError?.code;
}

/**
 * Best-effort: point the injected wallet at the app's local chain.
 * Returns true when we end up on the right chain.
 * Never throws — a declined prompt must not block sign-in.
 */
export async function ensureLocalChain() {
  if (!window.ethereum) return false;
  if (await isLocalChain()) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOCAL_CHAIN.chainId }],
    });
  } catch (err) {
    // 4902 = unrecognized chain → offer to add it (with our RPC URL).
    if (errorCode(err) === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [LOCAL_CHAIN],
        });
      } catch {
        // User declined the add; fall through to the final check.
      }
    }
    // 4001 (rejected switch) and anything else: fall through and re-check.
  }
  return isLocalChain();
}
