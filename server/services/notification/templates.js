/**
 * 알림 템플릿 — 이벤트별 텔레그램 HTML 메시지, 이메일/인앱 제목, 텔레그램 인라인 버튼.
 * 순수 함수/상수만 (DB·네트워크 없음). notification.service.js 가 다시 내보낸다.
 */
var escHtml = require('../../telegram/util/escape').escHtml;

/* 작업 노트 경량 서식(마크다운 일부) → 텔레그램 HTML. 웹 표시(wmRichNote)와 동일 규칙.
   체크박스 ☐/☑, **굵게**, ~~취소선~~, ==형광==(텍스트), [중요]등 배지(텍스트), 글머리표 •. */
function noteToTgHtml(note) {
  if (note == null) return '';
  var lines = escHtml(String(note)).split('\n');
  var out = lines.map(function (ln) {
    var cm = ln.match(/^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/);
    if (cm) return (cm[2].toLowerCase() === 'x' ? '☑ ' : '☐ ') + cm[3];
    var lm = ln.match(/^(\s*)[-*]\s+(.*)$/);
    if (lm) return lm[1] + '• ' + lm[2];
    return ln;
  });
  return out.join('\n')
    .replace(/\*\*([^\n*]+)\*\*/g, '<b>$1</b>')
    .replace(/~~([^\n~]+)~~/g, '<s>$1</s>')
    .replace(/==([^\n=]+)==/g, '$1')
    .replace(/`([^\n`]+)`/g, '<code>$1</code>')
    .replace(/\[(중요|긴급|주의|완료|진행)\]/g, '【$1】');
}

/** 이벤트 메시지 템플릿
 *  사용자 발 필드는 모두 escHtml()로 감싸 텔레그램 HTML 파서가 깨지지 않도록 함.
 *  단, p.content 류(event_today / weekly_digest / as_weekly_digest)는 호출자가 이미
 *  <b>/<code> 등 마크업을 안전하게 조립한 HTML이므로 raw 유지(이중 escape 회피).
 *  분기 비교용 enum(p.urgency, p.priority)도 raw 유지.
 */
var TEMPLATES = {
  issue_assigned: function (p) {
    var icon = p.urgency === 'urgent' ? '🔴' : p.urgency === 'normal' ? '🟡' : '🟢';
    return icon + ' <b>이슈 배정</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      '제목: ' + escHtml(p.title) + '\n' +
      '담당: ' + (p.assignee ? escHtml(p.assignee) : '-');
  },
  issue_status_changed: function (p) {
    return '🔵 <b>이슈 상태 변경</b>\n' +
      escHtml(p.title) + '\n' +
      escHtml(p.fromStatus) + ' → ' + escHtml(p.toStatus);
  },
  project_delayed: function (p) {
    return '⚠️ <b>프로젝트 지연</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '예정 납기: ' + (p.endDate ? escHtml(p.endDate) : '-');
  },
  deadline_d3: function (p) {
    return '⏰ <b>납기 D-3</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '납기일: ' + escHtml(p.endDate);
  },
  deadline_d1: function (p) {
    return '🔔 <b>내일 납기!</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '납기일: ' + escHtml(p.endDate);
  },
  deadline_today: function (p) {
    return '🏁 <b>오늘 납기일</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name);
  },
  user_pending: function (p) {
    return '👤 <b>신규 가입 승인 요청</b>\n' +
      '이름: ' + escHtml(p.userName) + '\n' +
      (p.department ? '부서: ' + escHtml(p.department) : '');
  },
  milestone_complete: function (p) {
    return '✅ <b>마일스톤 완료</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.milestoneName);
  },
  weekly_report_uploaded: function (p) {
    return '📋 <b>주간업무보고 등록</b>\n' +
      escHtml(p.team || '(팀 미지정)') + (p.weekLabel ? ' <code>' + escHtml(p.weekLabel) + '</code>' : '') + '\n' +
      '총 ' + escHtml(p.count) + '건' +
      (p.done != null ? ' (완료 ' + escHtml(p.done) + ')' : '') +
      (p.uploader ? ' · 작성 ' + escHtml(p.uploader) : '') + '\n' +
      '💡 /wr 로 확인';
  },
  dev_item_assigned: function (p) {
    return '🧩 <b>개발 아이템 배정</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      escHtml(p.title);
  },
  action_item_assigned: function (p) {
    return '📌 <b>액션아이템 배정</b>\n' +
      (p.meetingTitle ? '[' + escHtml(p.meetingTitle) + '] ' : '') + escHtml(p.title) +
      (p.dueDate ? '\n기한: ' + escHtml(p.dueDate) : '');
  },
  action_item_due: function (p) {
    return '⏰ <b>액션아이템 기한 D-1</b>\n' +
      (p.meetingTitle ? '[' + escHtml(p.meetingTitle) + '] ' : '') + escHtml(p.title) +
      '\n기한: ' + escHtml(p.dueDate);
  },
  prestudy_assigned: function (p) {
    return '🔍 <b>사전검토 배정</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      (p.dueDate ? '\n회신기한: ' + escHtml(p.dueDate) : '');
  },
  prestudy_due: function (p) {
    return '⏰ <b>사전검토 회신기한 D-1</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      '\n기한: ' + escHtml(p.dueDate);
  },
  prestudy_won: function (p) {
    return '🎉 <b>사전검토 확정</b>\n' +
      (p.client ? '[' + escHtml(p.client) + '] ' : '') + escHtml(p.title) +
      '\n프로젝트/수주로 전환되었습니다.';
  },
  tech_assigned: function (p) {
    return '🧪 <b>요소기술 담당 배정</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name);
  },
  tech_log_added: function (p) {
    return '📓 <b>요소기술 개발일지</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      (p.authorName ? '작성: ' + escHtml(p.authorName) : '') +
      (p.progress != null ? ' · 진척 ' + escHtml(p.progress) + '%' : '') +
      (p.content ? '\n📝 ' + noteToTgHtml(String(p.content).slice(0, 300)) : '');
  },
  tech_status_changed: function (p) {
    return '🔄 <b>요소기술 상태 변경</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      escHtml(p.fromLabel) + ' → <b>' + escHtml(p.toLabel) + '</b>' +
      (p.trl != null ? ' (TRL ' + escHtml(p.trl) + ')' : '');
  },
  tech_stale: function (p) {
    return '🕸 <b>요소기술 일지 미작성</b>\n' +
      (p.code ? '<code>' + escHtml(p.code) + '</code> ' : '') + escHtml(p.name) + '\n' +
      escHtml(p.days) + '일간 개발일지가 없습니다.';
  },
  event_today: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return '☀️ <b>오늘 브리핑</b>\n\n' + (p.content || '');
  },
  order_delivery_d7: function (p) {
    return '📦 <b>납품 D-7</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + (p.client ? escHtml(p.client) : '') + '\n' +
      '납품일: ' + escHtml(p.delivery);
  },
  order_delivery_d3: function (p) {
    return '📦 <b>납품 D-3!</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + (p.client ? escHtml(p.client) : '') + '\n' +
      '납품일: ' + escHtml(p.delivery);
  },
  weekly_digest: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return '📊 <b>주간 다이제스트</b>\n\n' + (p.content || '');
  },
  progress_warning: function (p) {
    return '📉 <b>진행률 경고</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.name) + '\n' +
      '현재 ' + escHtml(p.progress) + '% (기대 ' + escHtml(p.expected) + '%)';
  },
  // ─── A/S 모듈 (v13.49) ───
  as_received: function (p) {
    var icon = p.priority === 'P1' ? '🚨' : p.priority === 'P2' ? '🔴' : '🟡';
    return icon + ' <b>A/S 신규 접수</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      (p.equipmentModel ? escHtml(p.equipmentModel) + '\n' : '') +
      '카테고리: ' + (p.categoryLabel ? escHtml(p.categoryLabel) : (p.category ? escHtml(p.category) : '-')) + '\n' +
      '증상: ' + escHtml((p.summary || '').slice(0, 100));
  },
  as_assigned: function (p) {
    return '📌 <b>A/S 할당</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '담당: ' + (p.assignee ? escHtml(p.assignee) : '-') + ' (' + (p.deptLabel ? escHtml(p.deptLabel) : (p.dept ? escHtml(p.dept) : '')) + ')' +
      (p.promisedAt ? '\n약속: ' + escHtml(p.promisedAt) : '');
  },
  as_sla_breach: function (p) {
    return '⏰ <b>A/S SLA 초과</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + escHtml(p.priority) + ' · ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '경과 ' + escHtml(p.elapsedH) + 'h (' + escHtml(p.priority) + ' 목표 ' + escHtml(p.slaH) + 'h)';
  },
  as_customer_wait: function (p) {
    return '📞 <b>A/S 고객 확인 D+3 미회신</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + (p.customerName ? escHtml(p.customerName) : '');
  },
  as_report_issued: function (p) {
    return '📄 <b>A/S 보고서 발행</b>\n' +
      '[' + escHtml(p.ticketNo) + '] ' + (p.customerName ? escHtml(p.customerName) : '') + '\n' +
      '발행자: ' + (p.author ? escHtml(p.author) : '-');
  },
  as_weekly_digest: function (p) {
    // p.content는 호출자가 조립한 사전-안전 HTML — raw 유지
    return p.content || '📊 <b>A/S 주간 요약</b>';
  },
  // ─── 코멘트/프로젝트 이벤트 (v13.x) ───
  comment_added: function (p) {
    return '💬 <b>새 피드백</b>\n' +
      (p.targetName ? escHtml(p.targetName) + '\n' : '') +
      (p.authorName ? '작성: ' + escHtml(p.authorName) + '\n' : '') +
      escHtml((p.body || '').slice(0, 300));
  },
  message_received: function (p) {
    return '✉️ <b>새 메시지</b>\n' +
      (p.fromName ? escHtml(p.fromName) + ' 님\n' : '') +
      escHtml((p.body || '').slice(0, 300));
  },
  project_created: function (p) {
    return '🆕 <b>프로젝트 생성</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.projectName || p.name);
  },
  project_updated: function (p) {
    return '✏️ <b>프로젝트 수정</b>\n' +
      (p.orderNo ? '[' + escHtml(p.orderNo) + '] ' : '') + escHtml(p.projectName || p.name) +
      (p.summary ? '\n' + escHtml(p.summary) : '');
  },
  milestone_progress: function (p) {
    return '📈 <b>마일스톤 진척 보고</b>\n' +
      (p.projectName ? escHtml(p.projectName) + '\n' : '') +
      (p.milestoneName ? escHtml(p.milestoneName) + '\n' : '') +
      '진척률: ' + escHtml(p.progress) + '%' +
      (p.hours ? ' · 투입 ' + escHtml(p.hours) + 'h' : '') +
      (p.authorName ? '\n보고: ' + escHtml(p.authorName) : '') +
      (p.note ? '\n📝 ' + noteToTgHtml(p.note) : '');
  }
};

/** 이벤트별 제목 (이메일/인앱용) */
var EVENT_TITLES = {
  message_received: '새 메시지가 도착했습니다',
  issue_assigned: '이슈가 배정되었습니다',
  issue_status_changed: '이슈 상태가 변경되었습니다',
  project_delayed: '프로젝트가 지연되고 있습니다',
  deadline_d3: '납기 D-3 알림',
  deadline_d1: '내일 납기일입니다',
  deadline_today: '오늘 납기일입니다',
  user_pending: '신규 가입 승인 요청',
  milestone_complete: '마일스톤이 완료되었습니다',
  weekly_report_uploaded: '주간업무보고가 등록되었습니다',
  dev_item_assigned: '개발 아이템이 배정되었습니다',
  action_item_assigned: '액션아이템이 배정되었습니다',
  action_item_due: '액션아이템 기한이 임박했습니다',
  prestudy_assigned: '사전검토가 배정되었습니다',
  prestudy_due: '사전검토 회신기한이 임박했습니다',
  prestudy_won: '사전검토가 확정되었습니다',
  tech_assigned: '요소기술 담당으로 배정되었습니다',
  tech_log_added: '요소기술 개발일지가 등록되었습니다',
  tech_status_changed: '요소기술 상태가 변경되었습니다',
  tech_stale: '요소기술 개발일지가 오래 비어 있습니다',
  order_delivery_d7: '납품 D-7 알림',
  order_delivery_d3: '납품 D-3 알림',
  weekly_digest: '주간 다이제스트',
  progress_warning: '진행률 경고',
  as_received: 'A/S 신규 접수',
  as_assigned: 'A/S 할당',
  as_sla_breach: 'A/S SLA 초과',
  as_customer_wait: 'A/S 고객 확인 미회신',
  as_report_issued: 'A/S 보고서 발행',
  as_weekly_digest: 'A/S 주간 요약',
  comment_added: '새 피드백이 등록되었습니다',
  project_created: '프로젝트가 생성되었습니다',
  project_updated: '프로젝트가 수정되었습니다',
  milestone_progress: '마일스톤 진척이 보고되었습니다'
};

// 이벤트별 텔레그램 인라인 버튼 옵션 — 순수 함수 (side-effect 없음)
function buildTelegramSendOpts(eventType, payload) {
  var sendOpts = {};
  if (eventType === 'issue_assigned' && payload.issueId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [
        [
          { text: '🔵 대응 시작', callback_data: 'issue_start:' + payload.issueId },
          { text: '✅ 해결 완료', callback_data: 'issue_resolve:' + payload.issueId }
        ]
      ]
    });
  }
  if (eventType === 'dev_item_assigned' && payload.devItemId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: '🔵 진행 시작', callback_data: 'dev_start:' + payload.devItemId }]]
    });
  }
  if ((eventType === 'action_item_assigned' || eventType === 'action_item_due') && payload.actionId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: '✅ 완료', callback_data: 'action_done:' + payload.actionId }]]
    });
  }
  if (eventType === 'user_pending' && payload.pendingUserId) {
    sendOpts.reply_markup = JSON.stringify({
      inline_keyboard: [
        [
          { text: '✅ 승인', callback_data: 'approve_user:' + payload.pendingUserId },
          { text: '❌ 반려', callback_data: 'reject_user:' + payload.pendingUserId }
        ]
      ]
    });
  }
  return sendOpts;
}

module.exports = {
  TEMPLATES: TEMPLATES,
  EVENT_TITLES: EVENT_TITLES,
  noteToTgHtml: noteToTgHtml,
  buildTelegramSendOpts: buildTelegramSendOpts
};
