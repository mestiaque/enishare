// HTTP helpers. The session cookie is HttpOnly; state-changing calls also send the CSRF header.
let csrf = '';
export function setCsrf(token) { csrf = token; }
export const csrfHeader = () => ({ 'X-ENiShare-CSRF': csrf });

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? csrfHeader() : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the PC. Check that both devices are on the same Wi-Fi.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('enishare:unauthorized'));
    throw new ApiError(res.status, data?.error?.code || 'HTTP', data?.error?.message || `Request failed (${res.status})`);
  }
  return data;
}
