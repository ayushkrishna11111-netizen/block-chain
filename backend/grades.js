/** Letter grade -> 4.0-scale grade points used for GPA computation. */
const GRADE_POINTS = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  D: 1.0,
  F: 0.0,
};

function pointsFor(grade) {
  const key = String(grade || "").toUpperCase();
  if (!(key in GRADE_POINTS)) {
    throw new Error(
      `Unknown grade "${grade}". Allowed: ${Object.keys(GRADE_POINTS).join(", ")}`
    );
  }
  return GRADE_POINTS[key];
}

/** Weighted GPA over completed credits. Returns 0 when nothing is completed. */
function computeGpa(completedRows) {
  let weight = 0;
  let total = 0;
  for (const row of completedRows) {
    const credits = Number(row.credits || 0);
    const points =
      row.grade_points !== null && row.grade_points !== undefined
        ? Number(row.grade_points)
        : pointsFor(row.grade);
    weight += credits;
    total += credits * points;
  }
  return weight === 0 ? 0 : Math.round((total / weight) * 100) / 100;
}

module.exports = { GRADE_POINTS, pointsFor, computeGpa };
