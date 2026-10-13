import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { statusClass } from "./api";

/** Drag & drop / click-to-browse file input with live feedback. */
export function DropZone({ onFile, hint = "PDF only", loadedLabel, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState(null);

  const accept = async (picked) => {
    if (!picked) return;
    if (picked.type !== "application/pdf") {
      alert("Please choose a PDF file.");
      return;
    }
    setFile(picked);
    onFile?.(picked);
  };

  return (
    <div
      className={`drop-zone${over ? " drag-over" : ""}${file ? " loaded" : ""}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) accept(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="drop-icon">{file ? "✅" : "📄"}</div>
      <div>
        <strong>{file ? file.name : loadedLabel || "Drag & drop a transcript PDF"}</strong>
        <div className="drop-sub">
          {file
            ? `${(file.size / 1024).toFixed(1)} KB — SHA-256 computed locally in your browser`
            : `or click to browse · ${hint}`}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => accept(e.target.files?.[0])}
      />
    </div>
  );
}

/** Animated status container: loading / success / error / info. */
export function StatusBox({ state, title, children }) {
  if (!state) return null;
  return (
    <div className={`status-box status-${state}`}>
      {state === "loading" && <span className="pulse-indicator" />}
      {title && <div className="status-title">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Badge({ status, children }) {
  return <span className={`badge ${statusClass(status)}`}>{children || status}</span>;
}

export function StatCard({ icon, label, value, hint }) {
  return (
    <div className="card stat">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      {children}
    </div>
  );
}

/**
 * QR code for a shareable verification link (new feature: share + QR lookup).
 * Renders an <img> whose src is a data URL produced entirely in the browser.
 */
export function QrCode({ value, size = 116, label }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!value) {
      setDataUrl(null);
      return () => {};
    }
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: "#0b1020", light: "#ffffff" } })
      .then((url) => alive && setDataUrl(url))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!value) return null;
  if (error) return <span className="muted small-text">QR error: {error}</span>;
  return (
    <div className="qr-box">
      {dataUrl ? (
        <img src={dataUrl} alt={label || `QR code for ${value}`} width={size} height={size} />
      ) : (
        <div className="qr-placeholder" style={{ width: size, height: size }} />
      )}
      {label && <div className="qr-label">{label}</div>}
    </div>
  );
}

/** Copy-to-clipboard button with transient feedback. */
export function CopyButton({ value, label = "Copy link" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          window.prompt("Copy manually:", value);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}

/** The shareable public verification link for a record. */
export function verificationUrl(credId) {
  return `${window.location.origin}/verify/${credId}`;
}
