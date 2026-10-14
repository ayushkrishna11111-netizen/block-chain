import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getToken, setToken } from "./api";
import { ensureLocalChain } from "./wallet";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [error, setError] = useState(null);

  // Restore an existing session on page load.
  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setBooting(false);
      return () => {};
    }
    api("/auth/me")
      .then((me) => alive && setUser(me))
      .catch(() => setToken(null))
      .finally(() => alive && setBooting(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask (or another injected wallet) is required to sign in.");
      return null;
    }
    try {
      const [wallet] = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      // Point MetaMask at this app's chain before signing anything, so any
      // later wallet-signed transaction targets the right node.
      await ensureLocalChain();
      const { message } = await api("/auth/nonce", {
        method: "POST",
        body: { wallet },
        auth: false,
      });
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, wallet],
      });
      const session = await api("/auth/verify", {
        method: "POST",
        body: { wallet, message, signature },
        auth: false,
      });
      setToken(session.token);
      setUser(session.user);
      return session.user;
    } catch (err) {
      setError(err.message || "Wallet sign-in failed");
      return null;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, booting, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
