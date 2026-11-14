/**
 * 📲 휴대폰 · 브라우저 푸시 (Web Push, v13.359)
 *   앱(PWA)을 닫아 두어도 알림이 온다 — 안드로이드 크롬 · 아이폰(iOS 16.4+, 홈 화면에 설치한 앱) · PC 크롬/엣지
 *   VAPID 키: 환경변수 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, 없으면 처음 한 번 만들어 DB(app_keys)에 둔다 (재시작해도 같은 키)
 *   보내기: sendToUsers(userIds, { title, body, tag, go }) — 실패한 구독(만료 · 해지 404/410)은 지운다
 */
var webpush = require('web-push');
var db = require('../config/db');

var _keys = null;
async function keys() {
  if (_keys) return _keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) _keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else {
    var r = await db.query("SELECT value FROM app_keys WHERE name = 'vapid'");
    if (!r.rows.length) {
      await db.query("INSERT INTO app_keys (name, value) VALUES ('vapid', $1) ON CONFLICT (name) DO NOTHING", [JSON.stringify(webpush.generateVAPIDKeys())]);
      r = await db.query("SELECT value FROM app_keys WHERE name = 'vapid'");
    }
    _keys = JSON.parse(r.rows[0].value);
  }
  var subject = /^https:/.test(process.env.APP_URL || '') ? process.env.APP_URL : (process.env.VAPID_SUBJECT || 'mailto:noreply@work-manager.app');
  webpush.setVapidDetails(subject, _keys.publicKey, _keys.privateKey);
  return _keys;
}
async function publicKey() { return (await keys()).publicKey; }

async function subscribe(user, tenantId, sub, ua) {
  if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw Object.assign(new Error('구독 정보가 올바르지 않습니다.'), { status: 400 });
  await db.query('INSERT INTO push_subs (endpoint, user_id, tenant_id, p256dh, auth, ua) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, tenant_id = EXCLUDED.tenant_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, ua = EXCLUDED.ua',
    [String(sub.endpoint).slice(0, 2000), user, tenantId || null, String(sub.keys.p256dh).slice(0, 300), String(sub.keys.auth).slice(0, 100), String(ua || '').slice(0, 200)]);
}
async function unsubscribe(user, endpoint) { await db.query('DELETE FROM push_subs WHERE endpoint = $1 AND user_id = $2', [String(endpoint || ''), user]); }
async function count(user) { var r = await db.query('SELECT COUNT(*)::int AS n FROM push_subs WHERE user_id = $1', [user]); return r.rows[0].n; }

var _sender = null;   // 시험에서 바꿔 끼움
function _setSender(fn) { _sender = fn; }

/** userIds 에게 푸시 — 기다리지 않아도 됨(실패는 기록만) */
async function sendToUsers(userIds, payload) {
  if (!userIds || !userIds.length) return 0;
  return _send('SELECT endpoint, p256dh, auth, user_id FROM push_subs WHERE user_id = ANY($1)', [userIds], payload);
}
/** v13.501 구독한 모든 기기에 (새 버전 알림) */
async function sendToAll(payload) {
  return _send('SELECT endpoint, p256dh, auth, user_id FROM push_subs', [], payload);
}
async function _send(sql, args, payload) {
  try {
    var r = await db.query(sql, args);
    if (!r.rows.length) return 0;
    await keys();
    var body = JSON.stringify({ title: String(payload.title || '업무 관리자').slice(0, 120), body: String(payload.body || '').slice(0, 300), tag: payload.tag || undefined, go: payload.go || '', kind: payload.kind || undefined });
    var sent = 0;
    await Promise.all(r.rows.map(function (s) {
      var sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      var p = new Promise(function (ok) { ok(_sender ? _sender(sub, body) : webpush.sendNotification(sub, body, { TTL: 6 * 3600, urgency: 'high' })); });
      return p.then(function () { sent++; return db.query('UPDATE push_subs SET last_ok_at = now() WHERE endpoint = $1', [s.endpoint]); })
        .catch(function (e) {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) return db.query('DELETE FROM push_subs WHERE endpoint = $1', [s.endpoint]);   // 해지 · 만료
          console.warn('[push] 보내기 실패', e && (e.statusCode || e.message));
        });
    }));
    return sent;
  } catch (e) { console.error('[push]', e.message); return 0; }
}

module.exports = { publicKey: publicKey, subscribe: subscribe, unsubscribe: unsubscribe, count: count, sendToUsers: sendToUsers, sendToAll: sendToAll, _setSender: _setSender };
