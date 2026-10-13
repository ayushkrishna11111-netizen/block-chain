const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { pointsFor } = require("../grades");
const { audit } = require("../audit");

const router = express.Router();

// ------------------------------------------------------------------ programs
router.get("/programs", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, program_code, program_name, degree_title, total_credits, department FROM programs ORDER BY program_code"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/programs",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { program_code, program_name, degree_title, total_credits, department } =
        req.body || {};
      if (!program_code || !program_name || !degree_title) {
        return res
          .status(400)
          .json({ error: "program_code, program_name and degree_title are required" });
      }
      const [result] = await pool.execute(
        `INSERT INTO programs (program_code, program_name, degree_title, total_credits, department)
         VALUES (?, ?, ?, ?, ?)`,
        [
          program_code.toUpperCase(),
          program_name,
          degree_title,
          Number(total_credits) || 120,
          department || null,
        ]
      );
      await audit("PROGRAM_CREATED", req.user.wallet_address, program_code, program_name);
      res.status(201).json({ id: result.insertId });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Program code already exists" });
      }
      next(err);
    }
  }
);

// ------------------------------------------------------------------- courses
router.get("/courses", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.course_code, c.title, c.credits, c.program_id, p.program_name
         FROM courses c
         LEFT JOIN programs p ON p.id = c.program_id
        ORDER BY c.course_code`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/courses",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { course_code, title, credits, program_id } = req.body || {};
      if (!course_code || !title) {
        return res.status(400).json({ error: "course_code and title are required" });
      }
      const [result] = await pool.execute(
        "INSERT INTO courses (course_code, title, credits, program_id) VALUES (?, ?, ?, ?)",
        [course_code.toUpperCase(), title, Number(credits) || 3, program_id || null]
      );
      await audit("COURSE_CREATED", req.user.wallet_address, course_code, title);
      res.status(201).json({ id: result.insertId });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Course code already exists" });
      }
      next(err);
    }
  }
);

// -------------------------------------------------------- enrollments/grades
router.get("/enrollments", requireAuth, async (req, res, next) => {
  try {
    const { studentId, term } = req.query;
    const clauses = [];
    const params = [];
    if (studentId) {
      clauses.push("e.student_id = ?");
      params.push(Number(studentId));
    }
    if (term) {
      clauses.push("e.term = ?");
      params.push(String(term));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.execute(
      `SELECT e.id, e.student_id, e.course_id, e.term, e.grade, e.grade_points, e.status,
              c.course_code, c.title, c.credits, u.full_name AS student_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN users   u ON u.id = e.student_id
         ${where}
        ORDER BY e.term DESC, c.course_code
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/enrollments",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { studentId, courseId, term } = req.body || {};
      if (!studentId || !courseId || !term) {
        return res.status(400).json({ error: "studentId, courseId and term are required" });
      }
      const [result] = await pool.execute(
        "INSERT INTO enrollments (student_id, course_id, term) VALUES (?, ?, ?)",
        [Number(studentId), Number(courseId), term]
      );
      await audit("ENROLLMENT_ADDED", req.user.wallet_address, `student:${studentId}`, `${term}`);
      res.status(201).json({ id: result.insertId });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Student is already enrolled in this course/term" });
      }
      next(err);
    }
  }
);

/** Post a grade: converts the letter to grade points and completes the row. */
router.post(
  "/enrollments/:id/grade",
  requireAuth,
  requireRole("ADMIN", "ISSUER"),
  async (req, res, next) => {
    try {
      const { grade } = req.body || {};
      if (!grade) return res.status(400).json({ error: "grade is required" });
      let points;
      try {
        points = pointsFor(grade);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      const [result] = await pool.execute(
        `UPDATE enrollments
            SET grade = ?, grade_points = ?, status = 'COMPLETED'
          WHERE id = ?`,
        [String(grade).toUpperCase(), points, Number(req.params.id)]
      );
      if (!result.affectedRows) {
        return res.status(404).json({ error: "Enrollment not found" });
      }
      await audit("GRADE_POSTED", req.user.wallet_address, `enrollment:${req.params.id}`, grade);
      res.json({ ok: true, grade: String(grade).toUpperCase(), gradePoints: points });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
