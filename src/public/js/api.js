// API client: single fetch wrapper, token storage, typed errors.

const TOKEN_KEY = 'cra_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code, detail) {
    super(detail || code);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network unreachable. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401) setToken(null); // stale token: force re-auth
    throw new ApiError(res.status, json?.error ?? 'error', json?.detail);
  }
  return json;
}
