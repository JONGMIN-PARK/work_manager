// Fetch wrapper with auth token management
var API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export async function apiFetch(url, opts = {}) {
  var token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  var headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  var res = await fetch(API_BASE + url, { ...opts, headers });

  // 401 → try refresh
  if (res.status === 401 && token) {
    var refreshed = await tryRefresh();
    if (refreshed) {
      headers['Authorization'] = 'Bearer ' + localStorage.getItem('accessToken');
      res = await fetch(API_BASE + url, { ...opts, headers });
    }
  }

  if (!res.ok) {
    var err = await res.json().catch(() => ({}));
    var error = new Error(err.message || res.statusText);
    error.status = res.status;
    error.data = err;
    throw error;
  }
  return res.json();
}

async function tryRefresh() {
  var refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;
  try {
    var res = await fetch(API_BASE + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (!res.ok) return false;
    var data = await res.json();
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    return true;
  } catch { return false; }
}
