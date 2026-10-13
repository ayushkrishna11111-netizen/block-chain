-- ============================================================================
-- Academic Record Management System - MySQL 8 schema
-- Fixes ERROR 1046 (3D000): we create AND select the database explicitly.
-- Run:  mysql -u root -p < backend/schema.sql
--   or: npm run db:init -w backend
-- ============================================================================

CREATE DATABASE IF NOT EXISTS academic_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE academic_db;

-- ----------------------------------------------------------- degree mapping --
CREATE TABLE IF NOT EXISTS programs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  program_code  VARCHAR(20)  NOT NULL UNIQUE,
  program_name  VARCHAR(120) NOT NULL,
  degree_title  VARCHAR(120) NOT NULL,
  total_credits INT          NOT NULL DEFAULT 120,
  department    VARCHAR(100) NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- identity --
CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  wallet_address VARCHAR(42)  NOT NULL UNIQUE,
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(120) NOT NULL UNIQUE,
  role           ENUM('ADMIN','ISSUER','STUDENT','VERIFIER') NOT NULL DEFAULT 'STUDENT',
  department     VARCHAR(100) NULL,
  program_id     INT          NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS courses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(20)  NOT NULL UNIQUE,
  title       VARCHAR(150) NOT NULL,
  credits     INT          NOT NULL DEFAULT 3,
  program_id  INT          NULL,
  CONSTRAINT fk_course_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------- enrollment + ongoing transcript --
CREATE TABLE IF NOT EXISTS enrollments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,
  course_id    INT NOT NULL,
  term         VARCHAR(20) NOT NULL,
  grade        CHAR(2)  NULL,
  grade_points DECIMAL(3,2) NULL,
  status       ENUM('ENROLLED','COMPLETED','WITHDRAWN') NOT NULL DEFAULT 'ENROLLED',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_enrollment (student_id, course_id, term),
  CONSTRAINT fk_enroll_student FOREIGN KEY (student_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_enroll_course FOREIGN KEY (course_id)
    REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------- finalized records / transcript log --
CREATE TABLE IF NOT EXISTS academic_records (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  cred_id       VARCHAR(66)  NOT NULL UNIQUE,  -- human id, e.g. CRED-2026-001
  record_id     VARCHAR(66)  NOT NULL UNIQUE,  -- bytes32 keccak256(cred_id) used on-chain
  student_id    INT          NOT NULL,
  program_id    INT          NULL,
  term          VARCHAR(20)  NOT NULL,
  gpa           DECIMAL(4,2) NULL,
  total_credits INT          NOT NULL DEFAULT 0,
  transcript_json MEDIUMTEXT NOT NULL,         -- canonical JSON that was hashed
  pdf_hash      VARCHAR(66)  NOT NULL,         -- SHA-256 hex (0x + 64), anchored on-chain
  ipfs_cid      VARCHAR(100) NULL,
  tx_hash       VARCHAR(66)  NULL,
  status        ENUM('DRAFT','ACTIVE','REVOKED','SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
  superseded_by VARCHAR(66)  NULL,             -- record_id of the replacement
  issuer_wallet VARCHAR(42)  NULL,
  issued_at     DATETIME     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_records_student (student_id),
  KEY idx_records_status  (status),
  KEY idx_records_hash    (pdf_hash),
  CONSTRAINT fk_record_student FOREIGN KEY (student_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- --------------------------------------------------------------- audit trail --
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  action       VARCHAR(50)  NOT NULL,
  performed_by VARCHAR(42)  NOT NULL,
  target       VARCHAR(66)  NULL,
  details      VARCHAR(500) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
