/**
 * 업무 관리자 — 🧠 마인드맵 상황별 추천 템플릿 (v13.249)
 * 새 맵 창의 갤러리 · #mmNewTpl 이 쓴다. mindmap.js 의 MM_TEMPLATES 를 대신한다.
 *   k        키 (예전 키 blank · meeting · wbs · swot · why5 · weekly · team 은 그대로)
 *   cat      상황 — MM_TPL_CATS 키
 *   when     언제 쓰면 좋은지 (카드에 보임)
 *   tree(t)  빈 틀 — 가지 이름만
 *   ex(t)    예제 — 바로 고쳐 쓸 수 있게 채운 내용 (없으면 빈 틀만)
 * 노드 정의: 문자열 또는 { text, children, note, labels }
 */
var MM_TPL_CATS = [
  { k: 'rec', l: '⭐ 추천' },
  { k: 'meet', l: '🤝 회의 · 보고' },
  { k: 'proj', l: '📁 프로젝트' },
  { k: 'fix', l: '🔧 문제 해결' },
  { k: 'plan', l: '💡 기획 · 아이디어' },
  { k: 'me', l: '🙋 개인' },
  { k: 'team', l: '👥 팀' },
  { k: 'auto', l: '⚡ 자동 생성 · AI' }
];
var MM_TPL_REC = ['meeting', 'weekly', 'kickoff', 'fishbone', 'brainstorm', 'handover'];

function _mmT(text, children, extra) {
  var n = { text: text, children: children || [] };
  if (extra) Object.keys(extra).forEach(function (k) { n[k] = extra[k]; });
  return n;
}

var MM_TEMPLATES = [
  { k: 'blank', cat: 'plan', icon: '⬜', l: '빈 맵', when: '처음부터 자유롭게',
    tree: function (t) { return _mmT(t); } },

  /* ── 회의 · 보고 ── */
  { k: 'meeting', cat: 'meet', icon: '🤝', l: '회의', when: '정기 · 수시 회의를 진행하며 바로 정리',
    tree: function (t) { return _mmT(t, ['안건', '논의 내용', '결정 사항', '할 일 (담당 · 기한)', '다음 회의']); },
    ex: function (t) { return _mmT(t, [
      _mmT('안건', ['2호기 출하 일정', '협력사 단가 인상 요청', '신규 인원 배치']),
      _mmT('논의 내용', [_mmT('출하 일정', ['고객 입회 시운전 11/12 확정', '배선 수정 2일 필요']), _mmT('단가', ['3% 인상 요청 — 근거 자료 요청하기로'])]),
      _mmT('결정 사항', ['출하일 11/15 유지', '단가는 다음 주 재협의']),
      _mmT('할 일 (담당 · 기한)', [_mmT('배선 수정 — 전장팀 · 11/8', [], { labels: ['전장'] }), '단가 근거 자료 요청 — 구매 · 11/6']),
      _mmT('다음 회의', ['11/10 (월) 10:00'])
    ]); } },
  { k: 'oneonone', cat: 'meet', icon: '💬', l: '1:1 면담', when: '팀원과 정기 면담 — 근황 · 고민 · 성장',
    tree: function (t) { return _mmT(t, ['근황 · 컨디션', '진행 중인 일', '막힌 점 · 도움 필요', '성장 · 배우고 싶은 것', '합의한 다음 행동']); },
    ex: function (t) { return _mmT(t, [
      _mmT('근황 · 컨디션', ['현장 출장 잦아 피로 누적']),
      _mmT('진행 중인 일', ['3호기 PLC 로직 70%', 'A/S 대응 2건']),
      _mmT('막힌 점 · 도움 필요', ['비전 검사 조건 — 선임 리뷰 필요']),
      _mmT('성장 · 배우고 싶은 것', ['로봇 티칭 교육 희망']),
      _mmT('합의한 다음 행동', ['리뷰 일정 11/7 잡기', '교육 일정 알아보기'])
    ]); } },
  { k: 'report', cat: 'meet', icon: '📊', l: '월간 보고', when: '한 달 실적 · 문제 · 다음 달 계획을 한 장에',
    tree: function (t) { return _mmT(t, ['주요 실적', '수치 (매출 · 수주 · 납기)', '문제 · 리스크', '다음 달 계획', '요청 사항']); },
    ex: function (t) { return _mmT(t, [
      _mmT('주요 실적', ['2호기 출하 완료', '신규 수주 1건 (B사 검사기)']),
      _mmT('수치 (매출 · 수주 · 납기)', ['납기 준수 4/5', 'A/S 처리 평균 1.8일']),
      _mmT('문제 · 리스크', ['부품 리드타임 증가 (서보 6주)']),
      _mmT('다음 달 계획', ['3호기 조립 완료', '표준 사양서 개정']),
      _mmT('요청 사항', ['설계 인력 1명 지원'])
    ]); } },
  { k: 'kpt', cat: 'meet', icon: '🔁', l: '회고 (KPT)', when: '프로젝트 · 분기를 마치고 돌아보기',
    structure: 'down',
    tree: function (t) { return _mmT(t, ['Keep — 계속할 것', 'Problem — 문제였던 것', 'Try — 다음에 해 볼 것']); },
    ex: function (t) { return _mmT(t, [
      _mmT('Keep — 계속할 것', ['주 1회 고객 진행 공유', '출하 전 체크리스트']),
      _mmT('Problem — 문제였던 것', ['사양 변경이 메일로만 와서 누락', '시운전 일정 촉박']),
      _mmT('Try — 다음에 해 볼 것', ['사양 변경은 이슈로 등록', '시운전 버퍼 3일 확보'])
    ]); } },

  /* ── 프로젝트 ── */
  { k: 'kickoff', cat: 'proj', icon: '🚀', l: '프로젝트 킥오프', when: '새 프로젝트 시작 — 목표 · 범위 · 사람 · 일정 맞추기',
    tree: function (t) { return _mmT(t, ['목표 · 성공 기준', '범위 (하는 것 · 안 하는 것)', '역할 · 담당', '주요 일정', '리스크', '소통 방식']); },
    ex: function (t) { return _mmT(t, [
      _mmT('목표 · 성공 기준', ['택트 2.5초 이하', '불량 검출률 99.5%']),
      _mmT('범위 (하는 것 · 안 하는 것)', [_mmT('하는 것', ['검사 장비 2대', '현장 셋업 · 교육']), _mmT('안 하는 것', ['기존 라인 개조'])]),
      _mmT('역할 · 담당', ['PM — 박', '기구 — 김', '전장 · SW — 이']),
      _mmT('주요 일정', ['사양 확정 11/15', '조립 완료 12/20', '출하 1/10']),
      _mmT('리스크', ['고객 사양 변경 가능성', '카메라 납기']),
      _mmT('소통 방식', ['주간 회의 (월 10시)', '사양 변경은 이슈로'])
    ]); } },
  { k: 'wbs', cat: 'proj', icon: '🗂', l: '프로젝트 WBS 골격', when: '설비 프로젝트를 단계 · 작업으로 쪼개기', structure: 'right',
    tree: function (t) { return _mmT(t, [
      _mmT('기획 · 사양', ['요구사항', '사양 확정', '견적']),
      _mmT('설계', ['기구', '전장', 'SW']),
      _mmT('제작', ['가공 · 구매', '조립', '배선']),
      _mmT('시운전', ['자체 시운전', '고객 입회']),
      _mmT('납품 · 셋업', ['출하', '현장 셋업', '교육 · 인수'])
    ]); } },
  { k: 'shipcheck', cat: 'proj', icon: '✅', l: '출하 전 점검', when: '출하 전에 빠뜨린 것이 없는지',
    tree: function (t) { return _mmT(t, ['기구', '전장', 'SW', '서류', '포장 · 운송']); },
    ex: function (t) { return _mmT(t, [
      _mmT('기구', ['볼트 체결 · 마킹', '커버 · 안전 펜스']),
      _mmT('전장', ['배선 라벨', '접지 · 절연 저항']),
      _mmT('SW', ['최종 프로그램 백업', '파라미터 출력본']),
      _mmT('서류', ['검사 성적서', '매뉴얼 · 도면', 'CE · 안전 서류']),
      _mmT('포장 · 운송', ['고정 지그', '방청 · 습기', '차량 · 하차 장비'])
    ]); } },
  { k: 'risk', cat: 'proj', icon: '⚠️', l: '리스크 점검', when: '일정 · 비용 · 품질 위험을 미리 찾아 대응',
    tree: function (t) { return _mmT(t, ['일정', '비용', '품질 · 기술', '사람', '고객 · 외부']); },
    ex: function (t) { return _mmT(t, [
      _mmT('일정', [_mmT('카메라 납기 6주', [], { note: '대응: 대체 모델 견적 받기' })]),
      _mmT('비용', ['환율 상승 — 수입 부품']),
      _mmT('품질 · 기술', ['조명 반사로 오검출 가능']),
      _mmT('사람', ['SW 담당 1명 — 공백 시 대체 없음']),
      _mmT('고객 · 외부', ['사양 확정 지연'])
    ]); } },

  /* ── 문제 해결 ── */
  { k: 'fishbone', cat: 'fix', icon: '🐟', l: '불량 원인 분석 (4M)', when: '불량 · 고장의 원인을 사람 · 기계 · 재료 · 방법으로', structure: 'fishbone',
    tree: function (t) { return _mmT(t, ['사람 (Man)', '기계 (Machine)', '재료 (Material)', '방법 (Method)']); },
    ex: function (t) { return _mmT(t, [
      _mmT('사람 (Man)', ['신규 작업자 — 교육 미흡']),
      _mmT('기계 (Machine)', ['그리퍼 마모', '센서 감도 저하']),
      _mmT('재료 (Material)', ['소재 두께 편차 ±0.2']),
      _mmT('방법 (Method)', ['원점 복귀 절차 없음'])
    ]); } },
  { k: 'why5', cat: 'fix', icon: '❓', l: '5 Why (원인 분석)', when: '문제가 왜 생겼는지 끝까지 파고들기', structure: 'right',
    tree: function (t) { return _mmT(t, [_mmT('왜? 1', [_mmT('왜? 2', [_mmT('왜? 3', [_mmT('왜? 4', ['왜? 5 → 근본 원인'])])])])]); },
    ex: function (t) { return _mmT(t, [_mmT('설비가 멈췄다 — 왜?', [_mmT('과부하로 차단기가 떨어졌다 — 왜?', [_mmT('베어링 윤활이 부족했다 — 왜?', [_mmT('윤활 펌프가 충분히 돌지 않았다 — 왜?', [_mmT('펌프 흡입구에 이물 — 필터가 없었다 → 근본 원인', [], { labels: ['대책: 필터 설치'] })])])])])]); } },
  { k: 'asfix', cat: 'fix', icon: '🛠', l: 'A/S · 장애 대응', when: '현장 장애를 받고 조치 · 재발 방지까지',
    tree: function (t) { return _mmT(t, ['증상', '확인한 것', '임시 조치', '원인', '영구 대책', '고객 안내']); },
    ex: function (t) { return _mmT(t, [
      _mmT('증상', ['비전 검사 NG 급증 (오전 9시부터)']),
      _mmT('확인한 것', ['조명 밝기 정상', '렌즈 오염 확인']),
      _mmT('임시 조치', ['렌즈 청소 · 재기동']),
      _mmT('원인', ['커버 틈으로 분진 유입']),
      _mmT('영구 대책', ['커버 실링 보강 — 11/9 방문']),
      _mmT('고객 안내', ['조치 결과 메일 · 방문 일정 공유'])
    ]); } },

  /* ── 기획 · 아이디어 ── */
  { k: 'brainstorm', cat: 'plan', icon: '💡', l: '브레인스토밍', when: '주제 하나로 생각을 넓게 펼치기',
    tree: function (t) { return _mmT(t, ['아이디어', '좋은 점', '걸리는 점', '바로 해 볼 것']); },
    ex: function (t) { return _mmT(t, [
      _mmT('아이디어', ['모듈형 검사 유닛', '원격 모니터링', '셀프 진단 화면']),
      _mmT('좋은 점', ['납기 단축', 'A/S 출장 감소']),
      _mmT('걸리는 점', ['초기 개발비', '고객 네트워크 보안']),
      _mmT('바로 해 볼 것', ['원격 모니터링 시제품 — 사내 라인'])
    ]); } },
  { k: 'swot', cat: 'plan', icon: '🧭', l: 'SWOT', when: '사업 · 제품의 강점 · 약점 · 기회 · 위협', structure: 'matrix',
    tree: function (t) { return _mmT(t, ['강점 (S)', '약점 (W)', '기회 (O)', '위협 (T)']); },
    ex: function (t) { return _mmT(t, [
      _mmT('강점 (S)', ['맞춤 설계 경험', '빠른 A/S']),
      _mmT('약점 (W)', ['표준 제품 부족']),
      _mmT('기회 (O)', ['2차전지 설비 투자 증가']),
      _mmT('위협 (T)', ['대형사 저가 수주'])
    ]); } },
  { k: 'inquiry', cat: 'plan', icon: '🔍', l: '고객 문의 검토', when: '새 문의 · 견적 요청을 받아 할지 말지 정하기',
    tree: function (t) { return _mmT(t, ['고객 요구', '기술 검토', '일정 · 인력', '견적 · 수익', '결론']); },
    ex: function (t) { return _mmT(t, [
      _mmT('고객 요구', ['택트 3초', '기존 라인 옆 설치 (폭 1.5m)']),
      _mmT('기술 검토', ['비슷한 사례 있음 (A사)', '공간이 빠듯 — 레이아웃 확인']),
      _mmT('일정 · 인력', ['설계 1명 · 2개월']),
      _mmT('견적 · 수익', ['예상 1.2억 · 이익률 18%']),
      _mmT('결론', ['현장 방문 후 견적 — 11/12'])
    ]); } },

  /* ── 개인 ── */
  { k: 'weekly', cat: 'me', icon: '🗓', l: '내 주간 업무', when: '한 주를 정리하고 다음 주 계획',
    tree: function (t) { return _mmT(t, ['이번 주 한 일', '다음 주 할 일', '이슈 · 리스크', '요청 · 협조', '아이디어']); },
    ex: function (t) { return _mmT(t, [
      _mmT('이번 주 한 일', ['3호기 도면 출도', 'A사 A/S 방문']),
      _mmT('다음 주 할 일', ['조립 지원', '사양서 개정안 작성']),
      _mmT('이슈 · 리스크', ['서보 납기 지연']),
      _mmT('요청 · 협조', ['구매 — 대체품 견적']),
      _mmT('아이디어', ['조립 지그 표준화'])
    ]); } },
  { k: 'goal', cat: 'me', icon: '🎯', l: '목표 (OKR)', when: '분기 · 연간 목표와 성과 지표 세우기',
    tree: function (t) { return _mmT(t, [_mmT('목표 1', ['핵심 결과 1', '핵심 결과 2']), _mmT('목표 2', ['핵심 결과 1'])]); },
    ex: function (t) { return _mmT(t, [
      _mmT('설계 기간 단축', ['표준 모듈 5종 만들기', '출도까지 평균 3주 → 2주']),
      _mmT('A/S 품질 높이기', ['재방문율 10% 이하', '조치 보고서 100% 작성'])
    ]); } },
  { k: 'handover', cat: 'me', icon: '🤲', l: '업무 인수인계', when: '휴가 · 이동 · 퇴사 전에 넘길 것을 빠짐없이',
    tree: function (t) { return _mmT(t, ['진행 중인 일', '정기 업무', '연락처', '자료 위치', '주의할 점']); },
    ex: function (t) { return _mmT(t, [
      _mmT('진행 중인 일', [_mmT('3호기 배선 — 80%', [], { note: '남은 것: 안전 회로 · 라벨' })]),
      _mmT('정기 업무', ['매주 금 — A/S 현황 보고']),
      _mmT('연락처', ['A사 설비 담당 김과장 010-…']),
      _mmT('자료 위치', ['도면: 문서관리 > 3호기', '프로그램: NAS /plc/3호기']),
      _mmT('주의할 점', ['고객 입회는 2일 전 연락'])
    ]); } },

  /* ── 팀 ── */
  { k: 'team', cat: 'team', icon: '👥', l: '팀 업무 분장', when: '누가 무엇을 맡는지 한눈에', structure: 'down',
    tree: function (t) { return _mmT(t, ['팀원 1', '팀원 2', '팀원 3']); },
    ex: function (t) { return _mmT(t, [
      _mmT('김 — 기구', ['3호기 설계', '지그 표준화']),
      _mmT('이 — 전장 · SW', ['3호기 PLC', 'A/S 대응']),
      _mmT('박 — PM', ['고객 협의', '일정 · 구매'])
    ]); } },
  { k: 'onboard', cat: 'team', icon: '🌱', l: '신규 입사자 온보딩', when: '첫 한 달 동안 익힐 것과 도와줄 사람',
    tree: function (t) { return _mmT(t, ['첫 주', '2~4주', '익힐 도구 · 시스템', '멘토 · 연락처', '첫 달 목표']); },
    ex: function (t) { return _mmT(t, [
      _mmT('첫 주', ['안전 교육', '공장 · 설비 둘러보기', '계정 · PC 세팅']),
      _mmT('2~4주', ['선배 프로젝트 따라가기', '도면 · 표준 사양서 읽기']),
      _mmT('익힐 도구 · 시스템', ['업무 관리자 (이 사이트)', 'CAD · PLC 툴']),
      _mmT('멘토 · 연락처', ['멘토 — 김 선임']),
      _mmT('첫 달 목표', ['작은 지그 설계 1건 완료'])
    ]); } },
  { k: 'training', cat: 'team', icon: '📚', l: '교육 계획', when: '팀 교육 · 기술 전수 일정 짜기', structure: 'timeline',
    tree: function (t) { return _mmT(t, ['1월', '2월', '3월']); },
    ex: function (t) { return _mmT(t, [
      _mmT('1월', ['로봇 티칭 기초']),
      _mmT('2월', ['비전 검사 조건 잡기']),
      _mmT('3월', ['안전 회로 설계'])
    ]); } }
];
