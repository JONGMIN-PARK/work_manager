/**
 * 애니웍스 연동 (v13.512) — PC 앱이 숨은 창으로 애니웍스(works.animotion.co.kr)에 직접 들어가
 *   공수등록 화면에 입력 · 등록하고, 주간일지 엑셀을 내려받는다. (예전 별도 프로그램 WeeklyDownloader 가 하던 일)
 *
 *   · 아이디 · 비밀번호는 이 PC 에만 (윈도우 보안 저장소로 암호화). 웹 화면 · 서버로 내보내지 않는다.
 *   · 등록은 두 단계: fill(입력 + 캡처) → 사람이 확인 → submit(등 록 클릭). fill 없이 submit 은 안 된다.
 *   · 등록 결과가 분명하지 않으면 다시 시도하지 않는다 (같은 내용이 두 번 올라가지 않게).
 *
 *   공수등록 화면 (Sales/common_gs_insert.asp · form frm_gBoard → common_gs_Pass.asp)
 *     gs_date(#datepicker1) · 행 N=1..15: gs_orderno{N}(누르면 팝업 common_pjtno1.asp) · gs_prodspec{N} ·
 *     gs_time{N} · gs_divi{N}(0 사내/1 사외) · gs_job{N}(R 제안/B 수주/D 개발/S 지원/A CS/M 양산/G 공통) · gs_memo{N}(50자)
 *     [등 록] = goBoardPass() — 빈 값이면 SweetAlert 「필수 입력 알림」, 마감(다음 날 08:20) 뒤면 SweetAlert 경고 뒤 전송
 */
'use strict';
const { BrowserWindow, session, safeStorage, app } = require('electron');
const path = require('path');
const fs = require('fs');

const HOST = 'works.animotion.co.kr';
const BASE = 'https://' + HOST;
const URL_FORM = BASE + '/Sales/common_gs_insert.asp?mun=4&table=WeekList&top_id=80';
const URL_LIST = BASE + '/Sales/Week_List.asp?top_id=80&mun=6&table=WeekList';
const MAX_ROWS = 15, MEMO_MAX = 50, IDLE_MS = 10 * 60 * 1000;
const DIVI = { '사내': '0', '사외': '1' };
const JOB = { '제안': 'R', '수주': 'B', '개발': 'D', '지원': 'S', 'CS': 'A', '양산': 'M', '공통': 'G' };
const POPUP_FIELDS = { orderno: 'orderno', custnm: 'custnm', prodspec: 'prodspec' };

let aw = null, popup = null, idleTimer = null, chain = Promise.resolve(), running = '';
let filled = null;            // { date, n } — fill 이 끝나고 아직 등록 전
const downloads = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function E(code, msg) { const e = new Error(msg); e.code = code; return e; }
async function until(fn, ms, label) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { if (e && e.code) throw e; last = e; }
    await sleep(150);
  }
  throw E('TIMEOUT', label + ' — 응답이 없습니다' + (last ? ' (' + String(last.message).slice(0, 80) + ')' : ''));
}
const J = (v) => JSON.stringify(v);

/* ─── 아이디 · 비밀번호 (이 PC 에만) ─── */
const credPath = () => path.join(app.getPath('userData'), 'aw-cred.bin');
function readCred() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(credPath())));
    return o && o.id && o.pw ? o : null;
  } catch (_) { return null; }
}
function writeCred(id, pw) {
  if (!safeStorage.isEncryptionAvailable()) throw E('NO_SAFE', '이 PC 에서는 비밀번호를 안전하게 보관할 수 없습니다');
  fs.writeFileSync(credPath(), safeStorage.encryptString(JSON.stringify({ id: String(id), pw: String(pw) })));
}
function clearCred() { try { fs.unlinkSync(credPath()); } catch (_) {} }

/* ─── 숨은 창 ─── */
function ses() {
  const s = session.fromPartition('wm-anyworks');          // 메모리에만 — 앱을 끄면 로그인도 사라짐
  if (!s.__awReady) {
    s.__awReady = true;
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    s.on('will-download', (_e, item) => {
      const dir = path.join(app.getPath('temp'), 'wm-anyworks');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      const name = String(item.getFilename() || 'download.xls').replace(/[\\/:*?"<>|]/g, '_');
      const p = path.join(dir, Date.now() + '-' + name);
      item.setSavePath(p);
      const d = { name, path: p, state: 'progressing' };
      downloads.push(d);
      item.once('done', (_e2, state) => { d.state = state; });
    });
  }
  return s;
}
const webPrefs = () => ({ session: ses(), preload: path.join(__dirname, 'aw-preload.js'), contextIsolation: false, nodeIntegration: false, nodeIntegrationInSubFrames: true, sandbox: true, backgroundThrottling: false, spellcheck: false });
const onHost = (u) => { try { return new URL(u).host === HOST; } catch (_) { return false; } };

function closeWin() {
  clearTimeout(idleTimer); filled = null;
  if (popup) { try { popup.destroy(); } catch (_) {} popup = null; }
  if (aw) { try { aw.destroy(); } catch (_) {} aw = null; }
}
function touch() { clearTimeout(idleTimer); idleTimer = setTimeout(closeWin, IDLE_MS); }

function ensureWin() {
  if (aw && !aw.isDestroyed()) return aw;
  // offscreen: 화면에 안 보여도 늘 그려 둔다 — 숨긴 창은 다시 그리지 않아 캡처가 옛 화면으로 찍힘
  aw = new BrowserWindow({ show: false, width: 1500, height: 1000, skipTaskbar: true, focusable: false, webPreferences: Object.assign(webPrefs(), { offscreen: true }) });
  const wc = aw.webContents;
  wc.setAudioMuted(true);
  try { wc.setFrameRate(5); } catch (_) {}
  wc.on('will-navigate', (e, url) => { if (!onHost(url)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => onHost(url)
    ? { action: 'allow', overrideBrowserWindowOptions: { show: false, width: 900, height: 700, skipTaskbar: true, focusable: false, webPreferences: webPrefs() } }
    : { action: 'deny' });
  wc.on('did-create-window', (w) => {
    popup = w;
    w.webContents.on('will-navigate', (e, url) => { if (!onHost(url)) e.preventDefault(); });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('closed', () => { if (popup === w) popup = null; });
  });
  aw.on('closed', () => { aw = null; filled = null; });
  return aw;
}
const fr = () => aw.webContents.mainFrame.frames[0];
const inFrame = (js, gesture) => fr().executeJavaScript(js, !!gesture);
const inTop = (js, gesture) => aw.webContents.executeJavaScript(js, !!gesture);
const drain = () => inTop('(window.__awDlg || []).splice(0)').catch(() => []);
const atMain = () => { try { return /Main3\.asp/i.test(new URL(aw.webContents.getURL()).pathname); } catch (_) { return false; } };

/* ─── 로그인 ─── */
async function login() {
  const c = readCred();
  if (!c) throw E('NO_CRED', '애니웍스 아이디 · 비밀번호를 먼저 저장해 주세요');
  ensureWin();
  filled = null;
  try { await aw.webContents.loadURL(BASE); } catch (e) { if (!atMain()) throw E('NET', '애니웍스에 연결하지 못했습니다 — 네트워크를 확인해 주세요'); }
  if (!atMain()) {
    await until(() => inTop(`!!document.querySelector("input[type='password']")`), 12000, '애니웍스 로그인 화면');
    await drain();
    await inTop(`(function(){
      var u = document.querySelector("input[type='text'][name*='id'], input[type='text'][name*='user'], input[type='text'][id*='id'], input[type='text'][placeholder*='아이디']");
      var p = document.querySelector("input[type='password']");
      if (!u || !p) return false;
      u.value = ${J(c.id)}; p.value = ${J(c.pw)};
      var b = document.querySelector("div.login-container form button") || (p.form && p.form.querySelector("button, input[type=submit]"));
      if (b) b.click(); else p.form.submit();
      return true; })()`, true);
    const end = Date.now() + 12000; let said = [];
    while (Date.now() < end && !atMain()) {
      const d = await drain(); if (d.length) said = said.concat(d.map((x) => x.m));
      await sleep(150);
    }
    if (!atMain()) { closeWin(); throw E('LOGIN', '애니웍스 로그인에 실패했습니다 — 아이디 · 비밀번호를 확인해 주세요' + (said.length ? ' (' + said.join(' / ').slice(0, 120) + ')' : '')); }
  }
  await until(() => inTop('document.getElementsByTagName("iframe").length > 0'), 10000, '애니웍스 메인 화면');
}

/* 메인 화면의 iframe 을 원하는 화면으로 바꾼다. 로그인이 풀렸으면 한 번 다시 로그인 */
async function openPage(url, readyJs, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!aw || aw.isDestroyed() || !atMain()) await login();
    try {
      await inFrame('window.__awOld = 1').catch(() => {});
      await inTop('document.getElementsByTagName("iframe")[0].src = ' + J(url) + '; 1');
      await until(() => inFrame('!window.__awOld && document.readyState === "complete" && (' + readyJs + ')'), 12000, label);
      return;
    } catch (e) {
      if (attempt) throw e;
      closeWin();                        // 로그인이 풀렸을 수 있음 → 처음부터 한 번 더
    }
  }
}
const openForm = () => openPage(URL_FORM, '!!(document.frm_gBoard && document.frm_gBoard.gs_date)', '공수등록 화면');
const formOpen = async () => { try { return !!(aw && !aw.isDestroyed() && atMain() && await inFrame('!!(document.frm_gBoard && document.frm_gBoard.gs_date)')); } catch (_) { return false; } };

/* ─── 수주번호 팝업 ─── */
const JS_POPUP_ROWS = `(function(){ var out = [];
  document.querySelectorAll('[onclick*="goPass("], a[href*="goPass("]').forEach(function(el){
    var s = el.getAttribute('onclick') || el.getAttribute('href') || '';
    var m = s.match(/goPass\\(\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*\\)/); if (!m) return;
    var tr = el.closest('tr');
    out.push({ orderno: m[1], prodspec: m[2], cells: tr ? [].map.call(tr.cells, function(c){ return c.textContent.trim(); }) : [] });
  }); return out; })()`;

async function popupSearch(n, q, field) {
  if (popup) { try { popup.destroy(); } catch (_) {} popup = null; }
  await inFrame('document.frm_gBoard.gs_orderno' + n + '.click()', true);
  await until(() => popup, 8000, '수주번호 조회 창');
  const pw = popup.webContents;
  await until(() => pw.executeJavaScript('!!document.frm_pjt && document.readyState === "complete"'), 10000, '수주번호 조회 창');
  await pw.executeJavaScript(`(function(){ window.__awOld = 1; var f = document.frm_pjt;
    ['orderno','custnm','prodspec'].forEach(function(k){ if (f[k]) f[k].value = ''; });
    if (f[${J(field)}]) f[${J(field)}].value = ${J(q)};
    var b = document.querySelector("button[onclick='doSave()']"); if (b) b.click(); else doSave(); })()`, true);
  await until(() => pw.executeJavaScript('!!document.frm_pjt && !window.__awOld && document.readyState === "complete"'), 12000, '수주번호 조회 결과');
  return pw.executeJavaScript(JS_POPUP_ROWS);
}
function closePopup() { if (popup) { try { popup.destroy(); } catch (_) {} popup = null; } }

async function orders(a) {
  const q = String((a && a.q) || '').trim().slice(0, 60);
  const field = POPUP_FIELDS[(a && a.field) || 'orderno'] || 'orderno';
  if (!await formOpen()) await openForm();
  const n = Math.min(MAX_ROWS, (filled ? filled.n : 0) + 1);      // 입력해 둔 행은 건드리지 않게 빈 행에서 연다
  try { return { rows: (await popupSearch(n, q, field)).slice(0, 300) }; } finally { closePopup(); }
}

async function selectOrder(n, it) {
  try {
    const rows = await popupSearch(n, it.orderno, 'orderno');
    if (!rows.some((r) => r.orderno === it.orderno)) throw E('ORDER', n + '행: 애니웍스 수주번호 조회에 「' + it.orderno + '」 가 없습니다');
    const w = popup; const closed = new Promise((r) => w.once('closed', r));
    await w.webContents.executeJavaScript(`(function(){ var want = ${J(it.orderno)}, hit = null;
      document.querySelectorAll('[onclick*="goPass("], a[href*="goPass("]').forEach(function(el){
        var s = el.getAttribute('onclick') || el.getAttribute('href') || ''; var m = s.match(/goPass\\(\\s*'([^']*)'/);
        if (!hit && m && m[1] === want) hit = el; });
      if (hit) hit.click(); })()`, true).catch(() => {});
    await Promise.race([closed, sleep(5000)]);
  } finally { closePopup(); }
  const got = await inFrame('document.frm_gBoard.gs_orderno' + n + '.value');
  if (got !== it.orderno) throw E('ORDER', n + '행: 수주번호가 화면에 반영되지 않았습니다 (현재 「' + got + '」)');
}

/* ─── 입력 (등록 전) ─── */
function checkItems(a) {
  const date = String((a && a.date) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw E('BAD', '작성일자가 올바르지 않습니다');
  const src = Array.isArray(a && a.items) ? a.items : [];
  if (!src.length) throw E('BAD', '입력할 업무가 없습니다');
  if (src.length > MAX_ROWS) throw E('BAD', '한 번에 ' + MAX_ROWS + '행까지 등록할 수 있습니다');
  const items = src.map((r, i) => {
    const it = { orderno: String(r.orderno || '').trim(), hours: Number(r.hours), divi: String(r.divi || ''), job: String(r.job || ''), memo: String(r.memo || '').trim() };
    const at = (i + 1) + '행: ';
    if (!it.orderno) throw E('BAD', at + '수주번호가 없습니다');
    if (!(it.hours > 0) || it.hours > 24) throw E('BAD', at + '작업시간이 올바르지 않습니다');
    if (!DIVI[it.divi]) throw E('BAD', at + '사내/사외를 골라 주세요');
    if (!JOB[it.job]) throw E('BAD', at + '업무구분을 골라 주세요');
    if (!it.memo) throw E('BAD', at + '작업내용이 없습니다');
    if (it.memo.length > MEMO_MAX) throw E('BAD', at + '작업내용은 ' + MEMO_MAX + '자까지입니다 (지금 ' + it.memo.length + '자)');
    return it;
  });
  return { date, items };
}

async function fill(a) {
  const { date, items } = checkItems(a);
  filled = null;
  await openForm();                                   // 이전 입력 흔적 없이 새로
  const [y, m, d] = date.split('-').map(Number);
  const shown = await inFrame(`(function(){ var el = document.getElementById('datepicker1');
    try { jQuery(el).datepicker('setDate', new Date(${y}, ${m - 1}, ${d})); } catch (e) {}
    if (el.value !== ${J(date)}) { el.value = ${J(date)}; el.dispatchEvent(new Event('change', { bubbles: true })); }
    return el.value; })()`);
  if (shown !== date) throw E('DATE', '작성일자를 넣지 못했습니다 (화면 값 「' + shown + '」)');
  for (let i = 0; i < items.length; i++) {
    const n = i + 1, it = items[i];
    await selectOrder(n, it);
    await inFrame(`(function(){ var f = document.frm_gBoard, n = ${n};
      f['gs_time' + n].value = ${J(String(it.hours))}; f['gs_divi' + n].value = ${J(DIVI[it.divi])};
      f['gs_job' + n].value = ${J(JOB[it.job])}; f['gs_memo' + n].value = ${J(it.memo)};
      ['gs_time','gs_divi','gs_job','gs_memo'].forEach(function(k){ f[k + n].dispatchEvent(new Event('change', { bubbles: true })); }); })()`);
  }
  const back = await inFrame(`(function(){ var f = document.frm_gBoard, rows = [];
    for (var n = 1; n <= ${items.length}; n++) rows.push(['gs_orderno','gs_prodspec','gs_time','gs_divi','gs_job','gs_memo'].map(function(k){ return f[k + n].value; }));
    return { date: f.gs_date.value, rows: rows }; })()`);
  items.forEach((it, i) => {
    const r = back.rows[i] || [];
    if (r[0] !== it.orderno || Number(r[2]) !== it.hours || r[3] !== DIVI[it.divi] || r[4] !== JOB[it.job] || r[5] !== it.memo)
      throw E('MISMATCH', (i + 1) + '행: 화면에 들어간 값이 보낸 값과 다릅니다 — 다시 시도해 주세요');
  });
  filled = { date, n: items.length };
  let png = null;
  try { png = await capture(items.length); } catch (_) {}
  const divi = { 0: '사내', 1: '사외' }, job = Object.fromEntries(Object.entries(JOB).map(([k, v]) => [v, k]));
  return { date: back.date, rows: back.rows.map((r) => ({ orderno: r[0], prodspec: r[1], hours: Number(r[2]), divi: divi[r[3]] || r[3], job: job[r[4]] || r[4], memo: r[5] })), png };
}

/* 입력한 영역(작성일자 ~ 마지막 행)만 찍는다. 찍는 동안만 iframe 을 창 전체로 펼친다 */
async function capture(n) {
  const wc = aw.webContents;
  const old = await inTop(`(function(){ var f = document.getElementsByTagName('iframe')[0]; var o = f.getAttribute('style') || '';
    f.setAttribute('style', o + ';position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;max-height:none !important;margin:0 !important;border:0 !important;z-index:2147483647 !important;background:#fff !important;transform:none !important;');
    return o; })()`);
  try {
    await sleep(120);
    const r = await inFrame(`(function(){ var f = document.frm_gBoard, n = ${n}, KEYS = ['gs_orderno','gs_prodspec','gs_time','gs_divi','gs_job','gs_memo'];
      var d = document.getElementById('datepicker1'), row = d;
      while (row.parentElement && row.parentElement !== f && !row.parentElement.contains(f.gs_orderno1)) row = row.parentElement;
      window.scrollTo(0, Math.max(0, Math.min(row.getBoundingClientRect().top, d.getBoundingClientRect().top) + window.scrollY - 12));
      var a = row.getBoundingClientRect(), b = d.getBoundingClientRect();
      var L = Math.min(a.left, b.left), T = Math.min(a.top, b.top), R = b.right, B = b.bottom;
      for (var i = 1; i <= n; i++) KEYS.forEach(function(k){ var el = f[k + i]; if (!el) return; var c = el.getBoundingClientRect(); if (!c.width && !c.height) return;
        L = Math.min(L, c.left); R = Math.max(R, c.right); B = Math.max(B, c.bottom); });
      return { x: L - 10, y: T - 10, w: R - L + 20, h: B - T + 12, vw: innerWidth, vh: innerHeight }; })()`);
    try { wc.invalidate(); } catch (_) {}
    await sleep(450);
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const rect = { x, y, width: Math.max(10, Math.min(Math.round(r.w), r.vw - x)), height: Math.max(10, Math.min(Math.round(r.h), r.vh - y)) };
    const img = await Promise.race([wc.capturePage(rect), sleep(6000).then(() => null)]);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } finally {
    await inTop('(function(){ var f = document.getElementsByTagName("iframe")[0]; if (f) f.setAttribute("style", ' + J(old) + '); })()').catch(() => {});
  }
}

/* ─── 등록 ─── */
const JS_SWAL = `(function(){ var p = location.pathname, o = { p: p, form: !!document.frm_gBoard };
  try { if (typeof Swal !== 'undefined' && Swal.isVisible()) {
    var pop = document.querySelector('.swal2-popup') || document;
    var t = pop.querySelector('.swal2-title'), x = pop.querySelector('.swal2-html-container, .swal2-content');
    o.swal = { title: (t && t.textContent || '').trim(), text: (x && x.textContent || '').trim() };
  } } catch (e) {}
  return o; })()`;

async function submit() {
  if (!filled || !await formOpen()) { filled = null; throw E('NOT_FILLED', '먼저 「웹에 입력」 으로 내용을 넣고 확인해 주세요'); }
  const was = filled; filled = null;                 // 어떤 결과든 같은 입력으로 두 번 누르지 못하게
  await drain();
  await inFrame(`(function(){ var b = document.querySelector("input[onclick='goBoardPass()']"); if (b) b.click(); else goBoardPass(); })()`, true);
  const messages = []; let left = false, page = '', quietUntil = 0, lastSwal = '';
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    (await drain()).forEach((d) => { messages.push(d.m); quietUntil = Date.now() + 1500; });
    let st = null;
    try { st = await inFrame(JS_SWAL); } catch (_) {}
    if (st) {
      page = st.p;
      if (st.swal) {
        const key = st.swal.title + '|' + st.swal.text;
        if (key !== lastSwal) { lastSwal = key; messages.push((st.swal.title ? st.swal.title + ' ' : '') + st.swal.text); }
        if (/필수 입력/.test(st.swal.title)) {
          await inFrame('Swal.clickConfirm()').catch(() => {});
          throw E('VALID', '애니웍스가 등록을 받지 않았습니다: ' + st.swal.text);
        }
        await inFrame('Swal.clickConfirm()').catch(() => {});       // 마감 경고 등 — 확인을 눌러야 전송된다
        await sleep(400); continue;
      }
      if (!/common_gs_insert/i.test(st.p) || !st.form) { if (!left) { left = true; quietUntil = Math.max(quietUntil, Date.now() + 1500); } }
    }
    if (left && Date.now() > quietUntil) break;
    await sleep(200);
  }
  if (!left) throw E('UNSURE', '등록 결과를 확인하지 못했습니다 — 다시 누르지 말고 주간일지를 내려받아 올라갔는지 확인해 주세요' + (messages.length ? ' (' + messages.join(' / ').slice(0, 160) + ')' : ''));
  return { date: was.date, count: was.n, messages, page };
}

/* ─── 주간일지 내려받기 ─── */
async function download(a) {
  const ymd = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) throw E('BAD', '기간이 올바르지 않습니다'); return String(s).replace(/-/g, ''); };
  const d1 = ymd(a && a.start), d2 = ymd(a && a.end);
  filled = null;
  await openPage(URL_LIST, '!!document.getElementsByName("TeamName")[0]', '주간일지 화면');
  const all = (await inFrame(`[].map.call(document.getElementsByName('TeamName')[0].options, function(o){ return o.value ? o.text.trim() : ''; })`)).filter(Boolean);
  const want = Array.isArray(a && a.teams) && a.teams.length ? a.teams.map(String).filter((t) => all.includes(t)) : all;
  const files = [], skipped = [];
  for (const team of want) {
    await inFrame(`(function(){ window.__awOld = 1; var s = document.getElementsByName('TeamName')[0];
      for (var i = 0; i < s.options.length; i++) if (s.options[i].text.trim() === ${J(team)}) s.selectedIndex = i;
      [['dsc1', ${J(d1)}], ['dsc2', ${J(d2)}]].forEach(function(p){ var el = document.getElementById(p[0]); if (!el) return;
        el.removeAttribute('readonly'); el.removeAttribute('disabled'); el.value = p[1]; el.dispatchEvent(new Event('change', { bubbles: true })); });
      dosearchok(); })()`, true);
    await until(() => inFrame('!window.__awOld && document.readyState === "complete" && !!document.getElementsByName("TeamName")[0]'), 15000, '주간일지 검색(' + team + ')');
    if (await inFrame('document.querySelectorAll("table tr").length') <= 1) { skipped.push({ team, why: '내용 없음' }); continue; }
    const before = downloads.length;
    await inFrame('doExcel()', true);
    try {
      await until(() => downloads.length > before && downloads[downloads.length - 1].state !== 'progressing', 20000, '엑셀 내려받기(' + team + ')');
    } catch (e) { closePopup(); skipped.push({ team, why: '내려받지 못함' }); continue; }
    closePopup();
    const d = downloads[downloads.length - 1];
    if (d.state !== 'completed') { skipped.push({ team, why: '내려받지 못함' }); continue; }
    try {
      const buf = fs.readFileSync(d.path);
      files.push({ team, name: d.name, size: buf.length, base64: buf.toString('base64') });
    } finally { try { fs.unlinkSync(d.path); } catch (_) {} }
  }
  downloads.length = 0;
  return { files, skipped, teams: all, start: a.start, end: a.end };
}

/* ─── 창구: 한 번에 하나씩 ─── */
const CMDS = {
  orders, fill, submit, download,
  test: async () => { closeWin(); await login(); return { id: (readCred() || {}).id }; }
};
function run(cmd, a) {
  const job = chain.catch(() => {}).then(async () => {
    running = cmd; touch();
    try { return await CMDS[cmd](a || {}); } finally { running = ''; touch(); }
  });
  chain = job;
  return job;
}
function status() {
  const c = readCred();
  return { v: 1, hasCred: !!c, id: c ? c.id : '', safe: safeStorage.isEncryptionAvailable(), open: !!(aw && !aw.isDestroyed()), running, filled: filled ? { date: filled.date, count: filled.n } : null, maxRows: MAX_ROWS, memoMax: MEMO_MAX, divi: Object.keys(DIVI), job: Object.keys(JOB) };
}

/** main.js 에서 한 번 부른다. allowed(e): 우리 웹 화면(메인 창 · 같은 서버)에서 온 호출인지 */
function init(ipcMain, allowed) {
  ipcMain.handle('wm:aw', async (e, cmd, a) => {
    if (!allowed(e)) return { ok: false, code: 'DENY', error: '허용되지 않은 호출입니다' };
    try {
      cmd = String(cmd || '');
      if (cmd === 'status') return Object.assign({ ok: true }, status());
      if (cmd === 'cred-set') {
        const id = String((a && a.id) || '').trim(), pw = String((a && a.pw) || '');
        if (!id || !pw || id.length > 60 || pw.length > 200) throw E('BAD', '아이디 · 비밀번호를 넣어 주세요');
        writeCred(id, pw); closeWin();
        return Object.assign({ ok: true }, status());
      }
      if (cmd === 'cred-clear') { clearCred(); closeWin(); return Object.assign({ ok: true }, status()); }
      if (cmd === 'close') { closeWin(); return { ok: true }; }
      if (!CMDS[cmd]) throw E('BAD', '모르는 명령입니다');
      return Object.assign({ ok: true }, await run(cmd, a));
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'ERR', error: String((err && err.message) || err).slice(0, 300) };
    }
  });
  app.on('before-quit', closeWin);
}

module.exports = { init, _test: { run, status, writeCred, readCred, clearCred, closeWin } };
