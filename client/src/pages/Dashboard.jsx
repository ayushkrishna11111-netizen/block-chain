import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { StatCard, StatusBox } from "../components";
import { useAuth } from "../auth";

const ACTION_LABELS = {
  RECORD_ISSUED: "Record issued",
  RECORD_SUPERSEDED: "Record superseded",
  RECORD_REVOKED: "Record revoked",
  RECORD_ANCHORED: "Record anchored",
  RECORD_ANCHOR_FAILED: "Anchor failed",
  GRADE_POSTED: "Grade posted",
  ENROLLMENT_ADDED: "Enrollment added",
  COURSE_CREATED: "Course created",
  PROGRAM_CREATED: "Program created",
  ISSUER_WHITELISTED: "Issuer whitelisted",
  ISSUER_REMOVED: "Issuer removed",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [statsNote, setStatsNote] = useState("Loading statistics…");
  const [activity, setActivity] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  // Public data is loaded on mount; private statistics load once a wallet
  // session exists (and again after switching accounts).
  useEffect(() => {
    let alive = true;

    const loadPublic = () => {
      Promise.all([
        api("/activity", { auth: false }).catch(() => ({ activity: [] })),
        api("/health", { auth: false }).catch(() => null),
      ]).then(([a, h]) => {
        if (!alive) return;
        setActivity(a?.activity || []);
        setHealth(h);
      });
    };

    loadPublic();

    if (!user) {
      setStats(null);
      setStatsNote("Connect a wallet to see issuance statistics");
      return () => {
        alive = false;
      };
    }

    setStatsNote("Loading statistics…");
    api("/records/stats")
      .then((s) => {
        if (!alive) return;
        setStats(s);
        setStatsNote(null);
      })
      .catch((e) => alive && setError(e.message));

    return () => {
      alive = false;
    };
  }, [user?.id]);

  const r = stats?.records;
  const u = stats?.users;

  return (
    <>
      <div className="hero">
        <h1>Academic Record Management</h1>
        <p>
          Issue, update, supersede and revoke transcripts and degrees — with on-chain
          anchoring as an integrated verification feature. Verification is a{" "}
          <strong>read-only view call</strong>: zero gas, no wallet required.
        </p>
      </div>

      {error && <StatusBox state="error" title="Could not load statistics">{error}</StatusBox>}

      <div className="grid grid-4" style={{ marginBottom: "1.1rem" }}>
        <StatCard
          icon="🎓"
          label="Active records"
          value={r ? r.active : "—"}
          hint={r ? `${r.total} total · ${r.draft} draft` : statsNote}
        />
        <StatCard
          icon="🧑‍🎓"
          label="Students"
          value={u ? u.students : "—"}
          hint={u ? `${u.total} registered wallets` : statsNote}
        />
        <StatCard
          icon="📜"
          label="Grades posted"
          value={stats ? stats.academics.completedGrades : "—"}
          hint={
            stats
              ? `${stats.academics.courses} courses · ${stats.academics.programs} programs`
              : statsNote
          }
        />
        <StatCard
          icon="🚨"
          label="Revoked / superseded"
          value={r ? `${r.revoked}/${r.superseded}` : "—"}
          hint="Full lifecycle trail retained"
        />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>⛓️ Network status</h3>
          {health ? (
            <table>
              <tbody>
                <tr>
                  <td className="muted">API</td>
                  <td>operational</td>
                </tr>
                <tr>
                  <td className="muted">MySQL</td>
                  <td>{health.database ? "connected" : health.databaseError || "offline"}</td>
                </tr>
                <tr>
                  <td className="muted">RPC endpoint</td>
                  <td className="hash">
                    {health.chain ? `block #${health.blockNumber}` : health.chainError || "offline"}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Contract</td>
                  <td className="hash">
                    {health.contract?.reachable
                      ? health.contract.address
                      : health.contract?.error || "not configured"}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">Loading…</p>
          )}

          <div className="divider" />
          <div className="row">
            <Link className="btn" to="/records">
              Issue a record
            </Link>
            <Link className="btn ghost" to="/verify" style={{ background: "rgba(255,255,255,.06)" }}>
              Public verification
            </Link>
          </div>
        </div>

        <div className="card">
          <h3>🕒 Recent activity</h3>
          {activity.length === 0 ? (
            <div className="empty">No activity yet — issue your first record.</div>
          ) : (
            <ul className="feed">
              {activity.map((log) => (
                <li key={log.id}>
                  <span className="feed-dot" />
                  <div>
                    <div className="feed-body">
                      <strong>{ACTION_LABELS[log.action] || log.action}</strong>
                      {log.target ? <> · <span className="hash">{log.target}</span></> : null}
                      <div className="muted small-text">
                        by {log.performedBy}
                        {log.details ? ` — ${log.details}` : ""}
                      </div>
                    </div>
                    <div className="feed-time">{new Date(log.createdAt).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {user && (
        <p className="muted small-text" style={{ textAlign: "center", marginTop: "1.4rem" }}>
          Signed in as {user.fullName} ({user.role})
        </p>
      )}
    </>
  );
}
