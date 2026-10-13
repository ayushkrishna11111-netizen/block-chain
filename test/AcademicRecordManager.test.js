const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AcademicRecordManager", function () {
  let contract, admin, issuer, stranger;
  const recordId = ethers.id("CRED-2026-001");
  const recordHash = ethers.sha256(ethers.toUtf8Bytes("transcript-json"));
  const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

  beforeEach(async function () {
    [admin, issuer, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AcademicRecordManager");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  describe("deployment & RBAC", function () {
    it("sets deployer as admin and issuer", async function () {
      expect(await contract.admin()).to.equal(admin.address);
      expect(await contract.isIssuer(admin.address)).to.equal(true);
    });

    it("allows admin to whitelist and revoke issuers", async function () {
      await contract.setIssuer(issuer.address, true);
      expect(await contract.isIssuer(issuer.address)).to.equal(true);

      await contract.setIssuer(issuer.address, false);
      expect(await contract.isIssuer(issuer.address)).to.equal(false);
    });

    it("rejects setIssuer from non-admin", async function () {
      await expect(
        contract.connect(stranger).setIssuer(stranger.address, true)
      ).to.be.revertedWith("ARM: caller is not admin");
    });

    it("transfers admin", async function () {
      await contract.transferAdmin(stranger.address);
      expect(await contract.admin()).to.equal(stranger.address);
    });
  });

  describe("issuance", function () {
    it("issues a record and stores all fields", async function () {
      await expect(contract.issueRecord(recordId, recordHash, cid))
        .to.emit(contract, "RecordIssued")
        .withArgs(recordId, recordHash, cid, admin.address);

      const rec = await contract.verifyRecord(recordId);
      expect(rec.recordHash).to.equal(recordHash);
      expect(rec.ipfsCID).to.equal(cid);
      expect(rec.issuer).to.equal(admin.address);
      expect(rec.status).to.equal(0); // Active
      expect(rec.issueTimestamp).to.be.greaterThan(0n);
    });

    it("rejects duplicate record ids", async function () {
      await contract.issueRecord(recordId, recordHash, cid);
      await expect(contract.issueRecord(recordId, recordHash, cid)).to.be.revertedWith(
        "ARM: record id already exists"
      );
    });

    it("rejects issuance from a non-issuer wallet", async function () {
      await expect(
        contract.connect(stranger).issueRecord(recordId, recordHash, cid)
      ).to.be.revertedWith("ARM: caller is not an issuer");
    });

    it("allows a whitelisted issuer to issue", async function () {
      await contract.setIssuer(issuer.address, true);
      await contract.connect(issuer).issueRecord(recordId, recordHash, cid);
      const rec = await contract.verifyRecord(recordId);
      expect(rec.issuer).to.equal(issuer.address);
    });
  });

  describe("lifecycle", function () {
    beforeEach(async function () {
      await contract.issueRecord(recordId, recordHash, cid);
    });

    it("revokes an active record", async function () {
      await expect(contract.updateRecordStatus(recordId, 1, ethers.ZeroHash))
        .to.emit(contract, "RecordStatusUpdated")
        .withArgs(recordId, 1, ethers.ZeroHash);

      const rec = await contract.verifyRecord(recordId);
      expect(rec.status).to.equal(1); // Revoked
    });

    it("rejects status updates on non-active records", async function () {
      await contract.updateRecordStatus(recordId, 1, ethers.ZeroHash);
      await expect(
        contract.updateRecordStatus(recordId, 1, ethers.ZeroHash)
      ).to.be.revertedWith("ARM: record is not active");
    });

    it("rejects status updates for unknown records", async function () {
      await expect(
        contract.updateRecordStatus(ethers.id("NOPE"), 1, ethers.ZeroHash)
      ).to.be.revertedWith("ARM: record not found");
    });

    it("supersedes an old record with a corrected one atomically", async function () {
      const newId = ethers.id("CRED-2026-001-V2");
      const newHash = ethers.sha256(ethers.toUtf8Bytes("corrected-transcript"));

      await contract.supersedeRecord(recordId, newId, newHash, cid);

      const oldRec = await contract.verifyRecord(recordId);
      expect(oldRec.status).to.equal(2); // Superseded
      expect(oldRec.replacementId).to.equal(newId);

      const newRec = await contract.verifyRecord(newId);
      expect(newRec.recordHash).to.equal(newHash);
      expect(newRec.status).to.equal(0); // Active
    });
  });

  describe("verification (zero-gas view)", function () {
    it("reverts for unknown record ids", async function () {
      await expect(contract.verifyRecord(ethers.id("MISSING"))).to.be.revertedWith(
        "ARM: record not found"
      );
    });

    it("recordExists probes without reverting", async function () {
      expect(await contract.recordExists(recordId)).to.equal(false);
      await contract.issueRecord(recordId, recordHash, cid);
      expect(await contract.recordExists(recordId)).to.equal(true);
    });
  });
});
