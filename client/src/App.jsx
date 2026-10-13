import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { shortAddr, api } from "./api";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import Students from "./pages/Students";
import Verify from "./pages/Verify";
import MyRecords from "./pages/MyRecords";

function WalletButton() {
  const { user, login, logout, error } = useAuth();
  if (user) {
    return (
      <div className="nav-right">
        <span className="badge badge-role">{user.role}</span>
        <span className="hash" title={user.wallet}>
          {shortAddr(user.wallet, 4)}
        </span>
        <button className="ghost small" onClick={logout}>
          Sign out
        </button>
      </div>
    );
  }
  return (
    <div className="nav-right">
      {error && <span className="small-text muted">{error}</span>}
      <button className="small" onClick={login}>
        Connect Wallet
      </button>
    </div>
  );
}

function Guard({ roles, children }) {
  const { user, booting, login } = useAuth();
  if (booting) {
    return (
      <div className="center-screen">
        <div className="card">
          <span className="pulse-indicator" /> Restoring session…
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 460 }}>
          <h3>🔐 Wallet sign-in required</h3>
          <p className="muted">
            This area manages academic records. Sign the message with your wallet to
            prove ownership — no password, no server secret.
          </p>
          <button className="full" onClick={login}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 460 }}>
          <h3>⛔ Access denied</h3>
          <p className="muted">
            Your role is <strong>{user.role}</strong>; this page requires{" "}
            {roles.join(" or ")}.
          </p>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api("/health", { auth: false })
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const chainOk = Boolean(health?.chain && health?.contract?.reachable);

  return (
    <>
      <nav>
        <NavLink to="/" className="logo">
          🎓 Academic Records <span className="tag">WEB3 SIS</span>
        </NavLink>

        <div className="nav-links">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/records">Records</NavLink>
          <NavLink to="/students">Students</NavLink>
          <NavLink to="/me">My Records</NavLink>
          <NavLink to="/verify">Verify</NavLink>
        </div>

        <div className="nav-right">
          <span className="pill-live" title={JSON.stringify(health || {})}>
            <span
              className="pulse-indicator"
              style={{
                background: chainOk ? "var(--success)" : "var(--warn)",
                width: 8,
                height: 8,
              }}
            />
            {chainOk ? "Chain synced" : health?.chain ? "Contract unset" : "Chain offline"}
          </span>
          <WalletButton />
        </div>
      </nav>

      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/records"
            element={
              <Guard roles={["ADMIN", "ISSUER"]}>
                <Records />
              </Guard>
            }
          />
          <Route
            path="/students"
            element={
              <Guard roles={["ADMIN", "ISSUER"]}>
                <Students />
              </Guard>
            }
          />
          <Route
            path="/me"
            element={
              <Guard>
                <MyRecords />
              </Guard>
            }
          />
          {/* Public verification: by landing page or directly via a shared link/QR */}
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:credId" element={<Verify />} />
          <Route
            path="*"
            element={
              <div className="center-screen">
                <div className="card">404 — page not found</div>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}
