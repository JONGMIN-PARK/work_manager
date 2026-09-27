/* anyworks-import.js — 애니웍스 주간일지 자동 가져오기 (사내PC 로컬 에이전트 / 클라우드 서버)
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══════════════════════════════════════════
   애니웍스 주간일지 자동 가져오기
   로컬 에이전트(사내PC) + 클라우드 서버 듀얼 모드
   ═══════════════════════════════════════════ */

var _anyworksJobId = null;
var _anyworksPollTimer = null;
var _awActiveBase = '';  // 현재 사용 중인 API base URL
var _awLocalPort = 5050;
var _awLocalBase = 'http://127.0.0.1:' + _awLocalPort;

var ANYWORKS_TEAMS = ['기술연구소','장비사업부','모션사업부'];

/* ── 로컬 에이전트 연결 확인 ── */
async function awCheckLocal() {
  try {
    var ctrl = new AbortController();
    var tid = setTimeout(function(){ ctrl.abort(); }, 1500);
    var r = await fetch(_awLocalBase + '/health', { signal: ctrl.signal });
    clearTimeout(tid);
    return r.ok;
  } catch(e) { return false; }
}

function awGetServerBase() {
  if (typeof API_BASE !== 'undefined') return API_BASE;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:3000';
  return '';
}

/* ── 모달 열기 ── */
async function openAnyworksModal() {
  var old = document.getElementById('anyworksOverlay');
  if (old) old.remove();

  var ov=createModal({id:'anyworksOverlay'}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */

  ov.innerHTML =
    '<div style="background:var(--bg-p);border-radius:14px;padding:24px;max-width:420px;width:92%;box-shadow:0 24px 80px rgba(0,0,0,.4)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">'+
        '<div style="font-size:15px;font-weight:700;color:var(--t1)">🌐 애니웍스 주간일지 가져오기</div>'+
        '<button onclick="closeAnyworksModal()" style="background:none;border:none;color:var(--t5);font-size:18px;cursor:pointer;padding:4px">✕</button>'+
      '</div>'+

      '<a href="https://github.com/JONGMIN-PARK/work_manager/releases/latest/download/WeeklyDownloader.exe" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border:none;border-radius:10px;background:linear-gradient(135deg,#06B6D4,#0891B2);color:#fff;text-decoration:none;font-size:13px;font-weight:700;margin-bottom:16px">⬇️ 다운로드 도구 설치 (WeeklyDownloader.exe)</a>'+

      '<div style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:14px;margin-bottom:16px">'+
        '<div style="font-size:11px;color:var(--t4);line-height:1.8">'+
          '① <b>다운로드 도구</b>를 설치/실행<br>'+
          '② 로그인 → 사업부·날짜 선택 → 다운로드<br>'+
          '③ 아래 영역에 <b style="color:var(--ac-t)">엑셀 파일을 드래그앤드롭</b>'+
        '</div>'+
      '</div>'+

      '<div style="text-align:center;padding:20px 12px;border:2px dashed var(--bd2);border-radius:10px;cursor:pointer;transition:border-color .2s,background .2s" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#06B6D4\';this.style.background=\'rgba(6,182,212,.06)\'" '+
        'ondragleave="this.style.borderColor=\'\';this.style.background=\'\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'\';this.style.background=\'\';closeAnyworksModal();hFiles(event.dataTransfer.files)" '+
        'onclick="document.getElementById(\'fileInput2\').click();closeAnyworksModal()">'+
        '<div style="font-size:28px;margin-bottom:8px">📂</div>'+
        '<div style="font-size:13px;color:var(--t3);font-weight:600">엑셀 파일을 여기에 드롭하거나 클릭</div>'+
        '<div style="font-size:10px;color:var(--t6);margin-top:6px">여러 파일 동시 선택 가능 (.xls, .xlsx, .csv)</div>'+
      '</div>'+

      '<div style="text-align:right;margin-top:14px">'+
        '<button onclick="closeAnyworksModal()" style="padding:8px 20px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t4);cursor:pointer;font-size:12px">닫기</button>'+
      '</div>'+
    '</div>';

  document.body.appendChild(ov);
  ov.onclick = function(e) { if (e.target===ov) closeAnyworksModal(); };
  return;

  // ── 아래는 기존 전체 모달 (비활성) ──
  var savedId = localStorage.getItem('anyworks_id') || '';
  var savedPw = localStorage.getItem('anyworks_pw') || '';
  var savedTeams = [];
  try { savedTeams = JSON.parse(localStorage.getItem('anyworks_teams') || '[]'); } catch(e) {}
  var savedMode = localStorage.getItem('anyworks_mode') || 'auto';

  var now = new Date();
  var dayOfWeek = now.getDay() || 7;
  var mon = new Date(now); mon.setDate(now.getDate() - dayOfWeek + 1);
  var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  var fmt = function(d) { return d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2); };
  var savedStart = localStorage.getItem('anyworks_start') || fmt(mon);
  var savedEnd = localStorage.getItem('anyworks_end') || fmt(sun);

  var teamCheckboxes = ANYWORKS_TEAMS.map(function(t) {
    var checked = savedTeams.indexOf(t) >= 0 ? ' checked' : '';
    return '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t3);cursor:pointer;min-width:110px;margin:2px 0">'+
      '<input type="checkbox" name="aw_team" value="'+t+'"'+checked+'> '+t+'</label>';
  }).join('');

  var ov=createModal({id:'anyworksOverlay'}).overlay;  /* v13.190 공통 모달(z 자동 스택·id 중복 제거) */

  ov.innerHTML =
    '<div style="background:var(--bg-p);border-radius:14px;padding:0;max-width:560px;width:94%;box-shadow:0 24px 80px rgba(0,0,0,.4);max-height:90vh;display:flex;flex-direction:column;overflow:hidden">'+
      '<div style="padding:20px 24px 0;flex-shrink:0">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
          '<div style="font-size:15px;font-weight:700;color:var(--t1)">🌐 애니웍스 주간일지 가져오기</div>'+
          '<button onclick="closeAnyworksModal()" style="background:none;border:none;color:var(--t5);font-size:18px;cursor:pointer;padding:4px">✕</button>'+
        '</div>'+

        '<!-- 실행 위치 선택 -->'+
        '<div style="display:flex;gap:6px;margin-bottom:14px;align-items:center">'+
          '<span style="font-size:10px;color:var(--t5);font-weight:600;min-width:52px">실행 위치</span>'+
          '<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t3);cursor:pointer">'+
            '<input type="radio" name="awMode" value="auto"'+(savedMode==='auto'?' checked':'')+' onchange="awCheckConnection()"> 자동</label>'+
          '<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t3);cursor:pointer">'+
            '<input type="radio" name="awMode" value="local"'+(savedMode==='local'?' checked':'')+' onchange="awCheckConnection()"> 사내PC</label>'+
          '<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--t3);cursor:pointer">'+
            '<input type="radio" name="awMode" value="server"'+(savedMode==='server'?' checked':'')+' onchange="awCheckConnection()"> 클라우드</label>'+
          '<span id="awConnStatus" style="margin-left:auto;font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600">확인중...</span>'+
        '</div>'+

        '<div style="display:flex;gap:10px;margin-bottom:12px">'+
          '<div style="flex:1"><label style="font-size:10px;color:var(--t5);font-weight:600;display:block;margin-bottom:3px">아이디</label>'+
          '<input type="text" id="awId" class="si" style="width:100%;padding:8px 10px;font-size:12px" placeholder="애니웍스 로그인 ID" value="'+savedId.replace(/"/g,'&quot;')+'"></div>'+
          '<div style="flex:1"><label style="font-size:10px;color:var(--t5);font-weight:600;display:block;margin-bottom:3px">비밀번호</label>'+
          '<input type="password" id="awPw" class="si" style="width:100%;padding:8px 10px;font-size:12px" placeholder="비밀번호" value="'+savedPw.replace(/"/g,'&quot;')+'"></div>'+
        '</div>'+

        '<div style="display:flex;gap:10px;margin-bottom:12px">'+
          '<div style="flex:1"><label style="font-size:10px;color:var(--t5);font-weight:600;display:block;margin-bottom:3px">시작일 (YYYYMMDD)</label>'+
          '<input type="text" id="awStart" class="si" style="width:100%;padding:8px 10px;font-size:12px" placeholder="20260309" value="'+savedStart+'"></div>'+
          '<div style="flex:1"><label style="font-size:10px;color:var(--t5);font-weight:600;display:block;margin-bottom:3px">종료일 (YYYYMMDD)</label>'+
          '<input type="text" id="awEnd" class="si" style="width:100%;padding:8px 10px;font-size:12px" placeholder="20260315" value="'+savedEnd+'"></div>'+
        '</div>'+

        '<div style="margin-bottom:14px">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
            '<label style="font-size:10px;color:var(--t5);font-weight:600">사업부 선택</label>'+
            '<div style="display:flex;gap:6px">'+
              '<button onclick="awToggleAll(true)" style="font-size:9px;padding:2px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t4);cursor:pointer">전체선택</button>'+
              '<button onclick="awToggleAll(false)" style="font-size:9px;padding:2px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t4);cursor:pointer">전체해제</button>'+
            '</div>'+
          '</div>'+
          '<div id="awTeamList" style="display:flex;flex-wrap:wrap;gap:2px 8px;padding:10px;background:var(--bg-i);border-radius:8px;border:1px solid var(--bd);max-height:120px;overflow-y:auto">'+
            teamCheckboxes+
          '</div>'+
        '</div>'+

        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t4);margin-bottom:14px;cursor:pointer">'+
          '<input type="checkbox" id="awSaveCred" checked> 로그인 정보 기억하기'+
        '</label>'+
      '</div>'+

      '<div id="awResultArea" style="display:none;flex:1;overflow:hidden;border-top:1px solid var(--bd);flex-direction:column">'+
        '<div style="padding:12px 24px 6px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">'+
          '<span style="font-size:12px;font-weight:700;color:var(--t2)">실행 로그</span>'+
          '<span id="awStatusBadge" style="font-size:10px;padding:2px 10px;border-radius:10px;font-weight:600"></span>'+
        '</div>'+
        '<div id="awLogBox" style="flex:1;overflow-y:auto;padding:4px 24px 12px;font-family:monospace;font-size:10px;line-height:1.6;color:var(--t4);max-height:250px"></div>'+
      '</div>'+

      '<div style="padding:14px 24px 20px;flex-shrink:0;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--bd)">'+
        '<button id="awCancelBtn" onclick="cancelAnyworksJob()" style="display:none;padding:8px 20px;border:1px solid '+SEM_COLOR.danger+';border-radius:8px;background:rgba(239,68,68,.12);color:#F87171;cursor:pointer;font-size:12px;font-weight:600">취소</button>'+
        '<button onclick="closeAnyworksModal()" style="padding:8px 20px;border:1px solid var(--bd);border-radius:8px;background:var(--bg-i);color:var(--t4);cursor:pointer;font-size:12px">닫기</button>'+
        '<button id="awStartBtn" onclick="startAnyworksDownload()" style="padding:8px 24px;border:none;border-radius:8px;background:linear-gradient(135deg,#06B6D4,#0891B2);color:#fff;cursor:pointer;font-size:12px;font-weight:700">가져오기 시작</button>'+
      '</div>'+
    '</div>';

  document.body.appendChild(ov);
  ov.onclick = function(e) { if (e.target===ov) closeAnyworksModal(); };

  // 연결 상태 확인
  awCheckConnection();
}

async function awCheckConnection() {
  var el = document.getElementById('awConnStatus');
  if (!el) return;
  el.textContent = '확인중...';
  el.style.background = '#64748B22';
  el.style.color = '#64748B';

  var mode = (document.querySelector('input[name="awMode"]:checked')||{}).value || 'auto';
  var localOk = false;
  var serverOk = false;

  if (mode === 'auto' || mode === 'local') {
    localOk = await awCheckLocal();
  }
  if (mode === 'auto' || mode === 'server') {
    try {
      var ctrl = new AbortController();
      var tid = setTimeout(function(){ ctrl.abort(); }, 3000);
      var d = await apiFetch('/api/anyworks/health', { signal: ctrl.signal });  // 서버 라우트는 인증 필요 → JWT 첨부
      clearTimeout(tid);
      serverOk = !!(d && d.available);
    } catch(e) { serverOk = false; }
  }

  if (mode === 'auto') {
    if (localOk) {
      _awActiveBase = _awLocalBase;
      el.textContent = '사내PC 연결됨';
      el.style.background = SEM_COLOR.ok + '22'; el.style.color = SEM_COLOR.ok;
    } else if (serverOk) {
      _awActiveBase = awGetServerBase();
      el.textContent = '클라우드 연결됨';
      el.style.background = SEM_COLOR.info + '22'; el.style.color = SEM_COLOR.info;
    } else {
      _awActiveBase = '';
      el.style.background = SEM_COLOR.danger + '22'; el.style.color = SEM_COLOR.danger;
      if (location.protocol === 'https:') {
        el.textContent = '연결 없음 (HTTPS 차단 가능)';
        awShowMixedContentTip();
      } else {
        el.textContent = '연결 없음';
      }
    }
  } else if (mode === 'local') {
    _awActiveBase = _awLocalBase;
    if (localOk) {
      el.textContent = '사내PC 연결됨';
      el.style.background = SEM_COLOR.ok + '22'; el.style.color = SEM_COLOR.ok;
    } else {
      el.style.background = SEM_COLOR.danger + '22'; el.style.color = SEM_COLOR.danger;
      if (location.protocol === 'https:') {
        el.textContent = '사내PC 미연결 (HTTPS 차단)';
        awShowMixedContentTip();
      } else {
        el.textContent = '사내PC 미연결 (python anyworks_api.py 실행 필요)';
      }
    }
  } else {
    _awActiveBase = awGetServerBase();
    el.textContent = serverOk ? '클라우드 연결됨' : '클라우드 미연결';
    el.style.background = (serverOk ? SEM_COLOR.info : SEM_COLOR.danger) + '22';
    el.style.color = serverOk ? SEM_COLOR.info : SEM_COLOR.danger;
  }
}

function awShowMixedContentTip() {
  var existing = document.getElementById('awMixedTip');
  if (existing) return;
  var tip = document.createElement('div');
  tip.id = 'awMixedTip';
  tip.style.cssText = 'margin:0 24px 12px;padding:10px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:11px;color:#FBBF24;line-height:1.6';
  var httpUrl = location.href.replace('https://','http://');
  tip.innerHTML = '<b>HTTPS → HTTP 연결 차단됨</b><br>'+
    '브라우저 보안 정책으로 HTTPS 페이지에서 로컬 HTTP 서버 호출이 차단됩니다.<br>'+
    '<b>해결방법:</b> 사내PC 모드를 사용하려면 아래 주소로 접속하세요:<br>'+
    '<a href="'+httpUrl+'" style="color:#60A5FA;text-decoration:underline;word-break:break-all">'+httpUrl+'</a><br>'+
    '<span style="font-size:10px;color:var(--t5)">또는 Chrome 주소창에 chrome://flags → Insecure origins treated as secure 에 http://127.0.0.1:5050 추가</span>';
  var overlay = document.getElementById('anyworksOverlay');
  if (overlay) {
    var container = overlay.querySelector('div > div');
    if (container) container.appendChild(tip);
  }
}

function closeAnyworksModal() {
  if (_anyworksPollTimer) { clearInterval(_anyworksPollTimer); _anyworksPollTimer = null; }
  var ov = document.getElementById('anyworksOverlay');
  if (ov) ov.remove();
}

function awToggleAll(check) {
  document.querySelectorAll('input[name="aw_team"]').forEach(function(b) { b.checked = check; });
}

function awSetStatus(status, text) {
  var badge = document.getElementById('awStatusBadge');
  if (!badge) return;
  var colors = { queued:SEM_COLOR.warn, running:SEM_COLOR.info, done:SEM_COLOR.ok, error:SEM_COLOR.danger };
  var labels = { queued:'대기중', running:'실행중...', done:'완료', error:'오류' };
  badge.style.background = (colors[status]||'#64748B') + '22';
  badge.style.color = colors[status]||'#64748B';
  badge.textContent = text || labels[status] || status;
}

function awAppendLog(msg, level) {
  var box = document.getElementById('awLogBox');
  if (!box) return;
  var color = level==='ERROR' ? SEM_COLOR.danger : level==='WARN' ? SEM_COLOR.warn : 'var(--t4)';
  box.innerHTML += '<div style="color:'+color+'">'+msg.replace(/</g,'&lt;')+'</div>';
  box.scrollTop = box.scrollHeight;
}

/* ── API URL 결정 (로컬 vs 서버) ── */
/* 요청 헬퍼 — 사내PC 로컬 에이전트는 raw fetch(인증 없음), 클라우드 서버 /api/anyworks/* 는 apiFetch(JWT 첨부·401 갱신).
   예전엔 서버 쪽도 raw fetch 라 Authorization 이 빠져 auth.authenticate 에 401 로 막혔다.
   호출부가 fetch 응답처럼 쓰도록 {ok, json()} 모양으로 돌려준다. 네트워크 오류는 그대로 throw */
async function awFetch(path, opts) {
  if (_awActiveBase === _awLocalBase) return fetch(awApiUrl(path), opts);
  var data, ok = true;
  try {
    data = await apiFetch('/api/anyworks' + path, opts);
    if (data == null) { ok = false; data = { message: '로그인이 필요합니다' }; }
  } catch (e) {
    if (!e || !e.status) throw e;
    ok = false; data = e.data || { message: e.message };
  }
  return { ok: ok, json: function () { return Promise.resolve(data); } };
}

function awApiUrl(path) {
  // 로컬 에이전트: http://localhost:5050/download
  // 서버: /api/anyworks/download
  if (_awActiveBase === _awLocalBase) return _awLocalBase + path;
  return (_awActiveBase || awGetServerBase()) + '/api/anyworks' + path;
}

/* ── 다운로드 시작 ── */
async function startAnyworksDownload() {
  var id = document.getElementById('awId').value.trim();
  var pw = document.getElementById('awPw').value.trim();
  var start = document.getElementById('awStart').value.trim();
  var end = document.getElementById('awEnd').value.trim();
  var boxes = document.querySelectorAll('input[name="aw_team"]:checked');
  var teams = []; boxes.forEach(function(b){ teams.push(b.value); });
  var mode = (document.querySelector('input[name="awMode"]:checked')||{}).value || 'auto';

  if (!id || !pw) { showToast('아이디와 비밀번호를 입력하세요','error'); return; }
  if (!start || !end) { showToast('시작일과 종료일을 입력하세요','error'); return; }
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) { showToast('날짜는 YYYYMMDD 형식으로 입력하세요','error'); return; }
  if (teams.length===0) { showToast('사업부를 최소 1개 이상 선택하세요','error'); return; }

  if (document.getElementById('awSaveCred').checked) {
    localStorage.setItem('anyworks_id', id);
    localStorage.setItem('anyworks_pw', pw);
    localStorage.setItem('anyworks_teams', JSON.stringify(teams));
  } else {
    localStorage.removeItem('anyworks_id');
    localStorage.removeItem('anyworks_pw');
  }
  localStorage.setItem('anyworks_start', start);
  localStorage.setItem('anyworks_end', end);
  localStorage.setItem('anyworks_mode', mode);

  // 자동 모드: 로컬 먼저 시도, 실패 시 서버
  if (mode === 'auto') {
    var localOk = await awCheckLocal();
    _awActiveBase = localOk ? _awLocalBase : awGetServerBase();
  }

  document.getElementById('awStartBtn').disabled = true;
  document.getElementById('awStartBtn').style.opacity = '0.5';
  document.getElementById('awCancelBtn').style.display = '';
  document.getElementById('awResultArea').style.display = 'flex';
  document.getElementById('awLogBox').innerHTML = '';
  awSetStatus('queued');

  var isLocal = _awActiveBase === _awLocalBase;
  awAppendLog('['+new Date().toLocaleTimeString()+'] '+(isLocal?'사내PC':'클라우드')+' 모드로 요청 중...','INFO');

  try {
    var resp = await awFetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username:id, password:pw, start_date:start, end_date:end, teams:teams,
        base_url:'https://works.animotion.co.kr',
        list_url:'https://works.animotion.co.kr/Sales/Week_List.asp?top_id=80&mun=6&table=WeekList' })
    });
    var data = await resp.json();
    if (!resp.ok) {
      awSetStatus('error', data.message || 'API 오류');
      awAppendLog(data.message || JSON.stringify(data), 'ERROR');
      awResetButtons(); return;
    }
    _anyworksJobId = data.job_id;
    awAppendLog('['+new Date().toLocaleTimeString()+'] 작업 시작 (ID: '+_anyworksJobId+')','INFO');
    awSetStatus('running');
    _awLastLogIndex = 0;
    _anyworksPollTimer = setInterval(function(){ pollAnyworksJob(); }, 2000);
  } catch(e) {
    awSetStatus('error', '연결 실패');
    awAppendLog('서버에 연결할 수 없습니다: '+e.message, 'ERROR');
    if (isLocal) {
      awAppendLog('사내PC에서 python anyworks_api.py 를 실행하세요.','WARN');
    } else {
      awAppendLog('클라우드 서버 상태를 확인하세요.','WARN');
    }
    awResetButtons();
  }
}

function awResetButtons() {
  document.getElementById('awStartBtn').disabled = false;
  document.getElementById('awStartBtn').style.opacity = '1';
  document.getElementById('awCancelBtn').style.display = 'none';
}

var _awLastLogIndex = 0;

async function pollAnyworksJob() {
  if (!_anyworksJobId) return;
  try {
    var resp = await awFetch('/jobs/'+_anyworksJobId);
    var job = await resp.json();

    var logs = job.logs || [];
    for (var i = _awLastLogIndex; i < logs.length; i++) {
      awAppendLog(logs[i].msg, logs[i].level);
    }
    _awLastLogIndex = logs.length;

    if (job.status === 'running' || job.status === 'queued') {
      awSetStatus(job.status); return;
    }

    clearInterval(_anyworksPollTimer); _anyworksPollTimer = null;

    if (job.status === 'done') {
      awSetStatus('done');
      awAppendLog('','INFO');
      awAppendLog('═══ 결과 ═══','INFO');
      var results = job.results || {};
      var okCount = 0, failCount = 0;
      Object.keys(results).forEach(function(team) {
        var r = results[team];
        var isOk = r.indexOf('OK') >= 0;
        if (isOk) okCount++; else failCount++;
        awAppendLog('  '+team+': '+r, isOk?'INFO':'WARN');
      });
      awAppendLog('','INFO');
      awAppendLog('성공: '+okCount+'건 / 실패: '+failCount+'건', okCount>0?'INFO':'WARN');
      if (job.finished_at && job.started_at) {
        awAppendLog('소요시간: '+((new Date(job.finished_at)-new Date(job.started_at))/1000).toFixed(1)+'초','INFO');
      }

      var files = job.files || [];
      if (files.length > 0) {
        awAppendLog('','INFO');
        awAppendLog('다운로드 파일 '+files.length+'개 → 업무일지 자동 로드:','INFO');
        _awJobCache = job;
        for (var fi = 0; fi < files.length; fi++) {
          awAppendLog('  📄 '+files[fi].name+' ('+(files[fi].size/1024).toFixed(1)+' KB) 로드중...','INFO');
          await awLoadFile(fi);
        }
        awAppendLog('','INFO');
        awAppendLog('✓ 모든 파일이 업무일지에 반영되었습니다.','INFO');
      }
      showAnyworksResultPopup(results, job);

    } else if (job.status === 'error') {
      awSetStatus('error', job.error || '오류 발생');
      awAppendLog('오류: '+(job.error||'알 수 없는 오류'),'ERROR');
    }
    awResetButtons();
    _awLastLogIndex = 0;
  } catch(e) {
    console.warn('anyworks poll error:', e);
  }
}

async function cancelAnyworksJob() {
  if (!_anyworksJobId) return;
  try {
    await awFetch('/cancel/'+_anyworksJobId, { method:'POST' });
    awAppendLog('취소 요청을 보냈습니다...','WARN');
  } catch(e) {
    awAppendLog('취소 요청 실패: '+e.message,'ERROR');
  }
}

var _awJobCache = null;

async function awLoadFile(idx) {
  var job = _awJobCache;
  if (!job) {
    if (!_anyworksJobId) { showToast('작업 정보가 없습니다','error'); return; }
    var resp = await awFetch('/jobs/'+_anyworksJobId);
    job = await resp.json();
  }
  try {
    var files = job.files || [];
    if (idx >= files.length) { showToast('파일을 찾을 수 없습니다','error'); return; }
    var f = files[idx];
    var binary = atob(f.base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type:'application/vnd.ms-excel' });
    var file = new File([blob], f.name, { type:blob.type });
    if (typeof hFile === 'function') {
      hFile(file);
      showToast('📄 '+f.name+' 로드 완료');
    } else {
      showToast('파일 핸들러를 찾을 수 없습니다','error');
    }
  } catch(e) { showToast('파일 로드 실패: '+e.message,'error'); }
}

function showAnyworksResultPopup(results, job) {
  var oldPopup = document.getElementById('awResultPopup');
  if (oldPopup) oldPopup.remove();

  var elapsed = '';
  if (job.finished_at && job.started_at) {
    elapsed = ((new Date(job.finished_at)-new Date(job.started_at))/1000).toFixed(1)+'초';
  }
  var rows = '';
  var okCount = 0, failCount = 0;
  Object.keys(results).forEach(function(team) {
    var r = results[team];
    var isOk = r.indexOf('OK') >= 0;
    if (isOk) okCount++; else failCount++;
    var icon = isOk ? '✅' : '❌';
    var bg = isOk ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)';
    var tc = isOk ? SEM_COLOR.ok : SEM_COLOR.danger;
    rows += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:'+bg+';border-radius:6px;margin-bottom:4px">'+
      '<span style="font-size:12px;color:var(--t2);font-weight:600">'+icon+' '+team+'</span>'+
      '<span style="font-size:11px;color:'+tc+';font-weight:600">'+r+'</span></div>';
  });

  var popup = document.createElement('div');
  popup.id = 'awResultPopup';
  popup.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;width:340px;background:var(--bg-p);border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.35);border:1px solid var(--bd);overflow:hidden;animation:awSlideIn .3s ease';
  popup.innerHTML =
    '<style>@keyframes awSlideIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}</style>'+
    '<div style="padding:16px 18px 0">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<span style="font-size:14px;font-weight:700;color:var(--t1)">🌐 애니웍스 결과</span>'+
        '<button onclick="document.getElementById(\'awResultPopup\').remove()" style="background:none;border:none;color:var(--t5);font-size:16px;cursor:pointer">✕</button>'+
      '</div>'+
      '<div style="display:flex;gap:12px;margin-bottom:12px">'+
        '<div style="flex:1;text-align:center;padding:8px;background:rgba(16,185,129,.08);border-radius:8px"><div style="font-size:20px;font-weight:800;color:'+SEM_COLOR.ok+'">'+okCount+'</div><div style="font-size:9px;color:var(--t5)">성공</div></div>'+
        '<div style="flex:1;text-align:center;padding:8px;background:rgba(239,68,68,.08);border-radius:8px"><div style="font-size:20px;font-weight:800;color:'+SEM_COLOR.danger+'">'+failCount+'</div><div style="font-size:9px;color:var(--t5)">실패</div></div>'+
        '<div style="flex:1;text-align:center;padding:8px;background:rgba(59,130,246,.08);border-radius:8px"><div style="font-size:14px;font-weight:800;color:'+SEM_COLOR.info+';margin-top:3px">'+elapsed+'</div><div style="font-size:9px;color:var(--t5)">소요시간</div></div>'+
      '</div>'+
    '</div>'+
    '<div style="padding:0 18px 16px;max-height:240px;overflow-y:auto">'+rows+'</div>';

  document.body.appendChild(popup);
  setTimeout(function(){ var el=document.getElementById('awResultPopup'); if(el)el.style.opacity='0.5'; }, 10000);
}
