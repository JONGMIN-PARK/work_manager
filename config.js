/**
 * 업무일지 분석기 — 설정 파일
 * 테마, 색상, 인코딩, 업무분장 코드, AI 모델, 차트 스타일 등
 */

/* ═══ 테마 ═══ */
var TH = [
  { id: 'auto',     l: '시스템',    c: 'linear-gradient(135deg,#F5F7FA 50%,#0C0F1A 50%)' },
  { id: 'light',    l: '라이트',    c: '#F5F7FA' },
  { id: 'midnight', l: '미드나잇',  c: '#0C0F1A' },
  { id: 'forest',   l: '포레스트',  c: '#0B1410' },
  { id: 'sand',     l: '웜샌드',    c: '#FAF7F2' },
  { id: 'rose',     l: '로즈',      c: '#1A0A14' },
  { id: 'slate',    l: '슬레이트',  c: '#1C1C1E' }
];

/* ═══ 인코딩 ═══ */
var ENC = ['euc-kr', 'utf-8', 'cp949', 'shift_jis', 'iso-8859-1'];

/* ═══ 색상 팔레트 (팀원 구분용) ═══ */
var COL = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
  '#E11D48', '#84CC16', '#0EA5E9', '#D946EF', '#FB923C'
];

/* ═══ 업무분장 코드 ═══ */
var AM = {
  A: 'A(CS현장)',
  B: 'B(제작)',
  D: 'D(개발)',
  G: 'G(일반)',
  M: 'M(관리)',
  S: 'S(영업지원)'
};

/* 업무분장 배경색 */
var ABG = { A: '#7F1D1D', B: '#1E3A5F', D: '#14532D', G: '#3B2F5E', S: '#78350F', M: '#1A1F35' };

/* 업무분장 전경색 */
var AFG = { A: '#FCA5A5', B: '#93C5FD', D: '#86EFAC', G: '#C4B5FD', S: '#FCD34D', M: '#94A3B8' };

/* 업무분장 차트 바 색상 */
var ABR = { A: '#EF4444', B: '#3B82F6', D: '#10B981', G: '#8B5CF6', S: '#F59E0B', M: '#64748B' };

/* ═══ 인원 비교 차트 스타일 ═══ */
var CMP_COL = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#A855F7',
  '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#E11D48',
  '#6366F1', '#14B8A6'
];
var CMP_DASH = [
  [], [5,5], [10,5], [2,2], [8,4,2,4], [15,5],
  [4,8], [1,4], [6,2], [3,6], [10,2,2,2], [5,10]
];
var CMP_PT = [
  'circle', 'rect', 'triangle', 'rectRot', 'crossRot', 'star',
  'circle', 'rect', 'triangle', 'rectRot', 'cross', 'star'
];

/* ═══ AI 모델 설정 ═══ */
var AI_CONFIG = {
  gemini: {
    label: 'Gemini',
    icon: '🟦',
    model: 'gemini-2.5-flash',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    keyPlaceholder: 'AIzaSy...',
    keyLabel: '🔑 Gemini Key',
    keyLink: 'https://aistudio.google.com/apikey',
    keyLinkText: 'Google AI Studio에서 발급 →'
  },
  anthropic: {
    label: 'Claude',
    icon: '🟧',
    model: 'claude-sonnet-4-20250514',
    url: 'https://api.anthropic.com/v1/messages',
    keyPlaceholder: 'sk-ant-api03-...',
    keyLabel: '🔑 Claude Key',
    keyLink: 'https://console.anthropic.com/settings/keys',
    keyLinkText: 'Anthropic Console에서 발급 →'
  }
};

/* ═══ 난이도 분석 키워드 ═══ */
var DIFF_KEYWORDS = [
  { kw: ['개발', '구현', '설계', '아키텍처', '리팩토링', '알고리즘'], tag: '개발',       w: 3 },
  { kw: ['분석', '파싱', '디버깅', '디버그', '버그', '오류', '에러'],  tag: '분석/디버깅', w: 2 },
  { kw: ['test', '테스트', '검증', '검수', '점검'],                   tag: '테스트',      w: 1 },
  { kw: ['회의', '미팅', '협의', '보고', '검토'],                     tag: '회의/협의',   w: 0 },
  { kw: ['설치', '세팅', 'setup', '배포', '이관'],                    tag: '설치/배포',   w: 1 },
  { kw: ['cam', 'scanner', 'calibration', 'cal', '보정'],            tag: '장비보정',    w: 2 },
  { kw: ['신규', 'new', '신기능', '추가개발'],                        tag: '신규개발',    w: 3 },
  { kw: ['유지보수', '패치', '수정', '처리'],                         tag: '유지보수',    w: 1 },
  { kw: ['cs', '현장', '출장', '방문'],                               tag: 'CS현장',      w: 2 }
];

/* ═══ 프로젝트 상태 ═══ */
var PROJ_STATUS = {
  waiting: { label: '대기',   color: '#94A3B8', bg: 'rgba(148,163,184,.15)', icon: '⏳' },
  active:  { label: '진행중', color: '#3B82F6', bg: 'rgba(59,130,246,.15)',  icon: '🔄' },
  delayed: { label: '지연',   color: '#EF4444', bg: 'rgba(239,68,68,.15)',   icon: '⚠️' },
  done:    { label: '완료',   color: '#10B981', bg: 'rgba(16,185,129,.15)',  icon: '✅' },
  hold:    { label: '보류',   color: '#F59E0B', bg: 'rgba(245,158,11,.15)', icon: '⏸️' }
};

/* ═══ 일정 유형 ═══ */
var EVT_TYPE = {
  milestone:    { label: '마일스톤', color: '#8B5CF6', icon: '◆' },
  meeting:      { label: '회의',     color: '#06B6D4', icon: '🤝' },
  deadline:     { label: '납기',     color: '#EF4444', icon: '🏁' },
  trip:         { label: '출장',     color: '#F97316', icon: '✈️' },
  fieldService: { label: '현장출동', color: '#DC2626', icon: '🔧' },
  periodicChk:  { label: '정기점검', color: '#14B8A6', icon: '🛠️' },
  dayoff:       { label: '연차',     color: '#10B981', icon: '🌴' },
  amoff:        { label: '오전반차', color: '#14B8A6', icon: '🌅' },
  pmoff:        { label: '오후반차', color: '#0D9488', icon: '🌇' },
  etc:          { label: '기타',     color: '#64748B', icon: '📌' }
};

/* ═══ 프로젝트 라이프사이클 단계 ═══ */
var PROJ_PHASE = {
  order:       { label: '수주',   icon: '📋', color: '#6366F1', seq: 1 },
  design:      { label: '설계',   icon: '📐', color: '#8B5CF6', seq: 2 },
  manufacture: { label: '제작',   icon: '🏭', color: '#3B82F6', seq: 3 },
  inspect:     { label: '검수',   icon: '🔍', color: '#06B6D4', seq: 4 },
  deliver:     { label: '납품',   icon: '🚚', color: '#10B981', seq: 5 },
  as:          { label: 'A/S',   icon: '🛠️', color: '#F59E0B', seq: 6 }
};

/* ═══ 부서 ═══ */
var DEPT = {
  design:        { label: '설계',       icon: '📐', color: '#8B5CF6' },
  manufacturing: { label: '제조',       icon: '🏭', color: '#3B82F6' },
  electrical:    { label: '전장',       icon: '⚡', color: '#F59E0B' },
  control:       { label: '제어',       icon: '🎛️', color: '#06B6D4' },
  process:       { label: '공정',       icon: '⚙️', color: '#10B981' },
  software:      { label: '소프트웨어', icon: '💻', color: '#EC4899' }
};

/* ═══ 이슈 유형 ═══ */
var ISSUE_TYPE = {
  fault:       { label: '장애',     icon: '🔴', color: '#EF4444' },
  defect:      { label: '불량',     icon: '🟠', color: '#F97316' },
  change:      { label: '설계변경', icon: '🔵', color: '#3B82F6' },
  performance: { label: '성능',     icon: '🟡', color: '#F59E0B' },
  inquiry:     { label: '문의',     icon: '🟣', color: '#8B5CF6' },
  improve:     { label: '개선',     icon: '🟢', color: '#10B981' },
  periodic:    { label: '정기점검', icon: '🔧', color: '#14B8A6' },
  etc:         { label: '기타',     icon: '⚪', color: '#64748B' }
};

/* ═══ 이슈 긴급도 ═══ */
var ISSUE_URGENCY = {
  urgent: { label: '긴급', icon: '🔴', color: '#EF4444' },
  normal: { label: '보통', icon: '🟡', color: '#F59E0B' },
  low:    { label: '일반', icon: '🟢', color: '#10B981' }
};

/* ═══ 이슈 상태 ═══ */
var ISSUE_STATUS = {
  open:       { label: '접수',   color: '#6366F1' },
  inProgress: { label: '대응중', color: '#3B82F6' },
  resolved:   { label: '해결',   color: '#10B981' },
  closed:     { label: '종결',   color: '#94A3B8' },
  hold:       { label: '보류',   color: '#F59E0B' }
};

/* ═══ AI 프롬프트 프리셋 ═══ */
/* ═══ 역할 ═══ */
var ROLE_LABELS = {
  admin: '관리자', executive: '임원', manager: '팀장', member: '팀원'
};

/* ═══ AI 프롬프트 프리셋 ═══ */
var AI_PRESETS = [
  { label: '⚡과부하',  text: '특정 인원의 업무 과부하 여부를 중점 분석해줘.' },
  { label: '📦수주별',  text: '수주번호별 진행상황과 투입 리소스 관점에서 분석해줘.' },
  { label: '⚖️균형',   text: '업무 분장 간 균형과 개선점을 분석해줘.' },
  { label: '📝주간보고', text: '주간 보고서 형태로 정리해줘. 핵심 성과, 이슈, 다음주 계획 포함.' },
  { label: '📊월간보고', text: '월간 보고 관점에서 누적 트렌드와 리소스 효율성을 분석해줘.' }
];
