const hre = require("hardhat");

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

  // Optionally whitelist the registrar/issuer wallet from the environment.
  const issuer = process.env.ISSUER_ADDRESS;
  if (issuer && issuer.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await contract.setIssuer(issuer, true);
    await tx.wait();
    console.log(`Issuer whitelisted: ${issuer}`);
  }

  const admin = await contract.admin();
  const deployerIsIssuer = await contract.isIssuer(deployer.address);
  console.log(`admin        = ${admin}`);
  console.log(`deployerIsIssuer = ${deployerIsIssuer}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
