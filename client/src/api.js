const TOKEN_KEY = "ars_session_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Thin fetch wrapper for the REST API. Every authenticated call carries the
 * wallet-session token automatically.
 */
export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Authenticated binary fetch (used for encrypted-at-rest document downloads). */
export async function apiBlob(path) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return res.blob();
}

export const shortAddr = (addr, size = 4) =>
  addr ? `${addr.slice(0, 2 + size)}…${addr.slice(-size)}` : "—";

export const statusClass = (status = "") => {
  const s = String(status).toUpperCase();
  if (s === "ACTIVE" || s === "VALID" || s === "CONSISTENT") return "badge-success";
  if (s === "REVOKED" || s === "INVALID" || s === "ERROR") return "badge-danger";
  if (s === "SUPERSEDED") return "badge-warn";
  if (s === "DRAFT") return "badge-info";
  return "badge-muted";
};
