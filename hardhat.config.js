require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { RPC_URL, SIGNER_PRIVATE_KEY, SEPOLIA_RPC_URL, PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      // Deliberately NOT the default 31337: MetaMask's built-in "Localhost 8545"
      // network also claims chainId 31337 (and this machine has/had a node on
      // :8545). A unique id lets the client ask wallet_addEthereumChain for an
      // unambiguous network pointing at http://127.0.0.1:8546.
      // Keep in sync with client/src/wallet.js.
      chainId: 31338,
    },
    localhost: {
      // This machine runs the development node on 8546 (8545 is in use).
      url: RPC_URL || "http://127.0.0.1:8546",
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || RPC_URL || "",
      accounts: (PRIVATE_KEY || SIGNER_PRIVATE_KEY) ? [PRIVATE_KEY || SIGNER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
