/**
 * /help 명령어 모듈
 */

/** 명령어별 상세 도움말 */
var CMD_HELP = {
  log: {
    title: '/log — 업무일지 빠른 등록',
    usage: '/log {시간}h {분장} {수주번호} {내용}\n또는 바로: 8h D B2024-001 업무내용',
    format: '시간: 0.5~24 (소수 가능)\n분장: A(CS현장) B(수주) D(개발) G(공통) M(양산) R(제안) S(영업지원)\n수주번호: 선택사항',
    examples: ['4.5h A 현장 점검', '8h D B2024-001 카메라 보정', '2h G 주간회의 참석', '1.5h S B2024-003 견적 작성'],
    tip: '/summary 로 금주 합계를 확인하세요!'
  },
  today: {
    title: '/today — 오늘 브리핑',
    usage: '/today',
    format: '오늘 일정 + 긴급 이슈 + 납기를 한눈에',
    examples: [],
    tip: '/calendar 로 이번 주 전체 일정도 확인!'
  },
  my: {
    title: '/my — 내 현황',
    usage: '/my',
    format: '미해결 이슈 + 임박 납기(7일) 요약',
    examples: [],
    tip: '/issues 로 이슈 상세, /overdue 로 지연 현황'
  },
  issues: {
    title: '/issues — 미해결 이슈 목록',
    usage: '/issues',
    format: '나에게 배정된 미해결 이슈 (최대 10건)',
    examples: [],
    tip: '/done 으로 작업 완료, /today 로 오늘 전체 현황'
  },
  tasks: {
    title: '/tasks — 미완료 작업',
    usage: '/tasks',
    format: '프로젝트별 미완료 체크리스트 항목',
    examples: [],
    tip: '/done 번호 로 완료 처리!'
  },
  done: {
    title: '/done — 작업 완료 처리',
    usage: '/done {번호}',
    format: '/tasks 에서 표시된 번호를 입력',
    examples: ['/done 1', '/done 3'],
    tip: '/tasks 로 남은 작업 확인'
  },
  summary: {
    title: '/summary — 금주 업무시간 요약',
    usage: '/summary',
    format: '업무분장별·일별·수주별 바차트',
    examples: [],
    tip: '/report 로 월간 리포트, /my-stats 로 개인 통계'
  },
  report: {
    title: '/report — 월간 리포트',
    usage: '/report',
    format: '이번 달 핵심수치, 분장분포, 인원Top10',
    examples: [],
    tip: '/weekly-report 로 보고서 형태 생성'
  },
  'weekly-report': {
    title: '/weekly-report — 주간보고 생성',
    usage: '/weekly-report 또는 /weekly_report',
    format: '복사해서 바로 보고 가능한 형태',
    examples: [],
    tip: '매주 금요일에 사용하면 편리합니다!'
  },
  'my-stats': {
    title: '/my-stats — 내 월간 통계',
    usage: '/my-stats 또는 /my_stats',
    format: '업무분장 바차트 + 주간 추이',
    examples: [],
    tip: '/summary 는 팀 전체, /my-stats 는 개인'
  },
  overdue: {
    title: '/overdue — 지연/긴급 현황',
    usage: '/overdue',
    format: '지연 프로젝트 + 납기초과 + 긴급이슈',
    examples: [],
    tip: '/project 이름 으로 상세 확인'
  },
  project: {
    title: '/project — 프로젝트 현황',
    usage: '/project\n/project {이름 또는 수주번호}',
    format: '이름 없으면 목록, 있으면 상세',
    examples: ['/project', '/project SK하이닉스', '/project B2024-001'],
    tip: '/checklist 이름 으로 체크리스트 확인'
  },
  checklist: {
    title: '/checklist — 체크리스트',
    usage: '/checklist {프로젝트명}',
    format: '프로젝트별 단계 체크리스트 진행률',
    examples: ['/checklist SK하이닉스'],
    tip: '/done 으로 항목 완료 처리'
  },
  calendar: {
    title: '/calendar — 일정 조회',
    usage: '/calendar\n/calendar {일수}',
    format: '기본 7일, 숫자 지정 가능',
    examples: ['/calendar', '/calendar 14', '/calendar 30'],
    tip: '/today 로 오늘만 빠르게 확인'
  },
  orders: {
    title: '/orders — 수주 목록',
    usage: '/orders',
    format: '진행중 수주 (납품일 순, 최대 15건)',
    examples: [],
    tip: '/order 번호 로 상세, /deliveries 로 납품 예정'
  },
  order: {
    title: '/order — 수주 상세',
    usage: '/order {수주번호 또는 업체명}',
    format: '수주 상세 + 투입시간',
    examples: ['/order B2024-001', '/order SK하이닉스'],
    tip: '/orders 로 전체 목록'
  },
  deliveries: {
    title: '/deliveries — 이번 달 납품 예정',
    usage: '/deliveries',
    format: 'D-day 카운트다운 포함',
    examples: [],
    tip: '/orders 로 전체 수주 현황'
  },
  team: {
    title: '/team — 팀원별 금주 투입',
    usage: '/team',
    format: '관리자/팀장만 사용 가능, 과부하 경고 포함',
    examples: [],
    tip: '/report 로 월간 전체 리포트'
  },
  remind: {
    title: '/remind — 리마인더',
    usage: '/remind {시간} {내용}',
    format: '시간: 30m, 1h, 2h, 1d (최대 7일)',
    examples: ['/remind 30m 회의 준비', '/remind 2h 검수 서류', '/remind 1d 납품 확인'],
    tip: '설정한 시간 후 봇이 알림을 보냅니다'
  },
  vote: {
    title: '/vote — 팀 투표',
    usage: '/vote 질문\n옵션1\n옵션2\n옵션3',
    format: '줄바꿈으로 질문과 옵션 구분',
    examples: ['/vote 회의 시간\n10시\n14시\n16시'],
    tip: '그룹 채팅에서 사용하면 팀원 모두 투표 가능'
  },
  docs: {
    title: '/docs — 문서 목록',
    usage: '/docs\n/docs {프로젝트명}',
    format: '최근 문서 또는 프로젝트별 문서',
    examples: ['/docs', '/docs SK하이닉스'],
    tip: '/search-doc 키워드 로 검색'
  },
  'search-doc': {
    title: '/search-doc — 문서 검색',
    usage: '/search-doc {키워드}',
    format: '파일명·태그 기준 검색',
    examples: ['/search-doc 검수', '/search-doc 도면'],
    tip: '/docs 프로젝트명 으로 프로젝트별 조회'
  }
};

function create(sendMessage) {
  /** 봇 명령어: /help */
  async function cmdHelp(chatId, arg) {
    if (arg) {
      var key = arg.replace(/^\//, '').toLowerCase().replace(/_/g, '-');
      var h = CMD_HELP[key];
      if (!h) return sendMessage(chatId, '❓ "' + arg + '" 명령어를 찾을 수 없습니다.\n/help 로 전체 목록을 확인하세요.');

      var msg = '📖 <b>' + h.title + '</b>\n\n';
      msg += '<b>사용법</b>\n<code>' + h.usage + '</code>\n\n';
      if (h.format) msg += '<b>설명</b>\n' + h.format + '\n\n';
      if (h.examples.length > 0) {
        msg += '<b>예제</b>\n';
        h.examples.forEach(function(ex) { msg += '  <code>' + ex + '</code>\n'; });
        msg += '\n';
      }
      if (h.tip) msg += '💡 ' + h.tip;
      return sendMessage(chatId, msg);
    }

    var msg = '🤖 <b>Work Manager Bot</b>\n\n' +
      '<b>📋 개인</b>\n' +
      '/today — 오늘 브리핑\n' +
      '/my — 내 현황 (이슈 + 납기)\n' +
      '/issues — 미해결 이슈 목록\n' +
      '/tasks — 미완료 작업\n' +
      '/done &lt;번호&gt; — 작업 완료 처리\n' +
      '/log — 업무일지 빠른 등록\n' +
      '/my-stats — 내 월간 통계\n\n' +
      '<b>📊 분석</b>\n' +
      '/summary — 금주 업무시간 요약\n' +
      '/report — 월간 리포트\n' +
      '/weekly-report — 주간보고 생성\n' +
      '/overdue — 지연/긴급 현황\n' +
      '/project &lt;이름&gt; — 프로젝트 현황\n' +
      '/checklist &lt;이름&gt; — 체크리스트\n\n' +
      '<b>📅 일정/수주</b>\n' +
      '/calendar — 이번 주 일정\n' +
      '/orders — 수주 목록\n' +
      '/order &lt;번호&gt; — 수주 상세\n' +
      '/deliveries — 납품 예정\n' +
      '/remind &lt;시간&gt; &lt;내용&gt; — 리마인더\n' +
      '/vote — 팀 투표\n\n' +
      '<b>📁 문서</b>\n' +
      '/docs &lt;프로젝트&gt; — 문서 목록\n' +
      '/search-doc &lt;키워드&gt; — 문서 검색\n\n' +
      '<b>👥 팀 (관리자/팀장)</b>\n' +
      '/team — 팀원별 금주 투입\n\n' +
      '<b>⚙️ 설정</b>\n' +
      '/unlink — 연동 해제\n' +
      '/help &lt;명령어&gt; — 상세 도움말\n\n' +
      '<b>💬 AI 질답</b>\n' +
      '명령어 없이 자연어로 질문하세요!\n' +
      '예: "이번 주 누가 제일 바빠?"\n' +
      '💡 "8h D B2024-001 업무내용" → 업무 등록\n\n' +
      '<i>💡 /help log 처럼 명령어 뒤에 이름을 붙이면 상세 설명을 볼 수 있습니다.</i>';
    return sendMessage(chatId, msg);
  }

  return { cmdHelp: cmdHelp };
}

module.exports = { create: create, CMD_HELP: CMD_HELP };
