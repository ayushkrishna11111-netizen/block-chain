/**
 * Applies backend/schema.sql against the MySQL server.
 * Creates AND selects `academic_db`, which resolves:
 *   ERROR 1046 (3D000): No database selected
 *
 * Usage: npm run db:init -w backend
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  try {
    await connection.query(sql);
    console.log("Schema applied. Database `academic_db` created and selected.");
    console.log("Tables: users, programs, courses, enrollments, academic_records, audit_logs");

    // Upgrade tables left behind by earlier iterations instead of dropping them.
    const [[dbRow]] = await connection.query("SELECT DATABASE() AS db");
    const dbName = dbRow.db;
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbName]
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));

    if (!have.has("department")) {
      await connection.query(
        "ALTER TABLE users ADD COLUMN department VARCHAR(100) NULL AFTER role"
      );
      console.log("upgraded users: added department");
    }
    if (!have.has("program_id")) {
      await connection.query(
        "ALTER TABLE users ADD COLUMN program_id INT NULL AFTER department"
      );
      console.log("upgraded users: added program_id");
    }

    // 0x-prefixed SHA-256 digests are 66 characters long.
    const [hashCol] = await connection.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'academic_records'
          AND COLUMN_NAME = 'pdf_hash'`,
      [dbName]
    );
    if (hashCol.length && Number(hashCol[0].len) < 66) {
      await connection.query(
        "ALTER TABLE academic_records MODIFY pdf_hash VARCHAR(66) NOT NULL"
      );
      console.log("upgraded academic_records: pdf_hash VARCHAR(64) -> VARCHAR(66)");
    }

    // Record-level additions: issuer credential signature + encrypted document.
    const [recordCols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'academic_records'`,
      [dbName]
    );
    const recordHave = new Set(recordCols.map((c) => c.COLUMN_NAME));
    for (const [column, ddl] of [
      [
        "issuer_signature",
        "ALTER TABLE academic_records ADD COLUMN issuer_signature VARCHAR(200) NULL AFTER issuer_wallet",
      ],
      [
        "issuer_signer",
        "ALTER TABLE academic_records ADD COLUMN issuer_signer VARCHAR(42) NULL AFTER issuer_signature",
      ],
      [
        "doc_path",
        "ALTER TABLE academic_records ADD COLUMN doc_path VARCHAR(255) NULL AFTER ipfs_cid",
      ],
      [
        "replaces_cred_id",
        "ALTER TABLE academic_records ADD COLUMN replaces_cred_id VARCHAR(66) NULL AFTER superseded_by",
      ],
    ]) {
      if (recordCols.length && !recordHave.has(column)) {
        await connection.query(ddl);
        console.log(`upgraded academic_records: added ${column}`);
      }
    }

    const [fks] = await connection.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
          AND CONSTRAINT_NAME = 'fk_user_program'`,
      [dbName]
    );
    if (!fks.length && have.has("program_id")) {
      try {
        await connection.query(
          "ALTER TABLE users ADD CONSTRAINT fk_user_program " +
            "FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL"
        );
        console.log("upgraded users: added fk_user_program");
      } catch (err) {
        console.warn("skipped fk_user_program:", err.message);
      }
    }

    // Legacy audit_logs tables used a different column set.
    const [auditCols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'audit_logs'`,
      [dbName]
    );
    const auditHave = new Set(auditCols.map((c) => c.COLUMN_NAME));
    for (const [column, ddl] of [
      ["target", "ALTER TABLE audit_logs ADD COLUMN target VARCHAR(66) NULL AFTER performed_by"],
      ["details", "ALTER TABLE audit_logs ADD COLUMN details VARCHAR(500) NULL AFTER target"],
    ]) {
      if (auditCols.length && !auditHave.has(column)) {
        await connection.query(ddl);
        console.log(`upgraded audit_logs: added ${column}`);
      }
    }
    if (auditCols.length && !auditHave.has("created_at")) {
      if (auditHave.has("timestamp")) {
        await connection.query(
          "ALTER TABLE audit_logs CHANGE COLUMN timestamp created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
        );
        console.log("upgraded audit_logs: renamed timestamp -> created_at");
      } else {
        await connection.query(
          "ALTER TABLE audit_logs ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
        );
        console.log("upgraded audit_logs: added created_at");
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Failed to initialise database:", err.message);
  process.exit(1);
});
