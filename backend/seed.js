/**
 * Seeds demo users, a degree program, courses and grades.
 * Idempotent: safe to run multiple times.
 *
 * Usage: npm run db:seed -w backend
 *
 * Role wallets (scripts/role-wallets.js) are the MetaMask accounts you import
 * and sign in with. The public Hardhat dev wallets keep their roles so the
 * automated suites (smoke-api, measure, tamper-suite) can sign login messages
 * with well-known private keys.
 */
const { pool } = require("./db");
const { pointsFor } = require("./grades");
const { ROLE_WALLETS, TEST_WALLETS } = require("../scripts/role-wallets");

// The MetaMask wallets you actually connect (see README).
const ADMIN_WALLET = ROLE_WALLETS.ADMIN;
const ISSUER_WALLET = ROLE_WALLETS.ISSUER;
const STUDENT_WALLET = ROLE_WALLETS.STUDENT;

// Hardhat dev accounts (public test keys, zero real value) used by scripts/.
const TEST_ADMIN_WALLET = TEST_WALLETS.ADMIN;
const TEST_ISSUER_WALLET = TEST_WALLETS.ISSUER;
const TEST_STUDENT_WALLET = TEST_WALLETS.STUDENT;

const PROGRAM = {
  code: "BSCS",
  name: "BSc Computer Science",
  degree: "Bachelor of Science in Computer Science",
  credits: 132,
};

const COURSES = [
  ["CS101", "Introduction to Programming", 3],
  ["CS201", "Data Structures & Algorithms", 4],
  ["CS305", "Database Systems", 3],
  ["CS410", "Blockchain & Distributed Systems", 3],
  ["MATH120", "Discrete Mathematics", 3],
  ["ENG101", "Academic Writing", 2],
];

async function upsertUser(wallet, name, email, role, programId = null) {
  await pool.execute(
    `INSERT INTO users (wallet_address, full_name, email, role, program_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), role = VALUES(role), program_id = VALUES(program_id)`,
    [wallet, name, email, role, programId]
  );
  const [rows] = await pool.execute("SELECT id FROM users WHERE wallet_address = ?", [wallet]);
  return rows[0].id;
}

async function main() {
  // Program
  await pool.execute(
    `INSERT INTO programs (program_code, program_name, degree_title, total_credits, department)
     VALUES (?, ?, ?, ?, 'Computing')
     ON DUPLICATE KEY UPDATE program_name = VALUES(program_name)`,
    [PROGRAM.code, PROGRAM.name, PROGRAM.degree, PROGRAM.credits]
  );
  const [[program]] = await pool.execute("SELECT id FROM programs WHERE program_code = ?", [
    PROGRAM.code,
  ]);

  // Free the canonical demo identities from earlier seeds: the Hardhat fixture
  // rows may still hold admin@ / registrar@ / ada@ university emails, which the
  // role wallets below now own (email is UNIQUE). Idempotent: only fires when
  // the fixture row still carries the canonical email.
  for (const [wallet, name, email, oldEmail] of [
    [TEST_ADMIN_WALLET, "Test Admin", "test-admin@university.edu", "admin@university.edu"],
    [TEST_ISSUER_WALLET, "Test Issuer", "test-issuer@university.edu", "registrar@university.edu"],
    [TEST_STUDENT_WALLET, "Test Student", "test-student@university.edu", "ada@student.edu"],
  ]) {
    await pool.execute(
      `UPDATE users SET full_name = ?, email = ? WHERE wallet_address = ? AND email = ?`,
      [name, email, wallet, oldEmail]
    );
  }

  // Users — the MetaMask wallets you connect with.
  await upsertUser(ADMIN_WALLET, "Registrar Admin", "admin@university.edu", "ADMIN");
  await upsertUser(ISSUER_WALLET, "Dr. A. Issuer", "registrar@university.edu", "ISSUER");
  const studentId = await upsertUser(
    STUDENT_WALLET,
    "Ada Student",
    "ada@student.edu",
    "STUDENT",
    program.id
  );

  // Users — Hardhat fixtures so the automated suites can still sign in.
  await upsertUser(TEST_ADMIN_WALLET, "Test Admin", "test-admin@university.edu", "ADMIN");
  await upsertUser(TEST_ISSUER_WALLET, "Test Issuer", "test-issuer@university.edu", "ISSUER");
  const testStudentId = await upsertUser(
    TEST_STUDENT_WALLET,
    "Test Student",
    "test-student@university.edu",
    "STUDENT",
    program.id
  );

  // Courses
  const courseIds = {};
  for (const [code, title, credits] of COURSES) {
    await pool.execute(
      `INSERT INTO courses (course_code, title, credits, program_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), credits = VALUES(credits)`,
      [code, title, credits, program.id]
    );
    const [[row]] = await pool.execute("SELECT id FROM courses WHERE course_code = ?", [code]);
    courseIds[code] = row.id;
  }

  // Enrollments + grades for both demo students (role wallet + fixture).
  const grades = {
    CS101: "A",
    CS201: "A-",
    CS305: "B+",
    MATH120: "A",
    ENG101: "A-",
    // CS410 intentionally left ungraded to demonstrate an in-progress term.
  };
  for (const sid of [studentId, testStudentId]) {
    for (const [code, grade] of Object.entries(grades)) {
      await pool.execute(
        `INSERT INTO enrollments (student_id, course_id, term, grade, grade_points, status)
         VALUES (?, ?, 'Fall-2025', ?, ?, 'COMPLETED')
         ON DUPLICATE KEY UPDATE grade = VALUES(grade), grade_points = VALUES(grade_points)`,
        [sid, courseIds[code], grade, pointsFor(grade)]
      );
    }
    await pool.execute(
      `INSERT INTO enrollments (student_id, course_id, term, status)
       VALUES (?, ?, 'Spring-2026', 'ENROLLED')
       ON DUPLICATE KEY UPDATE status = 'ENROLLED'`,
      [sid, courseIds.CS410]
    );
  }

  console.log("Seed complete.");
  console.log("  Sign-in wallets (import these in MetaMask):");
  console.log(`    ADMIN   ${ADMIN_WALLET}`);
  console.log(`    ISSUER  ${ISSUER_WALLET}`);
  console.log(`    STUDENT ${STUDENT_WALLET} (id ${studentId})`);
  console.log("  Test fixtures (scripts/ only):");
  console.log(`    ADMIN   ${TEST_ADMIN_WALLET}`);
  console.log(`    ISSUER  ${TEST_ISSUER_WALLET}`);
  console.log(`    STUDENT ${TEST_STUDENT_WALLET} (id ${testStudentId})`);
  console.log(
    `  Program ${PROGRAM.code}, ${COURSES.length} courses, ${
      Object.keys(grades).length
    } graded enrollments`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  });
