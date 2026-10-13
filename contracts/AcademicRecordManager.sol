// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AcademicRecordManager
 * @notice On-chain state registry for academic records.
 *
 * The relational database (MySQL) remains the source of truth for academic
 * data (students, courses, grades, GPAs, transcript versions). This contract
 * only anchors:
 *   - a 32-byte SHA-256 digest of the canonical transcript/degree document
 *   - the IPFS CID of the stored PDF
 *   - the lifecycle status (Active / Revoked / Superseded)
 *
 * Verification is an integrated read-only feature: `verifyRecord` is a view
 * function so external verifiers can query it with a zero-gas eth_call.
 */
contract AcademicRecordManager {
    address public admin;

    /// Whitelisted registrar/faculty wallets allowed to issue records.
    mapping(address => bool) public isIssuer;

    enum RecordStatus {
        Active,
        Revoked,
        Superseded
    }

    struct AcademicRecord {
        bytes32 recordHash; // SHA-256 digest of the canonical transcript/degree
        string ipfsCID; // IPFS CID of the off-chain document
        address issuer; // Wallet that issued the record
        uint256 issueTimestamp; // When the record was finalized on-chain
        RecordStatus status; // Lifecycle status
        bytes32 replacementId; // New record ID when superseded/updated
    }

    mapping(bytes32 => AcademicRecord) private records;

    // ------------------------------------------------------------------ events
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event IssuerUpdated(address indexed issuer, bool enabled);
    event RecordIssued(
        bytes32 indexed recordId,
        bytes32 recordHash,
        string ipfsCID,
        address indexed issuer
    );
    event RecordStatusUpdated(
        bytes32 indexed recordId,
        RecordStatus newStatus,
        bytes32 replacementId
    );

    // ---------------------------------------------------------------- modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "ARM: caller is not admin");
        _;
    }

    modifier onlyIssuer() {
        require(isIssuer[msg.sender] || msg.sender == admin, "ARM: caller is not an issuer");
        _;
    }

    modifier existing(bytes32 _recordId) {
        require(records[_recordId].issueTimestamp != 0, "ARM: record not found");
        _;
    }

    constructor() {
        admin = msg.sender;
        isIssuer[msg.sender] = true;
    }

    // ------------------------------------------------------------------ admin
    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "ARM: zero address");
        emit AdminTransferred(admin, _newAdmin);
        admin = _newAdmin;
    }

    /// @notice Grant or revoke registrar/faculty issuance rights (RBAC).
    function setIssuer(address _issuer, bool _enabled) external onlyAdmin {
        require(_issuer != address(0), "ARM: zero address");
        isIssuer[_issuer] = _enabled;
        emit IssuerUpdated(_issuer, _enabled);
    }

    // ------------------------------------------------------------- issuance
    function issueRecord(
        bytes32 _recordId,
        bytes32 _recordHash,
        string calldata _ipfsCID
    ) external onlyIssuer {
        require(records[_recordId].issueTimestamp == 0, "ARM: record id already exists");

        records[_recordId] = AcademicRecord({
            recordHash: _recordHash,
            ipfsCID: _ipfsCID,
            issuer: msg.sender,
            issueTimestamp: block.timestamp,
            status: RecordStatus.Active,
            replacementId: bytes32(0)
        });

        emit RecordIssued(_recordId, _recordHash, _ipfsCID, msg.sender);
    }

    // -------------------------------------------------------------- lifecycle
    /// @notice Revoke (or otherwise update the status of) an active record.
    function updateRecordStatus(
        bytes32 _recordId,
        RecordStatus _newStatus,
        bytes32 _replacementId
    ) external onlyIssuer existing(_recordId) {
        require(records[_recordId].status == RecordStatus.Active, "ARM: record is not active");

        records[_recordId].status = _newStatus;
        records[_recordId].replacementId = _replacementId;

        emit RecordStatusUpdated(_recordId, _newStatus, _replacementId);
    }

    /**
     * @notice Atomic transcript correction: publish the corrected record and
     * mark the previous version as Superseded in a single transaction.
     */
    function supersedeRecord(
        bytes32 _oldId,
        bytes32 _newId,
        bytes32 _newHash,
        string calldata _newIpfsCID
    ) external onlyIssuer existing(_oldId) {
        require(records[_oldId].status == RecordStatus.Active, "ARM: old record is not active");
        require(records[_newId].issueTimestamp == 0, "ARM: new record id already exists");

        records[_newId] = AcademicRecord({
            recordHash: _newHash,
            ipfsCID: _newIpfsCID,
            issuer: msg.sender,
            issueTimestamp: block.timestamp,
            status: RecordStatus.Active,
            replacementId: bytes32(0)
        });

        records[_oldId].status = RecordStatus.Superseded;
        records[_oldId].replacementId = _newId;

        emit RecordIssued(_newId, _newHash, _newIpfsCID, msg.sender);
        emit RecordStatusUpdated(_oldId, RecordStatus.Superseded, _newId);
    }

    // ------------------------------------------------------- verification API
    /// @notice Zero-gas public lookup (eth_call). Reverts if the ID is unknown.
    function verifyRecord(bytes32 _recordId)
        external
        view
        existing(_recordId)
        returns (
            bytes32 recordHash,
            string memory ipfsCID,
            address issuer,
            uint256 issueTimestamp,
            RecordStatus status,
            bytes32 replacementId
        )
    {
        AcademicRecord storage rec = records[_recordId];
        return (
            rec.recordHash,
            rec.ipfsCID,
            rec.issuer,
            rec.issueTimestamp,
            rec.status,
            rec.replacementId
        );
    }

    /// @notice Non-reverting existence probe, convenient for UIs.
    function recordExists(bytes32 _recordId) external view returns (bool) {
        return records[_recordId].issueTimestamp != 0;
    }
}
