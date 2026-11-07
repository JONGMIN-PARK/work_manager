/**
 * 텔레그램 메시지 → 웹 바로 열기 링크 (v13.305)
 *   APP_URL (없으면 CORS_ORIGIN 첫 값) + ?go=종류:id  → 웹이 로그인 뒤 그 항목을 연다 (app-init.js wmDeepGo)
 *   https 주소일 때만 만든다 — 텔레그램은 localhost · http 링크 버튼을 거부해 메시지 전체가 실패한다.
 */
var TYPES = { issue: 1, project: 1, as: 1, message: 1, todo: 1, mywork: 1, chat: 1 };

function appUrl() {
  var raw = process.env.APP_URL || String(process.env.CORS_ORIGIN || '').split(',')[0];
  raw = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(raw)) return '';
  if (/localhost|127\.0\.0\.1/i.test(raw)) return '';
  return raw;
}

/** 웹 주소 — 첫 화면 파일까지 (GitHub Pages 는 폴더 주소로 열면 index 가 아닐 수 있어 이름을 붙임) */
function pageUrl() {
  var base = appUrl();
  if (!base) return '';
  if (/\.html?$/i.test(base)) return base;
  var page = process.env.APP_PAGE || '업무일지_분석기.html';
  return base + '/' + encodeURIComponent(page);
}

function goUrl(type, id) {
  var page = pageUrl();
  if (!page || !TYPES[type]) return '';
  return page + '?go=' + encodeURIComponent(type + (id ? ':' + id : ''));
}

/** 알림 payload 에서 열 항목 고르기 */
function targetOf(eventType, p) {
  p = p || {};
  if (p.issueId) return ['issue', p.issueId];
  if (p.ticketId) return ['as', p.ticketId];
  if (eventType === 'message_received' && p.fromUserId) return ['message', p.fromUserId];
  if ((eventType === 'chat_message' || eventType === 'chat_remind' || eventType === 'chat_req_nudge') && p.roomId) return ['chat', p.roomId];   // v13.315 메신저 대화방 · v13.362 다시 알림
  if (p.projectId) return ['project', p.projectId];
  return null;
}

/** 인라인 버튼 한 줄 [🌐 웹에서 열기] — 만들 수 없으면 null */
function webRow(type, id) {
  var u = goUrl(type, id);
  return u ? [{ text: '🌐 웹에서 열기', url: u }] : null;
}

/** sendOpts.reply_markup(문자열 또는 객체)에 버튼 줄을 덧붙임 */
function addRow(sendOpts, row) {
  if (!row) return sendOpts;
  var o = Object.assign({}, sendOpts || {});
  var rm = o.reply_markup ? (typeof o.reply_markup === 'string' ? JSON.parse(o.reply_markup) : o.reply_markup) : { inline_keyboard: [] };
  rm.inline_keyboard = (rm.inline_keyboard || []).concat([row]);
  o.reply_markup = JSON.stringify(rm);
  return o;
}

module.exports = { appUrl: appUrl, pageUrl: pageUrl, goUrl: goUrl, targetOf: targetOf, webRow: webRow, addRow: addRow };
