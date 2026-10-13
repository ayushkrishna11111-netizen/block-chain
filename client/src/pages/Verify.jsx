import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, shortAddr } from "../api";
import { CopyButton, DropZone, QrCode, StatusBox, verificationUrl } from "../components";
import { sha256Hex } from "../utils/hash";

const ACTIVITY_LABELS = {
  RECORD_ISSUED: "Record issued",
  RECORD_SUPERSEDED: "Record corrected",
  RECORD_REVOKED: "Record revoked",
  RECORD_ANCHORED: "Record anchored",
  GRADE_POSTED: "Grade posted",
};

export default function Verify() {
  const { credId } = useParams(); // /verify/:credId — shared links and QR codes
  const [input, setInput] = useState(credId || "");
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api("/verify", { auth: false })
      .then((d) => setActivity(d.activity || []))
      .catch(() => setActivity([]));
  }, []);

  async function runLookup(id) {
    const target = String(id || "").trim();
    if (!target) {
      setState({ kind: "error", title: "Nothing to verify", body: "Enter a record ID first." });
      return;
    }
    setState({ kind: "loading", title: "Querying the ledger…", body: target });
    setResult(null);
    try {
      const data = await api(`/verify/${encodeURIComponent(target)}`, { auth: false });
      setResult(data);
      setState(null);
    } catch (err) {
      setResult(null);
      setState({
        kind: "error",
        title: "Record not found",
        body: err.message,
      });
    }
  }

  // A shared link / QR code carries the record id in the URL.
  useEffect(() => {
    if (credId) {
      setInput(credId);
      runLookup(credId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credId]);

  async function verifyByFile(file) {
    setState({ kind: "loading", title: "Computing SHA-256 locally…", body: file.name });
    setResult(null);
    try {
      const hash = await sha256Hex(file);
      setInput(hash);
      setState({ kind: "loading", title: "Looking up document hash…", body: hash });
      const data = await api(`/verify/hash/${hash}`, { auth: false });
      setResult(data);
      setState(null);
    } catch (err) {
      setResult(null);
      setState({
        kind: "error",
        title: "Document does not match any issued record",
        body: err.message,
      });
    }
  }

  const chain = result?.chain;
  const onChainFound = Boolean(chain?.found);
  const status = result?.verification?.chain || result?.verification?.database;
  const ok = onChainFound && (status === "Active" || status === "Revoked" || status === "Superseded");
  const isActive = status === "Active";
  const signature = result?.verification?.signature;

  return (
    <>
      <div className="hero">
        <h1>Public Record Verification</h1>
        <p>
          Drop a transcript or enter its record ID. The digest is computed in your browser and
          checked against the smart contract with a <strong>zero-gas eth_call</strong> — no
          wallet, no gas, no account required.
        </p>
      </div>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <h3>🔎 Verify an academic record</h3>

          <div className="form-group">
            <label>Record ID / CRED number / 0x digest</label>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runLookup(input)}
              placeholder="CRED-2026-001"
              className="hash"
            />
          </div>

          <DropZone onFile={verifyByFile} hint="verification by document hash" />

          <button
            className="full"
            style={{ marginTop: "1rem" }}
            onClick={() => runLookup(input)}
            disabled={state?.kind === "loading"}
          >
            {state?.kind === "loading" ? "Querying…" : "Verify on-chain"}
          </button>

          <StatusBox state={state?.kind} title={state?.title}>
            <span className="hash">{state?.body}</span>
          </StatusBox>

          {result && (
            <div className={`status-box ${isActive && ok ? "status-success" : "status-error"}`}>
              <div className="status-title">
                {isActive && ok
                  ? "✅ Authenticated academic record"
                  : status === "Revoked"
                    ? "🚫 Record revoked by the issuing institution"
                    : status === "Superseded"
                      ? "🔄 Record superseded by a corrected version"
                      : "⚠️ Record status could not be confirmed"}
              </div>
              <table style={{ marginTop: "0.4rem" }}>
                <tbody>
                  <tr>
                    <td className="muted">Record ID</td>
                    <td className="hash">{result.credId}</td>
                  </tr>
                  {result.record && (
                    <>
                      <tr>
                        <td className="muted">Student</td>
                        <td>{result.record.studentName}</td>
                      </tr>
                      <tr>
                        <td className="muted">Program</td>
                        <td>{result.record.degree || result.record.program || "—"}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td className="muted">On-chain status</td>
                    <td>
                      <strong>{chain?.found ? status : "not found"}</strong>
                      {result.verification?.consistent === false && (
                        <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                          DB mismatch
                        </span>
                      )}
                      {result.verification?.chainAvailable === false && (
                        <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                          chain unavailable
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Issuer signature</td>
                    <td>
                      {signature?.present ? (
                        <>
                          <span className={`badge ${signature.valid ? "badge-success" : "badge-danger"}`}>
                            {signature.valid ? "valid" : "invalid"}
                          </span>{" "}
                          <span className="hash muted">{shortAddr(signature.signer, 6)}</span>
                          {signature.matchesChainIssuer && (
                            <span className="badge badge-success" style={{ marginLeft: 6 }}>
                              matches on-chain issuer
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">not present (issued before signing)</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Issuing wallet</td>
                    <td className="hash">{chain?.issuer ? shortAddr(chain.issuer, 6) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="muted">Issued</td>
                    <td>{chain?.issuedAt ? new Date(chain.issuedAt).toLocaleString() : "—"}</td>
                  </tr>
                  <tr>
                    <td className="muted">Digest (SHA-256)</td>
                    <td className="hash">{chain?.recordHash ? shortAddr(chain.recordHash, 8) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="muted">IPFS</td>
                    <td className="hash">
                      {chain?.ipfsCID ? (
                        <a
                          href={`https://gateway.pinata.cloud/ipfs/${chain.ipfsCID}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {chain.ipfsCID.slice(0, 14)}…
                        </a>
                      ) : (
                        "not pinned"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Contract</td>
                    <td className="hash">{chain?.contractAddress || "—"}</td>
                  </tr>
                </tbody>
              </table>

              <div className="share-row">
                <span className="share-link">{verificationUrl(result.credId)}</span>
                <CopyButton value={verificationUrl(result.credId)} />
                <QrCode value={verificationUrl(result.credId)} size={92} />
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3>🕒 Public audit trail</h3>
          {activity.length === 0 ? (
            <div className="empty">No public activity yet.</div>
          ) : (
            <ul className="feed">
              {activity.map((log) => (
                <li key={log.id}>
                  <span
                    className="feed-dot"
                    style={
                      log.action.includes("REVOK") || log.action.includes("FAILED")
                        ? { background: "var(--danger)", boxShadow: "0 0 10px var(--danger-glow)" }
                        : undefined
                    }
                  />
                  <div>
                    <div className="feed-body">
                      <strong>{ACTIVITY_LABELS[log.action] || log.action}</strong>
                      {log.target && (
                        <>
                          {" · "}
                          <span className="hash">{log.target}</span>
                        </>
                      )}
                    </div>
                    <div className="feed-time">{new Date(log.createdAt).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="divider" />
          <p className="muted small-text" style={{ margin: 0 }}>
            Records are anchored as a 32-byte SHA-256 digest plus an IPFS CID. The database
            holds the mutable academic data; the chain holds the immutable evidence.
          </p>
        </div>
      </div>
    </>
  );
}
