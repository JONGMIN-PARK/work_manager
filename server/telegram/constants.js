/**
 * 텔레그램 봇 상수
 */

/** 업무분장 코드 */
var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };

/** 긴급도 아이콘 */
var URGENCY_ICON = { urgent: '🔴', normal: '🟡', low: '🟢' };

/** 프로젝트 상태 */
var STATUS_MAP = { waiting: '⏳ 대기', active: '🔵 진행중', delayed: '⚠️ 지연', done: '✅ 완료', hold: '⏸ 보류' };

/** 이벤트 유형 아이콘 */
var EVENT_ICONS = { milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️', fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴', amoff: '🌅', pmoff: '🌇', etc: '📌' };

/** 이슈 상태 */
var ISSUE_STATUS_MAP = { open: '🟠접수', inProgress: '🔵대응중', resolved: '✅해결', closed: '⬜종결', hold: '⏸보류' };

/** 요일 이름 */
var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 조회 제한 */
var LIMITS = {
  ISSUES_MY: 5,
  ISSUES_FULL: 10,
  PROJECTS_LIST: 15,
  PEOPLE_TOP: 10,
  EVENTS: 20,
  MILESTONES: 8,
  ORDERS: 15,
  DOCS: 10,
  DEADLINES: 5,
  OVERDUE: 10
};

module.exports = {
  AM: AM,
  URGENCY_ICON: URGENCY_ICON,
  STATUS_MAP: STATUS_MAP,
  EVENT_ICONS: EVENT_ICONS,
  ISSUE_STATUS_MAP: ISSUE_STATUS_MAP,
  DAY_NAMES: DAY_NAMES,
  LIMITS: LIMITS
};
