import { useCallback, useEffect, useState } from "react";
import { api, apiBlob, shortAddr } from "../api";
import { CopyButton, QrCode, StatusBox, verificationUrl } from "../components";
import { useAuth } from "../auth";

export default function MyRecords() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api("/records");
      setRecords(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(credId) {
    if (open === credId) return setOpen(null);
    try {
      const detail = await api(`/records/${credId}`);
      setOpen({ ...detail });
    } catch (err) {
      setError(err.message);
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJSON(record) {
    downloadBlob(
      new Blob([JSON.stringify(record.transcript, null, 2)], { type: "application/json" }),
      `${record.credId}.json`
    );
  }

  async function downloadPdf(record) {
    try {
      const blob = await apiBlob(`/records/${record.credId}/document`);
      downloadBlob(blob, `${record.credId}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  }

  const active = records.filter((r) => r.status === "ACTIVE");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My academic records</h1>
          <p>
            Welcome{user ? `, ${user.fullName}` : ""} — your complete transcript history,
            degree progress and verification links.
          </p>
        </div>
        {records.length > 0 && (
          <div className="pill-live">
            {active.length} active · {records.length} total
          </div>
        )}
      </div>

      <StatusBox state={error ? "error" : null} title="Could not load records">
        {error}
      </StatusBox>

      {loading ? (
        <div className="empty">
          <span className="pulse-indicator" /> Loading your records…
        </div>
      ) : records.length === 0 ? (
        <div className="empty">
          No records have been issued for your wallet yet. Ask your registrar to issue one
          after your grades are posted.
        </div>
      ) : (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          {records.map((r) => (
            <div className="card" key={r.credId}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="hash" style={{ fontSize: "0.95rem" }}>
                    {r.credId}
                  </div>
                  <div className="muted small-text">
                    {r.programName || "Program not set"} · {r.term}
                  </div>
                </div>
                <span
                  className={`badge ${
                    r.status === "ACTIVE"
                      ? "badge-success"
                      : r.status === "REVOKED"
                        ? "badge-danger"
                        : r.status === "SUPERSEDED"
                          ? "badge-warn"
                          : "badge-info"
                  }`}
                >
                  {r.status}
                </span>
              </div>

              <div className="row" style={{ marginTop: "1rem", gap: "1.4rem" }}>
                <div>
                  <div className="stat-value" style={{ fontSize: "1.6rem" }}>
                    {r.gpa ?? "—"}
                  </div>
                  <div className="stat-label">GPA</div>
                </div>
                <div>
                  <div className="stat-value" style={{ fontSize: "1.6rem" }}>
                    {r.totalCredits}
                  </div>
                  <div className="stat-label">Credits</div>
                </div>
                <div className="spacer" />
                <button className="ghost small" onClick={() => toggle(r.credId)}>
                  {open?.credId === r.credId ? "Hide transcript" : "View transcript"}
                </button>
              </div>

              <div className="divider" />
              <div className="row small-text muted" style={{ justifyContent: "space-between" }}>
                <span className="hash">{shortAddr(r.pdfHash, 8)}</span>
                <span>{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "not issued"}</span>
              </div>

              {open?.credId === r.credId && open.transcript && (
                <div style={{ marginTop: "1rem" }}>
                  <label>Courses on this transcript</label>
                  <div className="transcript-list">
                    {open.transcript.courses?.length ? (
                      open.transcript.courses.map((c, i) => (
                        <div className="course-row" key={`${c.code}-${i}`}>
                          <span>
                            <span className="hash">{c.code}</span> {c.title}
                          </span>
                          <span>
                            {c.grade ?? "—"} · {c.credits} cr
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="muted small-text">No completed courses yet.</div>
                    )}
                  </div>

                  <div className="row" style={{ marginTop: "0.9rem" }}>
                    <button className="ghost small" onClick={() => downloadJSON(open)}>
                      ⬇ Download JSON
                    </button>
                    {open.hasDocument && (
                      <button className="ghost small" onClick={() => downloadPdf(open)}>
                        ⬇ Download PDF
                      </button>
                    )}
                    <CopyButton value={verificationUrl(open.credId)} label="Copy verify link" />
                  </div>

                  <div className="share-row">
                    <QrCode value={verificationUrl(open.credId)} size={104} label="Scan to verify" />
                    <span className="share-link">{verificationUrl(open.credId)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
