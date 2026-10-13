import { useCallback, useEffect, useMemo, useState } from "react";
import { Interface, id as ethersId, ZeroHash } from "ethers";
import { api, apiBlob, shortAddr, statusClass } from "../api";
import { Badge, CopyButton, DropZone, Field, QrCode, StatusBox, verificationUrl } from "../components";
import { fileToBase64 } from "../utils/hash";

const STATUSES = ["", "ACTIVE", "DRAFT", "REVOKED", "SUPERSEDED"];

// Minimal fragment for browser-side revocation (client signing path).
const STATUS_IFACE = new Interface([
  "function updateRecordStatus(bytes32 _recordId, uint8 _newStatus, bytes32 _replacementId)",
]);

export default function Records() {
  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [capability, setCapability] = useState(null);
  const [shareId, setShareId] = useState(null);

  const [form, setForm] = useState({
    studentId: "",
    term: "Spring-2026",
    programId: "",
    replaces: null,
    file: null,
  });

  const refresh = useCallback(async () => {
    try {
      const query = filter ? `?status=${filter}` : "";
      const data = await api(`/records${query}`);
      setRecords(data);
    } catch (err) {
      setFeedback({ state: "error", title: "Failed to load records", body: err.message });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    api("/users?role=STUDENT")
      .then(setStudents)
      .catch(() => setStudents([]));
    api("/academics/programs")
      .then(setPrograms)
      .catch(() => setPrograms([]));
    api("/chain/capability")
      .then(setCapability)
      .catch(() => setCapability(null));
  }, [refresh]);

  // Browser-side signing is only possible when this wallet is whitelisted on
  // the contract AND an injected wallet exists (MetaMask).
  const clientMode = capability?.mode === "client" && Boolean(window.ethereum);

  const totalGpa = useMemo(
    () =>
      records.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + (r.gpa || 0), 0),
    [records]
  );

  /** MetaMask signs and sends the anchoring transaction prepared by the API. */
  async function sendWithWallet(txRequest) {
    const [from] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from, to: txRequest.to, data: txRequest.data }],
    });
    return { from, txHash };
  }

  async function issueRecord(e) {
    e.preventDefault();
    if (!form.studentId || !form.term) {
      setFeedback({ state: "error", title: "Missing fields", body: "Student and term are required." });
      return;
    }
    setBusy(true);
    setFeedback({
      state: "loading",
      title: form.replaces ? "Publishing corrected transcript…" : "Issuing record…",
      body: clientMode
        ? "Hashing locally-side, then your wallet will sign the transaction."
        : "Hashing, encrypting and anchoring on-chain.",
    });
    try {
      const body = {
        studentId: Number(form.studentId),
        term: form.term,
        programId: form.programId ? Number(form.programId) : undefined,
        replaces: form.replaces || undefined,
      };
      if (form.file) {
        body.pdfBase64 = await fileToBase64(form.file);
        body.fileName = form.file.name;
      }

      let res;
      if (clientMode) {
        // 1) create the record as DRAFT and obtain the unsigned transaction
        body.mode = "client";
        res = await api("/records", { method: "POST", body });
        setFeedback({
          state: "loading",
          title: "Confirm the transaction in your wallet…",
          body: res.record.credId,
        });
        // 2) MetaMask signs and sends it
        const { from, txHash } = await sendWithWallet(res.txRequest);
        // 3) the wallet also signs the credential digest
        const credentialSignature = await window.ethereum.request({
          method: "personal_sign",
          params: [res.credentialMessage, from],
        });
        // 4) the backend verifies the receipt and finalises
        const confirmed = await api(`/records/${res.record.credId}/confirm`, {
          method: "POST",
          body: { txHash, credentialSignature, credentialSigner: from },
        });
        setFeedback({
          state: "success",
          title: form.replaces ? "Corrected record published (wallet-signed)" : "Record issued (wallet-signed)",
          body: (
            <>
              <div>
                <strong>{confirmed.record.credId}</strong> · GPA {confirmed.record.gpa} ·{" "}
                {confirmed.record.totalCredits} credits
              </div>
              <div className="hash">tx: {confirmed.txHash}</div>
              <div className="hash">SHA-256: {confirmed.record.pdfHash}</div>
            </>
          ),
        });
        setForm((f) => ({ ...f, replaces: null, file: null }));
        await refresh();
        return;
      }

      res = await api("/records", { method: "POST", body });

      if (res.chain?.anchored) {
        setFeedback({
          state: "success",
          title: form.replaces ? "Corrected record published" : "Record issued & anchored",
          body: (
            <>
              <div>
                <strong>{res.record.credId}</strong> · GPA {res.record.gpa} ·{" "}
                {res.record.totalCredits} credits
              </div>
              <div className="hash">tx: {res.record.txHash}</div>
              <div className="hash">SHA-256: {res.record.pdfHash}</div>
            </>
          ),
        });
      } else {
        setFeedback({
          state: "error",
          title: "Stored as DRAFT — on-chain anchoring failed",
          body: `${res.chain?.error || "unknown error"} — use the Anchor button to retry once the chain is reachable.`,
        });
      }
      setForm((f) => ({ ...f, replaces: null, file: null }));
      await refresh();
    } catch (err) {
      setFeedback({ state: "error", title: "Issuance failed", body: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(record) {
    const reason = window.prompt(`Reason for revoking ${record.credId}?`, "Transcript corrected");
    if (reason === null) return;
    try {
      let body = { status: "REVOKED", reason };
      if (clientMode) {
        // The wallet signs the revocation; the backend verifies the receipt.
        const data = STATUS_IFACE.encodeFunctionData("updateRecordStatus", [
          ethersId(record.credId),
          1,
          ZeroHash,
        ]);
        const { txHash } = await sendWithWallet({ to: capability.contractAddress, data });
        body = { ...body, txHash };
      }
      await api(`/records/${record.credId}/status`, { method: "POST", body });
      setFeedback({
        state: "success",
        title: `${record.credId} revoked`,
        body: clientMode
          ? "Revocation signed by your wallet and confirmed on-chain."
          : "Status updated in MySQL and on-chain (zero-gas lookups now return Revoked).",
      });
      refresh();
    } catch (err) {
      setFeedback({ state: "error", title: "Revocation failed", body: err.message });
    }
  }

  async function anchor(record) {
    try {
      const res = await api(`/records/${record.credId}/anchor`, { method: "POST" });
      setFeedback({
        state: "success",
        title: `${record.credId} anchored`,
        body: <span className="hash">tx: {res.txHash}</span>,
      });
      refresh();
    } catch (err) {
      setFeedback({ state: "error", title: "Anchor failed", body: err.message });
    }
  }

  async function downloadPdf(record) {
    try {
      const blob = await apiBlob(`/records/${record.credId}/document`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${record.credId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback({ state: "error", title: "Download failed", body: err.message });
    }
  }

  function startCorrection(record) {
    setForm({
      studentId: String(record.studentId),
      term: record.term,
      programId: record.programId ? String(record.programId) : "",
      replaces: record.credId,
      file: null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const shared = records.find((r) => r.credId === shareId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Academic records</h1>
          <p>
            Primary module: issuance, corrections, revocation and transcript lifecycle.
            {totalGpa > 0 && <> · {records.length} records loaded</>}
          </p>
        </div>
        <div className="row">
          {capability && (
            <span
              className={`badge ${clientMode ? "badge-success" : "badge-info"}`}
              title={
                clientMode
                  ? "Your wallet is whitelisted on the contract; transactions are signed in MetaMask."
                  : "The server signer anchors transactions for this wallet."
              }
            >
              {clientMode ? "(wallet signs)" : "server signs"}
            </span>
          )}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 180 }}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shared && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <QrCode value={verificationUrl(shared.credId)} label="Scan to verify" />
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 style={{ marginBottom: "0.3rem" }}>🔗 Share {shared.credId}</h3>
              <p className="muted small-text" style={{ margin: "0 0 0.5rem" }}>
                Anyone with this link (or the QR code) can verify the record on-chain —
                zero gas, no wallet, no account.
              </p>
              <div className="share-row">
                <span className="share-link">{verificationUrl(shared.credId)}</span>
                <CopyButton value={verificationUrl(shared.credId)} />
                {shared.hasDocument && (
                  <button className="ghost small" onClick={() => downloadPdf(shared)}>
                    ⬇ PDF
                  </button>
                )}
                <button className="ghost small" onClick={() => setShareId(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <form className="card" onSubmit={issueRecord}>
          <h3>{form.replaces ? `✏️ Correct ${form.replaces}` : "➕ Issue new record"}</h3>

          <Field label="Student">
            <select
              value={form.studentId}
              onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              required
            >
              <option value="">Select a student…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} — {shortAddr(s.wallet)}
                </option>
              ))}
            </select>
          </Field>

          <div className="form-row">
            <Field label="Term">
              <input
                value={form.term}
                onChange={(e) => setForm({ ...form, term: e.target.value })}
                placeholder="Spring-2026"
                required
              />
            </Field>
            <Field label="Degree program (optional)">
              <select
                value={form.programId}
                onChange={(e) => setForm({ ...form, programId: e.target.value })}
              >
                <option value="">Auto-detect</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.program_code} — {p.degree_title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label>Transcript PDF (optional — stored encrypted, pinned to IPFS)</label>
          <DropZone
            onFile={(file) => setForm((f) => ({ ...f, file }))}
            hint="leave empty to hash the canonical JSON instead"
          />

          <div className="divider" />
          <button className="full" disabled={busy}>
            {busy
              ? "Working…"
              : clientMode
                ? form.replaces
                  ? "Sign correction in wallet"
                  : "Sign & issue in wallet"
                : form.replaces
                  ? "Publish correction"
                  : "Issue & anchor on-chain"}
          </button>

          {form.replaces && (
            <button
              type="button"
              className="ghost full"
              style={{ marginTop: "0.6rem" }}
              onClick={() => setForm((f) => ({ ...f, replaces: null, file: null }))}
            >
              Cancel correction
            </button>
          )}

          <StatusBox state={feedback?.state} title={feedback?.title}>
            {feedback?.body}
          </StatusBox>
        </form>

        <div className="card">
          <h3>🗂️ Record register</h3>
          {loading ? (
            <div className="empty">
              <span className="pulse-indicator" /> Loading records…
            </div>
          ) : records.length === 0 ? (
            <div className="empty">No records match this filter yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Student</th>
                    <th>GPA</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.credId}>
                      <td>
                        <div className="hash">{r.credId}</div>
                        <div className="muted small-text">{r.term}</div>
                      </td>
                      <td>
                        {r.studentName}
                        <div className="muted small-text">{r.programName || "—"}</div>
                      </td>
                      <td>
                        <strong>{r.gpa ?? "—"}</strong>
                        <div className="muted small-text">{r.totalCredits} cr</div>
                      </td>
                      <td>
                        <span className={`badge ${statusClass(r.status)}`}>{r.status}</span>
                        <div className="muted small-text">
                          {r.txHash ? `tx ${shortAddr(r.txHash, 3)}` : "not anchored"}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: "0.35rem" }}>
                          {r.status === "ACTIVE" && (
                            <>
                              <button className="ghost small" onClick={() => setShareId(r.credId)}>
                                QR
                              </button>
                              <button className="ghost small" onClick={() => startCorrection(r)}>
                                Correct
                              </button>
                              <button className="danger small" onClick={() => revoke(r)}>
                                Revoke
                              </button>
                            </>
                          )}
                          {r.status === "DRAFT" && (
                            <button className="small" onClick={() => anchor(r)}>
                              Anchor
                            </button>
                          )}
                          {r.hasDocument && (
                            <button className="ghost small" onClick={() => downloadPdf(r)}>
                              ⬇
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
