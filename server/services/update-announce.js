/**
 * ⬆ 새 버전 알림 푸시 (v13.501) — 새로 배포된 서버가 켜질 때 한 번, 알림을 켜 둔 모든 휴대폰 · 브라우저에 보냄
 *   앱을 안 열어 두어도(백그라운드) 홈 화면 · 잠금 화면 알림 + 앱 아이콘 표시. 누르면 새 화면으로 열림.
 *   여러 대가 동시에 켜져도 한 번만 — app_keys('last_version') 를 바꾼 쪽만 보냄. 버전(WM_VERSION)이 바뀔 때만(시험만 바꾼 커밋은 조용히).
 *   처음(기록이 없을 때)은 적어 두기만 함.
 */
var db = require('../config/db');
var push = require('./push.service');

async function announce(info) {
  if (!info || !info.version) return { sent: 0, skip: 'no-version' };
  var r = await db.query(
    "INSERT INTO app_keys (name, value) VALUES ('last_version', $1) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value " +
    "WHERE app_keys.value IS DISTINCT FROM EXCLUDED.value RETURNING (xmax = 0) AS fresh", [String(info.version)]);
  if (!r.rows.length) return { sent: 0, skip: 'same' };
  if (r.rows[0].fresh) return { sent: 0, skip: 'first' };
  var desk = info.desktop && info.desktop.version ? ' · PC 앱 v' + info.desktop.version : '';
  var sent = await push.sendToAll({
    title: '⬆ 업무 관리자 새 버전 v' + info.version,
    body: '누르면 새 화면으로 열립니다' + desk,
    tag: 'wm-update', go: 'update', kind: 'update'
  });
  console.log('[update-push] v' + info.version + ' 알림 ' + sent + '대');
  return { sent: sent };
}
module.exports = { announce: announce };
