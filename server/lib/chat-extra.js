/**
 * 💬 메신저 덧붙임 (v13.378) — 링크 미리보기 · 달력으로 정하는 상태
 *
 * ① 링크 미리보기: 서버가 대신 페이지를 읽어 og:title · description · image · site_name 을 꺼냄
 *    - http/https 만, 사내망 · 사설 주소(10. · 172.16~31. · 192.168. · 127. · 169.254. · ::1 · fc00::/7 · fe80::) 는 막음 (DNS 로 푼 뒤 검사)
 *    - 4초 · 512KB 까지만 읽음 · HTML 만 · 넘겨주기는 3번까지(매번 다시 검사) · 하루 담아 둠
 *    - 사진은 화면 보안 정책상 바깥 주소를 바로 못 띄우므로 linkImage() 로 서버가 대신 받아 줌(1MB · image/* 만)
 * ② 상태: 오늘 달력(일정의 담당 이름)에서 회의 · 검토(시각 안) · 출장 · 현장출동 · 연차 · 반차 → { icon, label, until }
 *    - 일정 제목은 보여 주지 않음(다른 사람에게는 "회의 중"만)
 */
var dns = require('dns').promises;
var net = require('net');
var db = require('../config/db');

/* ─── ① 링크 미리보기 ─── */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    var p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  var s = ip.toLowerCase();
  if (s.indexOf('::ffff:') === 0) return privateIp(s.slice(7));
  return s === '::1' || s === '::' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}
async function safeUrl(u) {
  var url; try { url = new URL(u); } catch (e) { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && ['80', '443', '8080', '8443'].indexOf(url.port) < 0) return null;
  var host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return null;
  var addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(function () { return []; });
  if (!addrs.length || addrs.some(function (a) { return privateIp(a.address); })) return null;
  return url;
}
async function fetchSafe(u, accept, maxBytes) {
  var cur = u;
  for (var hop = 0; hop < 4; hop++) {
    var url = await safeUrl(cur); if (!url) return null;
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 4000);
    try {
      var res = await fetch(url.href, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'WorkManager-LinkPreview/1.0', Accept: accept, 'Accept-Language': 'ko,en;q=0.8' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { cur = new URL(res.headers.get('location'), url).href; clearTimeout(t); continue; }
      if (!res.ok || !res.body) { clearTimeout(t); return null; }
      var reader = res.body.getReader(), chunks = [], n = 0;
      for (;;) { var x = await reader.read(); if (x.done) break; n += x.value.length; if (n > maxBytes) { try { reader.cancel(); } catch (e) {} break; } chunks.push(Buffer.from(x.value)); }
      clearTimeout(t);
      return { url: url.href, type: res.headers.get('content-type') || '', buf: Buffer.concat(chunks) };
    } catch (e) { clearTimeout(t); return null; }
  }
  return null;
}
function decodeEnt(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
    e = e.toLowerCase();
    if (e[0] === '#') { var c = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c ? String.fromCodePoint(c) : ''; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e];
  }).replace(/\s+/g, ' ').trim();
}
function meta(html, names) {
  for (var i = 0; i < names.length; i++) {
    var re = new RegExp('<meta[^>]+(?:property|name)=["\']' + names[i].replace(/[:.]/g, '\\$&') + '["\'][^>]*>', 'i'), m = re.exec(html);
    if (m) { var c = /content=["']([^"']*)["']/i.exec(m[0]); if (c && c[1].trim()) return decodeEnt(c[1]); }
  }
  return '';
}
var PREV = new Map();
async function linkPreview(u) {
  var c = PREV.get(u); if (c && c.exp > Date.now()) return c.v;
  var r = await fetchSafe(u, 'text/html,application/xhtml+xml', 512 * 1024), v = null;
  if (r && /html/i.test(r.type)) {
    var cs = (/charset=([\w-]+)/i.exec(r.type) || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(r.buf.slice(0, 2048).toString('latin1')) || [])[1] || 'utf-8';
    var html; try { html = new TextDecoder(cs.toLowerCase() === 'ks_c_5601-1987' ? 'euc-kr' : cs).decode(r.buf); } catch (e) { html = r.buf.toString('utf8'); }
    var title = meta(html, ['og:title', 'twitter:title']) || decodeEnt((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1]);
    if (title) {
      var img = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
      try { if (img) img = new URL(img, r.url).href; } catch (e) { img = ''; }
      v = { url: u, title: title.slice(0, 200), desc: meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 300), site: (meta(html, ['og:site_name']) || new URL(r.url).hostname).slice(0, 80), image: /^https?:/.test(img) ? img.slice(0, 600) : null };
    }
  }
  PREV.set(u, { v: v, exp: Date.now() + (v ? 864e5 : 36e5) }); if (PREV.size > 3000) PREV.clear();
  return v;
}
async function linkImage(u) {
  var r = await fetchSafe(u, 'image/*', 1024 * 1024);
  if (!r || !/^image\/(png|jpe?g|gif|webp)/i.test(r.type) || r.buf.length >= 1024 * 1024) return null;
  return { type: r.type.split(';')[0], buf: r.buf };
}
/** 글에서 첫 주소 */
function firstUrl(body) { var m = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/i.exec(String(body || '')); return m ? m[1].slice(0, 1000) : null; }

/* ─── ② 달력으로 정하는 상태 ─── */
var BUSY = { meeting: ['🤝', '회의 중'], review: ['🔍', '검토 중'], trip: ['✈️', '출장'], fieldService: ['🔧', '현장 출동'], dayoff: ['🌴', '연차'], amoff: ['🌅', '오전 반차'], pmoff: ['🌇', '오후 반차'] };
function kstNow() { var d = new Date(Date.now() + 9 * 36e5); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; }
var CAL = new Map();
/** tenantId, [{id, names:[이름들]}] → { uid: {icon,label,until} } (1분 담아 둠) */
/** 오늘 바쁜 일정 (1분 담아 둠 · 같은 때 여러 요청은 한 번만) — v13.382 방 열기와 같이 미리 받기 */
function calRows(tenantId) {
  var now = kstNow(), key = tenantId + ':' + now.date + now.hm;
  var c = CAL.get(tenantId);
  if (c && c.key === key) return c.p;
  var p = db.query("SELECT type, start_time, end_time, assignees FROM events WHERE tenant_id = $1 AND type = ANY($2) AND start_date <= $3 AND COALESCE(NULLIF(end_date, ''), start_date) >= $3",
    [tenantId, Object.keys(BUSY), now.date]).then(function (r) { return r.rows; }, function () { return []; });
  CAL.set(tenantId, { key: key, p: p }); if (CAL.size > 500) CAL.clear();
  return p;
}
async function calStatus(tenantId, users) {
  if (!users || !users.length) return {};
  var now = kstNow(), rows = await calRows(tenantId);
  var out = {};
  users.forEach(function (u) {
    var names = (u.names || []).filter(Boolean);
    rows.forEach(function (e) {
      var as = Array.isArray(e.assignees) ? e.assignees : [];
      if (!as.some(function (a) { return names.indexOf(String(a && a.name || a).trim()) >= 0 || a === u.id || (a && a.id === u.id); })) return;
      var b = BUSY[e.type], until = null;
      if (e.type === 'meeting' || e.type === 'review') {
        if (!e.start_time || !e.end_time || now.hm < e.start_time || now.hm >= e.end_time) return;   // 회의는 시각 안일 때만
        until = e.end_time;
      }
      if (e.type === 'amoff' && now.hm >= '13:00') return;
      if (e.type === 'pmoff' && now.hm < '13:00') return;
      var prev = out[u.id];
      if (!prev || prev.prio < (until ? 2 : 1)) out[u.id] = { icon: b[0], label: b[1], until: until, auto: true, prio: until ? 2 : 1 };
    });
    if (out[u.id]) delete out[u.id].prio;
  });
  return out;
}

module.exports = { linkPreview: linkPreview, linkImage: linkImage, firstUrl: firstUrl, calStatus: calStatus, calRows: calRows, _privateIp: privateIp, _safeUrl: safeUrl, BUSY: BUSY };
