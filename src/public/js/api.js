// API client: single fetch wrapper, token storage, typed errors.

const TOKEN_KEY = 'cra_token';
const REF_CODE_KEY = 'cra_ref';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

// Capture ?ref=CODE from the URL once so it can be applied at registration.
export function captureReferralFromUrl() {
  try {
    const code = new URLSearchParams(location.search).get('ref');
    if (code) localStorage.setItem(REF_CODE_KEY, code.slice(0, 16));
  } catch { /* private mode etc. */ }
}
export function getStoredReferral() {
  try { return localStorage.getItem(REF_CODE_KEY); } catch { return null; }
}
export function clearStoredReferral() {
  try { localStorage.removeItem(REF_CODE_KEY); } catch { /* noop */ }
}

// ── diamonds balance cache (server is the source of truth) ────────────────
let diamonds = 0;
export function getDiamonds() {
  return diamonds;
}
export function setDiamonds(n) {
  if (Number.isFinite(n) && n >= 0) {
    diamonds = n;
    try { localStorage.setItem('cra_diamonds', String(n)); } catch { /* noop */ }
  }
  return diamonds;
}

export class ApiError extends Error {
  constructor(status, code, detail) {
    super(detail || code);
    this.status = status;
    this.code = code;
  }
}

// Mint an absolute shareable referral link for the current deployment.
export function referralLink(code) {
  if (!code) return '';
  const origin = (location.protocol === 'file:' ? 'https://mind-game.onrender.com' : location.origin);
  return `${origin}/?ref=${encodeURIComponent(code)}`;
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
