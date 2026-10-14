const hre = require("hardhat");
const { ROLE_WALLETS } = require("./role-wallets");

/**
 * Deploys AcademicRecordManager and, if provided, registers an issuer wallet.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 *
 * Copy the printed CONTRACT_ADDRESS into your .env file.
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Network : ${hre.network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const Factory = await hre.ethers.getContractFactory("AcademicRecordManager");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`CONTRACT_ADDRESS=${address}`);

  // Local development: give the MetaMask role wallets gas so they can sign
  // transactions client-side (they are ordinary accounts, not Hardhat keys).
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    const balance = "0x56BC75E2D63100000"; // 100 ETH
    for (const [role, addr] of Object.entries(ROLE_WALLETS)) {
      await hre.network.provider.send("hardhat_setBalance", [addr, balance]);
      console.log(`Funded ${role} wallet ${addr} with 100 ETH`);
    }
  }

  // Whitelist the registrar/issuer wallet: ISSUER_ADDRESS from the
  // environment, or — on a local node — the role wallet from
  // scripts/role-wallets.js so MetaMask client-side signing works out of the box.
  const issuer =
    process.env.ISSUER_ADDRESS ||
    (hre.network.name === "localhost" || hre.network.name === "hardhat"
      ? ROLE_WALLETS.ISSUER
      : undefined);
  if (issuer && issuer.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await contract.setIssuer(issuer, true);
    await tx.wait();
    console.log(`Issuer whitelisted: ${issuer}`);
  }

  const admin = await contract.admin();
  const deployerIsIssuer = await contract.isIssuer(deployer.address);
  const issuerIsIssuer = issuer ? await contract.isIssuer(issuer) : false;
  console.log(`admin        = ${admin}`);
  console.log(`deployerIsIssuer = ${deployerIsIssuer}`);
  console.log(`issuerIsIssuer    = ${issuerIsIssuer}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
