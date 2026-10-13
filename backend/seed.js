/**
 * Seeds demo users, a degree program, courses and grades.
 * Idempotent: safe to run multiple times.
 *
 * Usage: npm run db:seed -w backend
 *
 * Wallets below are the public Hardhat account keys, used only for local dev.
 */
const { pool } = require("./db");
const { pointsFor } = require("./grades");

// Well-known Hardhat local accounts (public test keys, zero real value).
const ADMIN_WALLET = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const ISSUER_WALLET = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const STUDENT_WALLET = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

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
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role)`,
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

  // Users
  await upsertUser(ADMIN_WALLET, "Registrar Admin", "admin@university.edu", "ADMIN");
  await upsertUser(ISSUER_WALLET, "Dr. A. Issuer", "registrar@university.edu", "ISSUER");
  const studentId = await upsertUser(
    STUDENT_WALLET,
    "Ada Student",
    "ada@student.edu",
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

  // Enrollments + grades for the demo student
  const grades = {
    CS101: "A",
    CS201: "A-",
    CS305: "B+",
    MATH120: "A",
    ENG101: "A-",
    // CS410 intentionally left ungraded to demonstrate an in-progress term.
  };
  for (const [code, grade] of Object.entries(grades)) {
    await pool.execute(
      `INSERT INTO enrollments (student_id, course_id, term, grade, grade_points, status)
       VALUES (?, ?, 'Fall-2025', ?, ?, 'COMPLETED')
       ON DUPLICATE KEY UPDATE grade = VALUES(grade), grade_points = VALUES(grade_points)`,
      [studentId, courseIds[code], grade, pointsFor(grade)]
    );
  }
  await pool.execute(
    `INSERT INTO enrollments (student_id, course_id, term, status)
     VALUES (?, ?, 'Spring-2026', 'ENROLLED')
     ON DUPLICATE KEY UPDATE status = 'ENROLLED'`,
    [studentId, courseIds.CS410]
  );

  console.log("Seed complete.");
  console.log(`  ADMIN   wallet: ${ADMIN_WALLET}`);
  console.log(`  ISSUER  wallet: ${ISSUER_WALLET}`);
  console.log(`  STUDENT wallet: ${STUDENT_WALLET} (id ${studentId})`);
  console.log(`  Program ${PROGRAM.code}, ${COURSES.length} courses, ${Object.keys(grades).length} graded enrollments`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  });
