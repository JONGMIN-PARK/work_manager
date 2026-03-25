/**
 * auth.js — 프론트엔드 인증 모듈
 * 로그인/가입/세션 관리/관리자 사용자 관리
 */

/* ═══ API 기본 설정 ═══ */

// file:// 프로토콜이면 인증 스킵 (로컬 개발용)
var AUTH_SKIP = location.protocol === 'file:';

// API 베이스 URL — 서버 모드일 때 사용
var API_BASE = (function () {
  if (AUTH_SKIP) return '';
  // 같은 origin에서 서빙되면 빈 문자열
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  return '';
})();

/* ═══ 토큰 저장 ═══ */
var _accessToken = '';
var _refreshToken = localStorage.getItem('wm_refresh') || '';

/* ═══ 현재 사용자 ═══ */
var currentUser = null;

/* ═══ apiFetch — JWT 자동 첨부 + 401 갱신 ═══ */
async function apiFetch(url, opts) {
  if (AUTH_SKIP) return null;
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (_accessToken) {
    opts.headers['Authorization'] = 'Bearer ' + _accessToken;
  }
  if (!opts.headers['Content-Type'] && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
  }

  // 모바일 네트워크 대비 타임아웃 (15초)
  var _abortCtrl = new AbortController();
  var _abortTimer = setTimeout(function () { _abortCtrl.abort(); }, 15000);
  if (!opts.signal) opts.signal = _abortCtrl.signal;

  var maxRetries = ((!opts.method || opts.method === 'GET') ? 2 : 0);
  var lastErr;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      var res = await fetch(API_BASE + url, opts);

      // 5xx → 재시도 (GET만)
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, 500 * (attempt + 1)); });
        continue;
      }

      // 401 → 토큰 갱신 시도
      if (res.status === 401 && _refreshToken) {
        var refreshed = await _tryRefresh();
        if (refreshed) {
          opts.headers['Authorization'] = 'Bearer ' + _accessToken;
          res = await fetch(API_BASE + url, opts);
        } else {
          authLogout();
          return null;
        }
      }

      var data = await res.json();
      clearTimeout(_abortTimer);
      if (!res.ok) {
        var err = new Error(data.message || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      clearTimeout(_abortTimer);
      lastErr = e;
      // 네트워크 오류만 재시도 (4xx 등 응답 에러는 재시도하지 않음)
      if (!e.status && attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, 500 * (attempt + 1)); });
        continue;
      }
      throw e;
    }
  }
}

async function _tryRefresh() {
  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    var res = await fetch(API_BASE + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: _refreshToken }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    var data = await res.json();
    _accessToken = data.data.accessToken;
    _refreshToken = data.data.refreshToken;
    localStorage.setItem('wm_refresh', _refreshToken);
    return true;
  } catch (e) {
    return false;
  }
}

/* ═══ 로그인 ═══ */
async function authLogin(email, password, remember) {
  var res = await fetch(API_BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || '로그인 실패');
  }

  _accessToken = data.data.accessToken;
  _refreshToken = data.data.refreshToken;
  currentUser = data.data.user;

  if (remember) {
    localStorage.setItem('wm_refresh', _refreshToken);
  } else {
    sessionStorage.setItem('wm_refresh_s', _refreshToken);
    localStorage.removeItem('wm_refresh');
  }

  return currentUser;
}

/* ═══ 가입 ═══ */
async function authRegister(email, password, name, position, phone) {
  var res = await fetch(API_BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email,
      password: password,
      name: name,
      position: position || '',
      phone: phone || ''
    })
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || '가입 실패');
  }
  return data;
}

/* ═══ 로그아웃 ═══ */
async function authLogout() {
  try {
    if (_accessToken) {
      await fetch(API_BASE + '/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + _accessToken
        },
        body: JSON.stringify({ refreshToken: _refreshToken })
      });
    }
  } catch (e) { /* ignore */ }

  _accessToken = '';
  _refreshToken = '';
  currentUser = null;
  localStorage.removeItem('wm_refresh');
  sessionStorage.removeItem('wm_refresh_s');
  showLoginOverlay();
}

/* ═══ 내 정보 조회 ═══ */
async function authFetchMe() {
  try {
    var data = await apiFetch('/api/auth/me');
    if (data && data.data) {
      currentUser = data.data;
      return currentUser;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ═══ 앱 초기화 시 세션 복원 ═══ */
async function authInit() {
  if (AUTH_SKIP) {
    // file:// 프로토콜이면 인증 없이 바로 진행
    currentUser = { id: 'local', name: '로컬 사용자', role: 'admin', plProjects: [] };
    return true;
  }

  // Google OAuth2 콜백 처리
  var urlParams = new URLSearchParams(location.search);
  var googleAuth = urlParams.get('googleAuth');
  if (googleAuth) {
    try {
      var tokens = JSON.parse(googleAuth);
      _accessToken = tokens.accessToken;
      _refreshToken = tokens.refreshToken;
      localStorage.setItem('wm_refresh', _refreshToken);
      // URL에서 파라미터 제거
      history.replaceState(null, '', location.pathname);
      var user = await authFetchMe();
      if (user) {
        hideLoginOverlay();
        updateAuthUI();
        if (typeof onAuthReady === 'function') onAuthReady();
        return true;
      }
    } catch (e) { /* ignore parse error */ }
  }

  // Google 가입 대기 안내
  var infoParam = urlParams.get('info');
  if (infoParam === 'google_pending') {
    history.replaceState(null, '', location.pathname);
    showLoginOverlay();
    setTimeout(function () {
      var msg = document.getElementById('loginMsg');
      if (msg) { msg.textContent = 'Google 계정으로 가입 요청이 접수되었습니다. 관리자 승인을 기다려 주세요.'; msg.style.color = '#10B981'; }
    }, 100);
    return false;
  }

  var errorParam = urlParams.get('error');
  if (errorParam) {
    history.replaceState(null, '', location.pathname);
    showLoginOverlay();
    setTimeout(function () {
      var msg = document.getElementById('loginMsg');
      var errMsgs = {
        google_auth_failed: 'Google 인증에 실패했습니다.',
        google_token_failed: 'Google 토큰 발급에 실패했습니다.',
        google_inactive: '비활성화된 계정입니다. 관리자에게 문의하세요.',
        google_server_error: '서버 오류가 발생했습니다.'
      };
      if (msg) { msg.textContent = errMsgs[errorParam] || 'Google 로그인 실패'; msg.style.color = '#EF4444'; }
    }, 100);
    return false;
  }

  // 저장된 refresh token 복원
  _refreshToken = localStorage.getItem('wm_refresh') || sessionStorage.getItem('wm_refresh_s') || '';
  if (!_refreshToken) {
    showLoginOverlay();
    return false;
  }

  // refresh 토큰으로 access 토큰 발급
  var ok = await _tryRefresh();
  if (!ok) {
    showLoginOverlay();
    return false;
  }

  // 사용자 정보 조회
  var user = await authFetchMe();
  if (!user) {
    showLoginOverlay();
    return false;
  }

  hideLoginOverlay();
  updateAuthUI();
  return true;
}

/* ═══ 권한 헬퍼 ═══ */
function isPL(projectId) {
  return currentUser && (currentUser.plProjects || []).indexOf(projectId) >= 0;
}

function can(action, resource) {
  if (AUTH_SKIP) return true;
  if (!currentUser) return false;
  var r = currentUser.role;
  if (r === 'admin') return true;

  var projId = resource ? resource.projectId : null;
  var ownerId = resource ? resource.ownerId : null;
  var pl = projId && isPL(projId);

  var rules = {
    'project.create':  function () { return r === 'manager'; },
    'project.edit':    function () { return r === 'manager' || pl; },
    'project.delete':  function () { return r === 'manager'; },
    'project.assign':  function () { return r === 'manager' || pl; },
    'pl.assign':       function () { return r === 'manager'; },
    'issue.create':    function () { return true; },
    'issue.status':    function () { return r === 'manager' || pl || ownerId === currentUser.id; },
    'issue.delete':    function () { return r === 'manager'; },
    'file.upload':     function () { return true; },
    'file.delete':     function () { return r === 'manager' || pl || ownerId === currentUser.id; },
    'user.manage':     function () { return false; }
  };

  var check = rules[action];
  if (!check) return false;
  if (r === 'executive') return action.indexOf('.read') >= 0 || action.indexOf('.view') >= 0;
  return check();
}

/* ═══ 로그인 오버레이 UI ═══ */
function showLoginOverlay() {
  var el = document.getElementById('loginOverlay');
  if (!el) return;
  el.style.display = 'flex';
  el.innerHTML = buildLoginHTML();
}

function hideLoginOverlay() {
  var el = document.getElementById('loginOverlay');
  if (!el) return;
  el.style.display = 'none';
}

function buildLoginHTML() {
  return '<div style="background:var(--card,#1a1a2e);border-radius:16px;padding:40px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5);color:var(--text,#e0e0e0)">' +
    '<h2 style="margin:0 0 8px;text-align:center;font-size:22px">업무 관리자</h2>' +
    '<p id="loginMsg" style="text-align:center;font-size:13px;color:var(--sub,#888);margin:0 0 24px">로그인하여 시작하세요</p>' +
    '<div id="loginForm">' +
      '<input id="loginEmail" type="email" placeholder="이메일" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="loginPw" type="password" placeholder="비밀번호" style="width:100%;padding:10px 12px;margin-bottom:12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:16px;cursor:pointer"><input id="loginRemember" type="checkbox" checked> 로그인 유지</label>' +
      '<button onclick="handleLogin()" style="width:100%;padding:12px;border:none;border-radius:8px;background:#3B82F6;color:#fff;font-size:15px;font-weight:600;cursor:pointer">로그인</button>' +
      '<div style="display:flex;align-items:center;gap:8px;margin:16px 0 12px"><hr style="flex:1;border:none;border-top:1px solid var(--border,#333)"><span style="font-size:12px;color:var(--sub,#888)">또는</span><hr style="flex:1;border:none;border-top:1px solid var(--border,#333)"></div>' +
      '<button onclick="googleLogin()" style="width:100%;padding:10px;border:1px solid var(--border,#333);border-radius:8px;background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
        'Google로 로그인</button>' +
      '<p style="text-align:center;margin:16px 0 0;font-size:13px"><a href="javascript:void(0)" onclick="showRegisterForm()" style="color:#3B82F6;text-decoration:none">가입 요청</a></p>' +
    '</div>' +
    '<div id="registerForm" style="display:none">' +
      '<input id="regEmail" type="email" placeholder="이메일" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="regName" type="text" placeholder="이름 (실명)" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="regPw" type="password" placeholder="비밀번호 (8자 이상, 2종 조합)" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="regPw2" type="password" placeholder="비밀번호 확인" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="regPosition" type="text" placeholder="직급 (선택)" style="width:100%;padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<input id="regPhone" type="tel" placeholder="연락처 (선택)" style="width:100%;padding:10px 12px;margin-bottom:16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px;box-sizing:border-box">' +
      '<button onclick="handleRegister()" style="width:100%;padding:12px;border:none;border-radius:8px;background:#10B981;color:#fff;font-size:15px;font-weight:600;cursor:pointer">가입 요청</button>' +
      '<p style="text-align:center;margin:16px 0 0;font-size:13px"><a href="javascript:void(0)" onclick="showLoginForm()" style="color:#3B82F6;text-decoration:none">로그인으로 돌아가기</a></p>' +
    '</div>' +
  '</div>';
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('loginMsg').textContent = '가입 요청 — 관리자 승인 후 로그인 가능';
}

function showLoginForm() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginMsg').textContent = '로그인하여 시작하세요';
}

async function handleLogin() {
  var email = document.getElementById('loginEmail').value.trim();
  var pw = document.getElementById('loginPw').value;
  var remember = document.getElementById('loginRemember').checked;
  var msg = document.getElementById('loginMsg');

  if (!email || !pw) {
    msg.textContent = '이메일과 비밀번호를 입력하세요.';
    msg.style.color = '#EF4444';
    return;
  }

  try {
    msg.textContent = '로그인 중...';
    msg.style.color = 'var(--sub,#888)';
    await authLogin(email, pw, remember);
    hideLoginOverlay();
    updateAuthUI();
    if (typeof onAuthReady === 'function') onAuthReady();
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = '#EF4444';
  }
}

async function handleRegister() {
  var email = document.getElementById('regEmail').value.trim();
  var name = document.getElementById('regName').value.trim();
  var pw = document.getElementById('regPw').value;
  var pw2 = document.getElementById('regPw2').value;
  var position = document.getElementById('regPosition').value.trim();
  var phone = document.getElementById('regPhone').value.trim();
  var msg = document.getElementById('loginMsg');

  if (!email || !name || !pw) {
    msg.textContent = '이메일, 이름, 비밀번호는 필수입니다.';
    msg.style.color = '#EF4444';
    return;
  }
  if (pw !== pw2) {
    msg.textContent = '비밀번호가 일치하지 않습니다.';
    msg.style.color = '#EF4444';
    return;
  }

  try {
    msg.textContent = '요청 중...';
    msg.style.color = 'var(--sub,#888)';
    await authRegister(email, pw, name, position, phone);
    msg.textContent = '가입 요청 완료! 관리자 승인을 기다려 주세요.';
    msg.style.color = '#10B981';
    setTimeout(showLoginForm, 3000);
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = '#EF4444';
  }
}

function googleLogin() {
  location.href = API_BASE + '/api/auth/google';
}

// Enter 키 로그인
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    var overlay = document.getElementById('loginOverlay');
    if (overlay && overlay.style.display !== 'none') {
      var loginForm = document.getElementById('loginForm');
      if (loginForm && loginForm.style.display !== 'none') {
        handleLogin();
      }
    }
  }
});

/* ═══ 헤더 사용자 정보 표시 ═══ */
function updateAuthUI() {
  if (AUTH_SKIP || !currentUser) return;

  // 헤더 우측에 사용자 정보 표시
  var roleLabels = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
  var roleLabel = roleLabels[currentUser.role] || currentUser.role;
  var userName = currentUser.display_name || currentUser.name || '';

  var el = document.getElementById('authUserInfo');
  if (el) {
    el.innerHTML = '<span style="font-size:13px;opacity:.8">' + userName + ' · ' + roleLabel + '</span>' +
      ' <button onclick="showProfileModal()" title="내 프로필" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text,#e0e0e0);padding:4px">&#x1F464;</button>' +
      ' <button onclick="authLogout()" title="로그아웃" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text,#e0e0e0);padding:4px">&#x1F6AA;</button>';
  }

  // 관리자 전용 탭 표시/숨김
  var adminTab = document.getElementById('tabUserAdmin');
  if (adminTab) {
    adminTab.style.display = currentUser.role === 'admin' ? '' : 'none';
  }
  // 관리자 전용 애니웍스 버튼 표시/숨김
  var isAdmin = currentUser.role === 'admin';
  var awBtns = document.querySelectorAll('.awAdminBtn');
  for (var i = 0; i < awBtns.length; i++) {
    awBtns[i].style.display = isAdmin ? '' : 'none';
  }
}

/* ═══ 관리자: 사용자 관리 탭 ═══ */
async function renderUserAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return;

  var container = document.getElementById('mUserAdmin');
  if (!container) return;

  container.innerHTML = '<div style="padding:20px"><p style="color:var(--sub,#888)">사용자 목록 로딩 중...</p></div>';

  try {
    var pendingRes = await apiFetch('/api/users/pending');
    var usersRes = await apiFetch('/api/users');
    var deptRes = await apiFetch('/api/users/departments');

    var pending = (pendingRes && pendingRes.data) || [];
    var users = (usersRes && usersRes.data) || [];
    var depts = (deptRes && deptRes.data) || [];

    var active = users.filter(function (u) { return u.status === 'active'; });
    var inactive = users.filter(function (u) { return u.status === 'inactive'; });

    var html = '<div style="padding:16px">';
    html += '<h3 style="margin:0 0 16px;font-size:18px">사용자 관리</h3>';

    // 탭
    html += '<div style="display:flex;gap:8px;margin-bottom:16px">';
    html += '<button class="uaTab" data-tab="pending" onclick="switchUserTab(\'pending\')" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--accent,#3B82F6);color:#fff;cursor:pointer;font-size:13px">가입 대기 (' + pending.length + ')</button>';
    html += '<button class="uaTab" data-tab="active" onclick="switchUserTab(\'active\')" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--card,#1a1a2e);color:var(--text,#e0e0e0);cursor:pointer;font-size:13px">활성 (' + active.length + ')</button>';
    html += '<button class="uaTab" data-tab="inactive" onclick="switchUserTab(\'inactive\')" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--card,#1a1a2e);color:var(--text,#e0e0e0);cursor:pointer;font-size:13px">비활성 (' + inactive.length + ')</button>';
    html += '</div>';

    // 가입 대기 목록
    html += '<div id="uaTabPending">';
    if (pending.length === 0) {
      html += '<p style="color:var(--sub,#888);font-size:13px">대기 중인 가입 요청이 없습니다.</p>';
    } else {
      pending.forEach(function (u) {
        html += '<div style="background:var(--card,#1a1a2e);border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid var(--border,#333)">';
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:6px">' + eH(u.name) + ' &lt;' + eH(u.email) + '&gt;</div>';
        html += '<div style="font-size:12px;color:var(--sub,#888);margin-bottom:12px">직급: ' + eH(u.position || '-') + ' · 연락처: ' + eH(u.phone || '-') + ' · 신청: ' + (u.created_at || '').slice(0, 10) + '</div>';
        html += '<div style="display:flex;gap:8px;align-items:center">';
        html += '<select id="approveRole_' + u.id + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">';
        html += '<option value="member">팀원</option><option value="manager">팀장</option><option value="executive">임원</option><option value="admin">관리자</option>';
        html += '</select>';
        html += '<select id="approveDept_' + u.id + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">';
        html += '<option value="">부서 없음</option>';
        depts.forEach(function (d) { html += '<option value="' + d.id + '">' + eH(d.name) + '</option>'; });
        html += '</select>';
        html += '<button onclick="approveUser(\'' + u.id + '\')" style="padding:6px 16px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:13px">승인</button>';
        html += '<button onclick="rejectUser(\'' + u.id + '\')" style="padding:6px 16px;border:none;border-radius:6px;background:#EF4444;color:#fff;cursor:pointer;font-size:13px">거절</button>';
        html += '</div></div>';
      });
    }
    html += '</div>';

    // 활성 사용자 목록
    html += '<div id="uaTabActive" style="display:none">';
    html += renderUserTable(active, depts, true);
    html += '</div>';

    // 비활성 사용자 목록
    html += '<div id="uaTabInactive" style="display:none">';
    html += renderUserTable(inactive, depts, false);
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    // 조직 관리 섹션 추가 (admin only)
    renderOrgManagement();
    // 감사 로그 섹션 추가
    renderAuditLog();
  } catch (e) {
    container.innerHTML = '<div style="padding:20px;color:#EF4444">사용자 목록 로드 실패: ' + eH(e.message) + '</div>';
  }
}

function renderUserTable(users, depts, isActive) {
  if (users.length === 0) {
    return '<p style="color:var(--sub,#888);font-size:13px">사용자가 없습니다.</p>';
  }
  var roleLabels = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
  var deptMap = {};
  depts.forEach(function (d) { deptMap[d.id] = d.name; });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<tr style="border-bottom:1px solid var(--border,#333);color:var(--sub,#888)">';
  html += '<th style="padding:8px;text-align:left">이름</th><th style="padding:8px;text-align:left">이메일</th><th style="padding:8px">역할</th><th style="padding:8px">부서</th><th style="padding:8px">최근 로그인</th><th style="padding:8px">작업</th></tr>';

  users.forEach(function (u) {
    html += '<tr style="border-bottom:1px solid var(--border,#333)">';
    html += '<td style="padding:8px">' + eH(u.name) + '</td>';
    html += '<td style="padding:8px;color:var(--sub,#888)">' + eH(u.email) + '</td>';
    html += '<td style="padding:8px;text-align:center">' + (roleLabels[u.role] || u.role) + '</td>';
    html += '<td style="padding:8px;text-align:center">' + eH(deptMap[u.department_id] || '-') + '</td>';
    html += '<td style="padding:8px;text-align:center;color:var(--sub,#888)">' + (u.last_login_at ? u.last_login_at.slice(0, 10) : '-') + '</td>';
    html += '<td style="padding:8px;text-align:center">';
    if (isActive) {
      html += '<button onclick="changeUserRole(\'' + u.id + '\',\'' + u.role + '\')" title="역할 변경" style="background:none;border:none;cursor:pointer;font-size:14px">&#x270F;&#xFE0F;</button> ';
      html += '<button onclick="toggleUserStatus(\'' + u.id + '\',\'inactive\')" title="비활성화" style="background:none;border:none;cursor:pointer;font-size:14px">&#x1F6AB;</button> ';
      html += '<button onclick="resetUserPw(\'' + u.id + '\')" title="비밀번호 초기화" style="background:none;border:none;cursor:pointer;font-size:14px">&#x1F511;</button>';
    } else {
      html += '<button onclick="toggleUserStatus(\'' + u.id + '\',\'active\')" title="재활성화" style="background:none;border:none;cursor:pointer;font-size:14px">&#x2705;</button>';
    }
    html += '</td></tr>';
  });

  html += '</table>';
  return html;
}

function switchUserTab(tab) {
  var tabs = ['pending', 'active', 'inactive'];
  tabs.forEach(function (t) {
    var panel = document.getElementById('uaTab' + t.charAt(0).toUpperCase() + t.slice(1));
    var btn = document.querySelector('.uaTab[data-tab="' + t + '"]');
    if (panel) panel.style.display = t === tab ? '' : 'none';
    if (btn) btn.style.background = t === tab ? 'var(--accent,#3B82F6)' : 'var(--card,#1a1a2e)';
    if (btn) btn.style.color = t === tab ? '#fff' : 'var(--text,#e0e0e0)';
  });
}

async function approveUser(userId) {
  var roleEl = document.getElementById('approveRole_' + userId);
  var deptEl = document.getElementById('approveDept_' + userId);
  var role = roleEl ? roleEl.value : 'member';
  var dept = deptEl ? deptEl.value : '';

  try {
    await apiFetch('/api/users/' + userId + '/approve', {
      method: 'PUT',
      body: JSON.stringify({ role: role, departmentId: dept || null })
    });
    if (typeof showToast === 'function') showToast('사용자 승인 완료');
    renderUserAdmin();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function rejectUser(userId) {
  var reason = prompt('거절 사유를 입력하세요 (선택):');
  if (reason === null) return;

  try {
    await apiFetch('/api/users/' + userId + '/reject', {
      method: 'PUT',
      body: JSON.stringify({ reason: reason })
    });
    if (typeof showToast === 'function') showToast('가입 거절 처리됨');
    renderUserAdmin();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function changeUserRole(userId, currentRole) {
  var roles = ['member', 'manager', 'executive', 'admin'];
  var labels = { member: '팀원', manager: '팀장', executive: '임원', admin: '관리자' };
  var newRole = prompt('새 역할을 입력하세요 (member/manager/executive/admin):\n현재: ' + labels[currentRole], currentRole);
  if (!newRole || newRole === currentRole) return;
  if (roles.indexOf(newRole) < 0) {
    if (typeof showToast === 'function') showToast('유효하지 않은 역할입니다.', 'error');
    return;
  }

  try {
    await apiFetch('/api/users/' + userId + '/role', {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    if (typeof showToast === 'function') showToast('역할 변경 완료');
    renderUserAdmin();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function toggleUserStatus(userId, newStatus) {
  var msg = newStatus === 'inactive' ? '이 사용자를 비활성화하시겠습니까?' : '이 사용자를 재활성화하시겠습니까?';
  if (!confirm(msg)) return;

  try {
    await apiFetch('/api/users/' + userId + '/status', {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    if (typeof showToast === 'function') showToast('상태 변경 완료');
    renderUserAdmin();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function resetUserPw(userId) {
  if (!confirm('이 사용자의 비밀번호를 초기화하시겠습니까?')) return;

  try {
    var data = await apiFetch('/api/users/' + userId + '/reset-password', { method: 'POST' });
    var tempPw = data && data.data ? data.data.temporaryPassword : '(확인 불가)';
    alert('임시 비밀번호: ' + tempPw + '\n\n이 비밀번호를 사용자에게 전달하세요.');
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

/* ═══ 프로필 편집 ═══ */
async function showProfileModal() {
  if (AUTH_SKIP || !currentUser) return;

  try {
    var data = await apiFetch('/api/profile');
    var p = data.data;
  } catch (e) {
    if (typeof showToast === 'function') showToast('프로필 로드 실패', 'error');
    return;
  }

  var roleLabels = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };

  var div = document.createElement('div');
  div.innerHTML =
    '<div style="display:grid;grid-template-columns:100px 1fr;gap:12px 16px;align-items:center;font-size:13px">' +
      '<span style="color:var(--sub,#888)">이메일</span><span>' + eH(p.email) + '</span>' +
      '<span style="color:var(--sub,#888)">역할</span><span>' + eH(roleLabels[p.role] || p.role) + '</span>' +
      '<span style="color:var(--sub,#888)">부서</span><span>' + eH(p.department_name || '-') + '</span>' +
      '<label style="color:var(--sub,#888)">이름</label><input id="profName" value="' + eH(p.name || '') + '" style="padding:8px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
      '<label style="color:var(--sub,#888)">표시명</label><input id="profDisplay" value="' + eH(p.display_name || '') + '" placeholder="별칭 (선택)" style="padding:8px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
      '<label style="color:var(--sub,#888)">직급</label><input id="profPosition" value="' + eH(p.position || '') + '" style="padding:8px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
      '<label style="color:var(--sub,#888)">연락처</label><input id="profPhone" value="' + eH(p.phone || '') + '" style="padding:8px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
    '</div>' +
    // ─── 텔레그램 연동 섹션 ───
    '<div id="profTelegram" style="margin-top:20px;padding:16px;border-radius:10px;background:var(--bg,#0c0f1a);border:1px solid var(--border,#333)">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<span style="font-size:18px">&#x2708;&#xFE0F;</span>' +
        '<span style="font-size:13px;font-weight:600;color:var(--text,#e0e0e0)">텔레그램 알림</span>' +
        '<span id="tgStatus" style="font-size:11px;padding:2px 8px;border-radius:10px;margin-left:auto"></span>' +
      '</div>' +
      '<div id="tgContent" style="text-align:center;font-size:12px;color:var(--sub,#888)">로딩 중...</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">' +
      '<button id="profSave" style="padding:8px 20px;border:none;border-radius:8px;background:#3B82F6;color:#fff;cursor:pointer;font-size:13px">저장</button>' +
      '<button id="profChangePw" style="padding:8px 20px;border:none;border-radius:8px;background:#F59E0B;color:#fff;cursor:pointer;font-size:13px">비밀번호 변경</button>' +
      '<button id="profCancel" style="padding:8px 20px;border:none;border-radius:8px;background:var(--card,#1a1a2e);border:1px solid var(--border,#333);color:var(--text,#e0e0e0);cursor:pointer;font-size:13px">닫기</button>' +
    '</div>';

  var modal = (typeof createModal === 'function')
    ? createModal({ title: '내 프로필', content: div, width: '480px' })
    : null;

  if (!modal) {
    // createModal 없으면 간이 오버레이
    var overlay = document.createElement('div');
    overlay.id = 'profileOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    var card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#1a1a2e);border-radius:16px;padding:32px;max-width:480px;width:90vw';
    card.innerHTML = '<h3 style="margin:0 0 16px">내 프로필</h3>';
    card.appendChild(div);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    modal = { close: function () { overlay.remove(); } };
  }

  div.querySelector('#profSave').onclick = async function () {
    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('profName').value.trim(),
          displayName: document.getElementById('profDisplay').value.trim(),
          position: document.getElementById('profPosition').value.trim(),
          phone: document.getElementById('profPhone').value.trim()
        })
      });
      await authFetchMe();
      updateAuthUI();
      if (typeof showToast === 'function') showToast('프로필이 수정되었습니다.');
      modal.close();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  };

  div.querySelector('#profChangePw').onclick = function () {
    modal.close();
    showChangePasswordModal();
  };

  div.querySelector('#profCancel').onclick = function () { modal.close(); };

  // ─── 텔레그램 연동 상태 로드 ───
  loadTelegramStatus(div);
}

/** 텔레그램 연동 상태 확인 및 UI 렌더링 */
async function loadTelegramStatus(container) {
  var statusEl = container.querySelector('#tgStatus');
  var contentEl = container.querySelector('#tgContent');
  if (!statusEl || !contentEl) return;

  // 로컬 파일 모드 → 텔레그램 섹션 숨김
  if (AUTH_SKIP) {
    container.querySelector('#profTelegram').style.display = 'none';
    return;
  }

  try {
    var data = await apiFetch('/api/telegram/status');
    if (!data || !data.data) throw new Error('no data');
    var s = data.data;

    if (!s.configured) {
      // 서버에 텔레그램 봇 토큰 미설정
      statusEl.textContent = '미설정';
      statusEl.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;margin-left:auto;background:#374151;color:#9CA3AF';
      contentEl.innerHTML = '<span style="font-size:12px;color:var(--sub,#888)">텔레그램 봇이 아직 설정되지 않았습니다.<br>관리자에게 TELEGRAM_BOT_TOKEN 환경변수 설정을 요청하세요.</span>';
      return;
    }

    if (s.linked && s.isActive) {
      // 연동 완료 상태
      statusEl.textContent = '연동됨';
      statusEl.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;margin-left:auto;background:#065F46;color:#6EE7B7';

      contentEl.innerHTML =
        '<div style="text-align:left">' +
          '<div style="font-size:12px;color:var(--text,#e0e0e0);margin-bottom:8px">' +
            (s.username ? '@' + s.username + ' ' : '') + '연동됨' +
            '<span style="font-size:10px;color:var(--sub,#888);margin-left:8px">' + new Date(s.linkedAt).toLocaleDateString('ko') + '</span>' +
          '</div>' +
          '<div id="tgPrefsArea" style="margin-bottom:12px"></div>' +
          '<button id="tgUnlinkBtn" style="padding:6px 14px;border:none;border-radius:6px;background:#7F1D1D;color:#FCA5A5;cursor:pointer;font-size:11px">연동 해제</button>' +
        '</div>';

      // 알림 설정 로드
      loadTelegramPrefs(container);

      contentEl.querySelector('#tgUnlinkBtn').onclick = async function () {
        if (!confirm('텔레그램 연동을 해제하시겠습니까?')) return;
        try {
          await apiFetch('/api/telegram/unlink', { method: 'DELETE' });
          if (typeof showToast === 'function') showToast('텔레그램 연동이 해제되었습니다.');
          loadTelegramStatus(container);
        } catch (e) {
          if (typeof showToast === 'function') showToast(e.message, 'error');
        }
      };
    } else {
      // 미연동 상태 → QR코드 발급
      statusEl.textContent = '미연동';
      statusEl.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;margin-left:auto;background:#78350F;color:#FDE68A';

      contentEl.innerHTML =
        '<p style="font-size:12px;color:var(--sub,#888);margin-bottom:12px">QR코드를 스캔하여 텔레그램 봇과 연동하세요 (1회)</p>' +
        '<button id="tgGenQR" style="padding:8px 20px;border:none;border-radius:8px;background:#0088CC;color:#fff;cursor:pointer;font-size:12px">QR코드 생성</button>' +
        '<div id="tgQRArea" style="margin-top:12px"></div>';

      contentEl.querySelector('#tgGenQR').onclick = function () {
        generateTelegramQR(container);
      };
    }
  } catch (e) {
    // 서버 미지원 또는 에러
    contentEl.innerHTML = '<span style="font-size:11px;color:var(--sub,#888)">텔레그램 연동 서비스를 사용할 수 없습니다.</span>';
    statusEl.textContent = '';
  }
}

/** QR코드 생성 */
async function generateTelegramQR(container) {
  var qrArea = container.querySelector('#tgQRArea');
  var genBtn = container.querySelector('#tgGenQR');
  if (!qrArea) return;

  genBtn.disabled = true;
  genBtn.textContent = '생성 중...';

  try {
    var data = await apiFetch('/api/telegram/auth-code', { method: 'POST' });
    var info = data.data;

    if (!info.deepLink) {
      qrArea.innerHTML = '<p style="color:#EF4444;font-size:12px">봇이 설정되지 않았습니다. 관리자에게 문의하세요.</p>';
      genBtn.disabled = false;
      genBtn.textContent = 'QR코드 생성';
      return;
    }

    qrArea.innerHTML =
      '<div id="tgQRCode" style="display:inline-block;padding:12px;background:#fff;border-radius:8px;margin-bottom:10px"></div>' +
      '<div style="font-size:11px;color:var(--sub,#888);margin-top:8px">' +
        '<div>인증코드: <b style="color:var(--text,#e0e0e0);font-family:monospace;letter-spacing:2px">' + info.code + '</b></div>' +
        '<div style="margin-top:4px">유효시간: 5분</div>' +
      '</div>' +
      '<div style="margin-top:8px">' +
        '<a href="' + info.deepLink + '" target="_blank" style="font-size:11px;color:#0088CC;text-decoration:underline">텔레그램에서 열기</a>' +
      '</div>';

    // QR코드 렌더링
    var qrEl = qrArea.querySelector('#tgQRCode');
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrEl, {
        text: info.deepLink,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // QRCode 라이브러리 미로드 시 링크만 표시
      qrEl.innerHTML = '<p style="color:#000;font-size:11px;padding:20px">QR 라이브러리 로드 실패<br>위 링크를 직접 클릭하세요</p>';
    }

    genBtn.textContent = '새 코드 생성';
    genBtn.disabled = false;

    // 5분 후 만료 표시
    setTimeout(function () {
      if (qrArea && qrArea.parentNode) {
        qrArea.innerHTML = '<p style="color:#F59E0B;font-size:12px">인증코드가 만료되었습니다. 새 코드를 생성해주세요.</p>';
      }
    }, 300000);

  } catch (e) {
    qrArea.innerHTML = '<p style="color:#EF4444;font-size:12px">' + (e.message || 'QR코드 생성 실패') + '</p>';
    genBtn.disabled = false;
    genBtn.textContent = 'QR코드 생성';
  }
}

/** 알림 설정 토글 로드 */
async function loadTelegramPrefs(container) {
  var prefsArea = container.querySelector('#tgPrefsArea');
  if (!prefsArea) return;

  var eventLabels = {
    issue_assigned: '이슈 배정',
    issue_status_changed: '이슈 상태 변경',
    project_delayed: '프로젝트 지연',
    deadline_d3: '납기 D-3 리마인더',
    deadline_d1: '납기 D-1 리마인더',
    deadline_today: '납기 D-day',
    user_pending: '가입 승인 요청',
    milestone_complete: '마일스톤 완료'
  };

  try {
    var data = await apiFetch('/api/telegram/prefs');
    var prefs = data.data || {};

    var html = '<div style="font-size:11px;color:var(--sub,#888);margin-bottom:6px">알림 설정</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">';
    Object.keys(eventLabels).forEach(function (evt) {
      var checked = prefs[evt] !== false; // 기본값 true
      html += '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text,#e0e0e0);padding:3px 0;cursor:pointer">' +
        '<input type="checkbox" data-evt="' + evt + '" ' + (checked ? 'checked' : '') +
        ' style="width:14px;height:14px;accent-color:#0088CC;cursor:pointer">' +
        eventLabels[evt] + '</label>';
    });
    html += '</div>';
    prefsArea.innerHTML = html;

    // 토글 이벤트
    prefsArea.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.onchange = async function () {
        try {
          await apiFetch('/api/telegram/prefs', {
            method: 'PUT',
            body: JSON.stringify({ event_type: cb.dataset.evt, is_enabled: cb.checked })
          });
        } catch (e) {
          cb.checked = !cb.checked; // 실패 시 롤백
          if (typeof showToast === 'function') showToast('설정 변경 실패', 'error');
        }
      };
    });
  } catch (e) {
    prefsArea.innerHTML = '<span style="font-size:11px;color:var(--sub,#888)">알림 설정을 불러올 수 없습니다.</span>';
  }
}

function showChangePasswordModal() {
  var div = document.createElement('div');
  div.innerHTML =
    '<div style="display:grid;gap:12px;font-size:13px">' +
      '<input id="cpCurrent" type="password" placeholder="현재 비밀번호" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
      '<input id="cpNew" type="password" placeholder="새 비밀번호 (8자 이상, 2종 조합)" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
      '<input id="cpNew2" type="password" placeholder="새 비밀번호 확인" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
      '<p id="cpMsg" style="font-size:12px;color:var(--sub,#888);margin:0"></p>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
      '<button id="cpSave" style="padding:8px 20px;border:none;border-radius:8px;background:#3B82F6;color:#fff;cursor:pointer;font-size:13px">변경</button>' +
      '<button id="cpCancel" style="padding:8px 20px;border:none;border-radius:8px;background:var(--card,#1a1a2e);border:1px solid var(--border,#333);color:var(--text,#e0e0e0);cursor:pointer;font-size:13px">취소</button>' +
    '</div>';

  var modal = (typeof createModal === 'function')
    ? createModal({ title: '비밀번호 변경', content: div, width: '400px' })
    : null;

  if (!modal) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    var card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#1a1a2e);border-radius:16px;padding:32px;max-width:400px;width:90vw';
    card.innerHTML = '<h3 style="margin:0 0 16px">비밀번호 변경</h3>';
    card.appendChild(div);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    modal = { close: function () { overlay.remove(); } };
  }

  div.querySelector('#cpSave').onclick = async function () {
    var cur = document.getElementById('cpCurrent').value;
    var nw = document.getElementById('cpNew').value;
    var nw2 = document.getElementById('cpNew2').value;
    var msg = document.getElementById('cpMsg');

    if (!cur || !nw) { msg.textContent = '모든 항목을 입력하세요.'; msg.style.color = '#EF4444'; return; }
    if (nw !== nw2) { msg.textContent = '새 비밀번호가 일치하지 않습니다.'; msg.style.color = '#EF4444'; return; }

    try {
      msg.textContent = '변경 중...'; msg.style.color = 'var(--sub,#888)';
      await apiFetch('/api/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: cur, newPassword: nw })
      });
      if (typeof showToast === 'function') showToast('비밀번호가 변경되었습니다. 다시 로그인하세요.');
      modal.close();
      authLogout();
    } catch (e) {
      msg.textContent = e.message; msg.style.color = '#EF4444';
    }
  };

  div.querySelector('#cpCancel').onclick = function () { modal.close(); };
}

/* ═══ 조직(부서) 관리 UI ═══ */
async function renderOrgManagement() {
  if (!currentUser || currentUser.role !== 'admin') return;

  var container = document.getElementById('mUserAdmin');
  if (!container) return;

  try {
    var deptRes = await apiFetch('/api/departments');
    var depts = (deptRes && deptRes.data) || [];
  } catch (e) {
    if (typeof showToast === 'function') showToast('부서 로드 실패', 'error');
    return;
  }

  var div = document.createElement('div');
  div.innerHTML =
    '<div style="background:var(--card,#1a1a2e);border-radius:12px;padding:16px;margin-top:16px;border:1px solid var(--border,#333)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<h4 style="margin:0;font-size:15px">조직 관리</h4>' +
        '<button id="btnAddDept" style="padding:6px 14px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:12px">+ 부서 추가</button>' +
      '</div>' +
      '<div id="orgDeptList"></div>' +
    '</div>';

  // 기존 조직 관리 영역이 있으면 교체, 없으면 추가
  var existing = container.querySelector('#orgSection');
  if (existing) {
    existing.replaceWith(div);
  } else {
    div.id = 'orgSection';
    container.appendChild(div);
  }

  renderDeptList(depts);

  div.querySelector('#btnAddDept').onclick = function () {
    showDeptForm(null, depts);
  };
}

function renderDeptList(depts) {
  var list = document.getElementById('orgDeptList');
  if (!list) return;

  if (depts.length === 0) {
    list.innerHTML = '<p style="color:var(--sub,#888);font-size:13px">등록된 부서가 없습니다.</p>';
    return;
  }

  // 트리 형태로 렌더링
  var rootDepts = depts.filter(function (d) { return !d.parent_id; });
  var childMap = {};
  depts.forEach(function (d) {
    if (d.parent_id) {
      if (!childMap[d.parent_id]) childMap[d.parent_id] = [];
      childMap[d.parent_id].push(d);
    }
  });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<tr style="border-bottom:1px solid var(--border,#333);color:var(--sub,#888)"><th style="padding:8px;text-align:left">부서명</th><th style="padding:8px;text-align:center">정렬</th><th style="padding:8px;text-align:center">작업</th></tr>';

  function renderRow(dept, indent) {
    html += '<tr style="border-bottom:1px solid var(--border,#333)">';
    html += '<td style="padding:8px;padding-left:' + (8 + indent * 20) + 'px">' + (indent > 0 ? '└ ' : '') + eH(dept.name) + '</td>';
    html += '<td style="padding:8px;text-align:center;color:var(--sub,#888)">' + (dept.sort_order || 0) + '</td>';
    html += '<td style="padding:8px;text-align:center">';
    html += '<button onclick="editDept(\'' + dept.id + '\')" title="수정" style="background:none;border:none;cursor:pointer;font-size:14px">&#x270F;&#xFE0F;</button> ';
    html += '<button onclick="deleteDept(\'' + dept.id + '\',\'' + eH(dept.name) + '\')" title="삭제" style="background:none;border:none;cursor:pointer;font-size:14px">&#x1F5D1;&#xFE0F;</button> ';
    html += '<button onclick="viewDeptMembers(\'' + dept.id + '\',\'' + eH(dept.name) + '\')" title="소속 인원" style="background:none;border:none;cursor:pointer;font-size:14px">&#x1F465;</button>';
    html += '</td></tr>';
    var children = childMap[dept.id] || [];
    children.forEach(function (c) { renderRow(c, indent + 1); });
  }

  rootDepts.forEach(function (d) { renderRow(d, 0); });
  html += '</table>';
  list.innerHTML = html;
}

function showDeptForm(dept, allDepts) {
  var isEdit = !!dept;
  var div = document.createElement('div');
  div.innerHTML =
    '<div style="display:grid;gap:12px;font-size:13px">' +
      '<input id="deptName" value="' + eH(isEdit ? dept.name : '') + '" placeholder="부서명" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
      '<select id="deptParent" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
        '<option value="">상위 부서 없음 (최상위)</option>' +
        (allDepts || []).filter(function (d) { return !isEdit || d.id !== dept.id; }).map(function (d) {
          return '<option value="' + d.id + '"' + (isEdit && dept.parent_id === d.id ? ' selected' : '') + '>' + eH(d.name) + '</option>';
        }).join('') +
      '</select>' +
      '<input id="deptSort" type="number" value="' + (isEdit ? (dept.sort_order || 0) : 0) + '" placeholder="정렬 순서" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:14px">' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
      '<button id="deptSave" style="padding:8px 20px;border:none;border-radius:8px;background:#3B82F6;color:#fff;cursor:pointer;font-size:13px">' + (isEdit ? '수정' : '추가') + '</button>' +
      '<button id="deptCancel" style="padding:8px 20px;border:none;border-radius:8px;background:var(--card,#1a1a2e);border:1px solid var(--border,#333);color:var(--text,#e0e0e0);cursor:pointer;font-size:13px">취소</button>' +
    '</div>';

  var modal = (typeof createModal === 'function')
    ? createModal({ title: isEdit ? '부서 수정' : '부서 추가', content: div, width: '400px' })
    : null;

  if (!modal) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    var card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#1a1a2e);border-radius:16px;padding:32px;max-width:400px;width:90vw';
    card.innerHTML = '<h3 style="margin:0 0 16px">' + (isEdit ? '부서 수정' : '부서 추가') + '</h3>';
    card.appendChild(div);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    modal = { close: function () { overlay.remove(); } };
  }

  div.querySelector('#deptSave').onclick = async function () {
    var name = document.getElementById('deptName').value.trim();
    if (!name) { if (typeof showToast === 'function') showToast('부서명을 입력하세요.', 'error'); return; }
    var parentId = document.getElementById('deptParent').value || null;
    var sortOrder = parseInt(document.getElementById('deptSort').value, 10) || 0;

    try {
      if (isEdit) {
        await apiFetch('/api/departments/' + dept.id, {
          method: 'PUT',
          body: JSON.stringify({ name: name, parentId: parentId, sortOrder: sortOrder })
        });
      } else {
        await apiFetch('/api/departments', {
          method: 'POST',
          body: JSON.stringify({ name: name, parentId: parentId, sortOrder: sortOrder })
        });
      }
      if (typeof showToast === 'function') showToast(isEdit ? '부서가 수정되었습니다.' : '부서가 추가되었습니다.');
      modal.close();
      renderOrgManagement();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  };

  div.querySelector('#deptCancel').onclick = function () { modal.close(); };
}

async function editDept(deptId) {
  try {
    var deptRes = await apiFetch('/api/departments');
    var depts = (deptRes && deptRes.data) || [];
    var dept = depts.find(function (d) { return String(d.id) === String(deptId); });
    if (!dept) { if (typeof showToast === 'function') showToast('부서를 찾을 수 없습니다.', 'error'); return; }
    showDeptForm(dept, depts);
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function deleteDept(deptId, deptName) {
  if (!confirm('"' + deptName + '" 부서를 삭제하시겠습니까?\n소속 사용자의 부서가 해제되고, 하위 부서는 최상위로 이동합니다.')) return;
  try {
    await apiFetch('/api/departments/' + deptId, { method: 'DELETE' });
    if (typeof showToast === 'function') showToast('부서 삭제 완료');
    renderOrgManagement();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function viewDeptMembers(deptId, deptName) {
  try {
    var data = await apiFetch('/api/departments/' + deptId + '/members');
    var members = (data && data.data) || [];
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
    return;
  }

  var roleLabels = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
  var html = '';
  if (members.length === 0) {
    html = '<p style="color:var(--sub,#888);font-size:13px">소속 인원이 없습니다.</p>';
  } else {
    html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="border-bottom:1px solid var(--border,#333);color:var(--sub,#888)"><th style="padding:6px;text-align:left">이름</th><th style="padding:6px;text-align:left">이메일</th><th style="padding:6px;text-align:center">역할</th><th style="padding:6px;text-align:center">직급</th></tr>';
    members.forEach(function (m) {
      html += '<tr style="border-bottom:1px solid var(--border,#333)">';
      html += '<td style="padding:6px">' + eH(m.name) + '</td>';
      html += '<td style="padding:6px;color:var(--sub,#888)">' + eH(m.email) + '</td>';
      html += '<td style="padding:6px;text-align:center">' + (roleLabels[m.role] || m.role) + '</td>';
      html += '<td style="padding:6px;text-align:center">' + eH(m.position || '-') + '</td>';
      html += '</tr>';
    });
    html += '</table>';
  }

  var div = document.createElement('div');
  div.innerHTML = html;

  if (typeof createModal === 'function') {
    createModal({ title: deptName + ' 소속 인원 (' + members.length + '명)', content: div, width: '500px' });
  } else {
    alert(deptName + ' 소속 인원: ' + members.length + '명\n' + members.map(function (m) { return m.name + ' (' + m.email + ')'; }).join('\n'));
  }
}

/* ═══ 감사 로그 UI (admin) ═══ */
async function renderAuditLog() {
  if (!currentUser || currentUser.role !== 'admin') return;

  var container = document.getElementById('mUserAdmin');
  if (!container) return;

  var section = container.querySelector('#auditSection');
  if (!section) {
    section = document.createElement('div');
    section.id = 'auditSection';
    container.appendChild(section);
  }

  var actionLabels = {
    register: '가입 요청', login: '로그인', login_fail: '로그인 실패', logout: '로그아웃',
    approve_user: '가입 승인', reject_user: '가입 거절', change_role: '역할 변경',
    change_status: '상태 변경', change_department: '부서 변경', reset_password: '비밀번호 초기화',
    change_password: '비밀번호 변경', update_profile: '프로필 수정',
    create_department: '부서 생성', delete_department: '부서 삭제'
  };

  section.innerHTML =
    '<div style="background:var(--card,#1a1a2e);border-radius:12px;padding:16px;margin-top:16px;border:1px solid var(--border,#333)">' +
      '<h4 style="margin:0 0 12px;font-size:15px">감사 로그</h4>' +
      '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
        '<input id="auditSearch" placeholder="검색 (이름, 이메일, 액션)" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
        '<input id="auditFrom" type="date" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
        '<input id="auditTo" type="date" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);font-size:13px">' +
        '<button id="auditSearchBtn" style="padding:6px 14px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:12px">조회</button>' +
      '</div>' +
      '<div id="auditLogList" style="max-height:400px;overflow-y:auto"></div>' +
      '<div id="auditPaging" style="display:flex;gap:8px;margin-top:8px;justify-content:center"></div>' +
    '</div>';

  var _auditOffset = 0;
  var _auditLimit = 50;

  async function loadAuditLogs() {
    var search = document.getElementById('auditSearch').value.trim();
    var from = document.getElementById('auditFrom').value;
    var to = document.getElementById('auditTo').value;

    var qs = '?limit=' + _auditLimit + '&offset=' + _auditOffset;
    if (search) qs += '&search=' + encodeURIComponent(search);
    if (from) qs += '&from=' + from;
    if (to) qs += '&to=' + to;

    try {
      var data = await apiFetch('/api/audit' + qs);
      var logs = data.data || [];
      var total = data.total || 0;

      var list = document.getElementById('auditLogList');
      if (logs.length === 0) {
        list.innerHTML = '<p style="color:var(--sub,#888);font-size:13px;text-align:center">로그가 없습니다.</p>';
      } else {
        var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
        html += '<tr style="border-bottom:1px solid var(--border,#333);color:var(--sub,#888)"><th style="padding:6px;text-align:left">시간</th><th style="padding:6px;text-align:left">사용자</th><th style="padding:6px;text-align:left">액션</th><th style="padding:6px;text-align:left">대상</th><th style="padding:6px;text-align:left">IP</th></tr>';
        logs.forEach(function (log) {
          var time = log.created_at ? log.created_at.slice(0, 19).replace('T', ' ') : '';
          var user = log.user_name || log.user_email || '-';
          var action = actionLabels[log.action] || log.action;
          var target = (log.target_type || '') + (log.target_id ? ' #' + log.target_id.slice(0, 8) : '');
          html += '<tr style="border-bottom:1px solid var(--border,#333)">';
          html += '<td style="padding:6px;color:var(--sub,#888);white-space:nowrap">' + eH(time) + '</td>';
          html += '<td style="padding:6px">' + eH(user) + '</td>';
          html += '<td style="padding:6px">' + eH(action) + '</td>';
          html += '<td style="padding:6px;color:var(--sub,#888)">' + eH(target) + '</td>';
          html += '<td style="padding:6px;color:var(--sub,#888);font-size:11px">' + eH(log.ip_address || '') + '</td>';
          html += '</tr>';
        });
        html += '</table>';
        list.innerHTML = html;
      }

      // 페이징
      var paging = document.getElementById('auditPaging');
      var totalPages = Math.ceil(total / _auditLimit);
      var currentPage = Math.floor(_auditOffset / _auditLimit) + 1;
      if (totalPages > 1) {
        var ph = '';
        if (currentPage > 1) ph += '<button class="auditPageBtn" data-offset="' + ((_auditOffset - _auditLimit)) + '" style="padding:4px 10px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);cursor:pointer;font-size:12px">&lt;</button>';
        ph += '<span style="font-size:12px;color:var(--sub,#888);padding:4px 8px">' + currentPage + ' / ' + totalPages + ' (' + total + '건)</span>';
        if (currentPage < totalPages) ph += '<button class="auditPageBtn" data-offset="' + ((_auditOffset + _auditLimit)) + '" style="padding:4px 10px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg,#0c0f1a);color:var(--text,#e0e0e0);cursor:pointer;font-size:12px">&gt;</button>';
        paging.innerHTML = ph;
        paging.querySelectorAll('.auditPageBtn').forEach(function (btn) {
          btn.onclick = function () {
            _auditOffset = parseInt(this.getAttribute('data-offset'), 10);
            loadAuditLogs();
          };
        });
      } else {
        paging.innerHTML = total > 0 ? '<span style="font-size:12px;color:var(--sub,#888)">' + total + '건</span>' : '';
      }
    } catch (e) {
      document.getElementById('auditLogList').innerHTML = '<p style="color:#EF4444;font-size:13px">' + eH(e.message) + '</p>';
    }
  }

  document.getElementById('auditSearchBtn').onclick = function () {
    _auditOffset = 0;
    loadAuditLogs();
  };

  loadAuditLogs();
}

/* ═══ eH 폴백 (HTML 이스케이프) ═══ */
if (typeof eH === 'undefined') {
  var eH = function (s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
}

/* ═══ 충돌 해소 UI (409 Conflict) ═══ */
function showConflictModal(myData, serverData, onKeepMine, onUseServer) {
  if (typeof createModal !== 'function') {
    alert('충돌 발생: 다른 사용자가 이 데이터를 수정했습니다. 페이지를 새로고침하세요.');
    return;
  }

  var div = document.createElement('div');
  div.innerHTML =
    '<p style="font-size:13px;color:var(--t3);margin-bottom:16px">다른 사용자가 이 데이터를 수정했습니다. 처리 방법을 선택하세요.</p>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
      '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:12px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--ac-t);margin-bottom:8px">내 변경사항</div>' +
        '<pre style="font-size:11px;color:var(--t3);white-space:pre-wrap;max-height:200px;overflow:auto">' + eH(JSON.stringify(myData, null, 2).slice(0, 2000)) + '</pre>' +
      '</div>' +
      '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:12px">' +
        '<div style="font-size:12px;font-weight:700;color:#10B981;margin-bottom:8px">서버 최신 데이터</div>' +
        '<pre style="font-size:11px;color:var(--t3);white-space:pre-wrap;max-height:200px;overflow:auto">' + eH(JSON.stringify(serverData, null, 2).slice(0, 2000)) + '</pre>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="conflictUseServer" style="padding:8px 16px;border:none;border-radius:8px;background:#10B981;color:#fff;cursor:pointer;font-size:13px">최신으로 갱신</button>' +
      '<button id="conflictKeepMine" style="padding:8px 16px;border:none;border-radius:8px;background:#F59E0B;color:#fff;cursor:pointer;font-size:13px">내 변경 강제 저장</button>' +
      '<button id="conflictCancel" style="padding:8px 16px;border:none;border-radius:8px;background:var(--bg-i);border:1px solid var(--bd);color:var(--t3);cursor:pointer;font-size:13px">취소</button>' +
    '</div>';

  var modal = createModal({ title: '편집 충돌 발생', content: div, width: '700px' });

  div.querySelector('#conflictUseServer').onclick = function () {
    modal.close();
    if (onUseServer) onUseServer(serverData);
  };
  div.querySelector('#conflictKeepMine').onclick = function () {
    modal.close();
    // version을 서버 최신으로 덮어쓰고 재전송
    if (onKeepMine) onKeepMine(serverData.version);
  };
  div.querySelector('#conflictCancel').onclick = function () { modal.close(); };
}

/* ═══ 편집 잠금 확인 ═══ */
async function checkEditLock(resourceType, resourceId) {
  if (AUTH_SKIP) return null;
  try {
    var data = await apiFetch('/api/locks?resourceType=' + resourceType + '&resourceId=' + resourceId);
    var lock = data && data.data;
    if (lock && lock.user_id !== (currentUser && currentUser.id)) {
      return lock; // 다른 사용자가 편집 중
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function acquireEditLock(resourceType, resourceId) {
  if (AUTH_SKIP) return true;
  try {
    await apiFetch('/api/locks', {
      method: 'PATCH',
      body: JSON.stringify({ resourceType: resourceType, resourceId: resourceId })
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function releaseEditLock(resourceType, resourceId) {
  if (AUTH_SKIP) return;
  try {
    await apiFetch('/api/locks?resourceType=' + resourceType + '&resourceId=' + resourceId, { method: 'DELETE' });
  } catch (e) { /* ignore */ }
}
