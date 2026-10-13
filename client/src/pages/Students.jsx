import { useEffect, useState } from "react";
import { api, shortAddr } from "../api";
import { Field, StatusBox } from "../components";
import { useAuth } from "../auth";

const ROLES = ["STUDENT", "ISSUER", "VERIFIER", "ADMIN"];

export default function Students() {
  const { user } = useAuth();
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [issuers, setIssuers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  const [userForm, setUserForm] = useState({
    wallet_address: "",
    full_name: "",
    email: "",
    role: "STUDENT",
    department: "",
  });
  const [courseForm, setCourseForm] = useState({
    course_code: "",
    title: "",
    credits: 3,
    program_id: "",
  });
  const [enrollForm, setEnrollForm] = useState({
    studentId: "",
    courseId: "",
    term: "Spring-2026",
  });

  const loadAll = () => {
    api("/users").then(setUsers).catch(() => setUsers([]));
    api("/academics/courses").then(setCourses).catch(() => setCourses([]));
    api("/academics/programs").then(setPrograms).catch(() => setPrograms([]));
    api("/academics/enrollments").then(setEnrollments).catch(() => setEnrollments([]));
    api("/chain/issuers").then(setIssuers).catch(() => setIssuers([]));
  };

  useEffect(loadAll, []);

  const students = users.filter((u) => u.role === "STUDENT");

  async function run(fn, successTitle) {
    setBusy(true);
    setFeedback({ state: "loading", title: "Saving…", body: "" });
    try {
      await fn();
      setFeedback({ state: "success", title: successTitle, body: "Saved." });
      loadAll();
    } catch (err) {
      setFeedback({ state: "error", title: "Operation failed", body: err.message });
    } finally {
      setBusy(false);
    }
  }

  /** On-chain RBAC: grant or revoke the contract's issuer whitelist. */
  async function toggleIssuer(entry) {
    const next = !entry.onChain;
    await run(
      () =>
        api("/chain/issuers", {
          method: "POST",
          body: { address: entry.wallet, enabled: next },
        }),
      next ? "Issuer whitelisted on-chain" : "Issuer removed on-chain"
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students & academics</h1>
          <p>RBAC identities, degree programs, course catalogue, enrollment and grade posting.</p>
        </div>
      </div>

      <div className="tabs">
        {[
          ["users", "👥 Users & roles"],
          ["courses", "📚 Courses & programs"],
          ["grades", "📝 Enrollment & grades"],
          ["chain", "⛓️ Issuer wallets"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <StatusBox state={feedback?.state} title={feedback?.title}>
        {feedback?.body}
      </StatusBox>

      {tab === "users" && (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api("/users", { method: "POST", body: userForm }), "User registered").then(() =>
                setUserForm({ wallet_address: "", full_name: "", email: "", role: "STUDENT", department: "" })
              );
            }}
          >
            <h3>➕ Register identity</h3>
            <Field label="Wallet address">
              <input
                className="hash"
                value={userForm.wallet_address}
                onChange={(e) => setUserForm({ ...userForm, wallet_address: e.target.value })}
                placeholder="0x…"
                required
              />
            </Field>
            <div className="form-row">
              <Field label="Full name">
                <input
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Role">
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <input
                  value={userForm.department}
                  onChange={(e) => setUserForm({ ...userForm, department: e.target.value })}
                  placeholder="Computing"
                />
              </Field>
            </div>
            <button className="full" disabled={busy}>
              Register
            </button>
          </form>

          <div className="card">
            <h3>Registered identities</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Wallet</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.fullName}
                        <div className="muted small-text">{u.email}</div>
                      </td>
                      <td className="hash">{shortAddr(u.wallet, 6)}</td>
                      <td>
                        <span className="badge badge-role">{u.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "courses" && (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api("/academics/courses", { method: "POST", body: courseForm }), "Course created").then(
                () => setCourseForm({ course_code: "", title: "", credits: 3, program_id: "" })
              );
            }}
          >
            <h3>➕ Add course</h3>
            <div className="form-row">
              <Field label="Course code">
                <input
                  value={courseForm.course_code}
                  onChange={(e) => setCourseForm({ ...courseForm, course_code: e.target.value })}
                  placeholder="CS201"
                  required
                />
              </Field>
              <Field label="Credits">
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={courseForm.credits}
                  onChange={(e) => setCourseForm({ ...courseForm, credits: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Title">
              <input
                value={courseForm.title}
                onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                placeholder="Data Structures & Algorithms"
                required
              />
            </Field>
            <Field label="Program">
              <select
                value={courseForm.program_id}
                onChange={(e) => setCourseForm({ ...courseForm, program_id: e.target.value })}
              >
                <option value="">Unassigned</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.program_code}
                  </option>
                ))}
              </select>
            </Field>
            <button className="full" disabled={busy}>
              Add course
            </button>
          </form>

          <div className="card">
            <h3>Course catalogue</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Title</th>
                    <th>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id}>
                      <td className="hash">{c.course_code}</td>
                      <td>{c.title}</td>
                      <td>{c.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "grades" && (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => api("/academics/enrollments", { method: "POST", body: enrollForm }),
                "Student enrolled"
              ).then(() => setEnrollForm({ studentId: "", courseId: "", term: "Spring-2026" }));
            }}
          >
            <h3>➕ Enroll student</h3>
            <Field label="Student">
              <select
                value={enrollForm.studentId}
                onChange={(e) => setEnrollForm({ ...enrollForm, studentId: e.target.value })}
                required
              >
                <option value="">Select…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-row">
              <Field label="Course">
                <select
                  value={enrollForm.courseId}
                  onChange={(e) => setEnrollForm({ ...enrollForm, courseId: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.course_code} — {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Term">
                <input
                  value={enrollForm.term}
                  onChange={(e) => setEnrollForm({ ...enrollForm, term: e.target.value })}
                  required
                />
              </Field>
            </div>
            <button className="full" disabled={busy}>
              Enroll
            </button>
          </form>

          <div className="card">
            <h3>Grade book</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Course</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((en) => (
                    <tr key={en.id}>
                      <td>
                        {en.student_name}
                        <div className="muted small-text">{en.term}</div>
                      </td>
                      <td>
                        {en.course_code}
                        <div className="muted small-text">{en.credits} credits</div>
                      </td>
                      <td>
                        {en.status === "COMPLETED" ? (
                          <span className="badge badge-success">
                            {en.grade} ({Number(en.grade_points).toFixed(1)})
                          </span>
                        ) : (
                          <select
                            style={{ width: 110 }}
                            defaultValue=""
                            onChange={async (e) => {
                              if (!e.target.value) return;
                              try {
                                await api(`/academics/enrollments/${en.id}/grade`, {
                                  method: "POST",
                                  body: { grade: e.target.value },
                                });
                                setFeedback({
                                  state: "success",
                                  title: "Grade posted",
                                  body: `${en.course_code} → ${e.target.value}`,
                                });
                                loadAll();
                              } catch (err) {
                                setFeedback({
                                  state: "error",
                                  title: "Grade posting failed",
                                  body: err.message,
                                });
                              }
                            }}
                          >
                            <option value="">post grade…</option>
                            {["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"].map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "chain" && (
        <div className="card">
          <h3>⛓️ Contract issuer whitelist (RBAC)</h3>
          <p className="muted small-text">
            The contract independently enforces who may write: even if the API were bypassed,
            an unauthorised wallet cannot anchor records. Whitelisted issuers can sign
            transactions themselves in MetaMask instead of the server signer.
            {user?.role !== "ADMIN" && " (Only ADMIN wallets can change this list.)"}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Identity</th>
                  <th>Wallet</th>
                  <th>On-chain issuer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issuers.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.fullName}
                      <div className="muted small-text">
                        <span className="badge badge-role">{entry.role}</span>
                      </div>
                    </td>
                    <td className="hash">{shortAddr(entry.wallet, 6)}</td>
                    <td>
                      <span className={`badge ${entry.onChain ? "badge-success" : "badge-muted"}`}>
                        {entry.onChain ? "whitelisted" : "not whitelisted"}
                      </span>
                    </td>
                    <td>
                      {user?.role === "ADMIN" && (
                        <button
                          className={entry.onChain ? "danger small" : "small"}
                          disabled={busy}
                          onClick={() => toggleIssuer(entry)}
                        >
                          {entry.onChain ? "Remove" : "Whitelist"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
