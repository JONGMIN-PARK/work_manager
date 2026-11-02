/* ═══════════════════════════════════════════════════════════════════════
   notebook-coach.js — ✍️ 글쓰기 코치 규칙 검사 (v13.318)
   ─────────────────────────────────────────────────────────────────────
   AI 없이 바로 — 쓰는 동안 계속 돌려도 가벼움. 고쳐 주지 않고 "왜 → 힌트 → 예시" 로 가르침.
   찾는 것(k): long 긴 문장 · filler 군더더기 · passive 번역투/피동 · vague 모호한 말 · number 숫자 없는 진척
              repeat 같은 말 되풀이 · double 겹말 · spell 자주 틀리는 말 · head 결론이 뒤에 · outline 큰 글에 제목 없음
   글 종류(kind): meeting 회의록 · review 기술 검토 · trip 출장 보고 · why 문제 분석 · mail 메일 · daily 업무 일지 · weekly 주간 보고 · note
   전역: NbCoach.check(text, { kind, title, tags }) → { findings, counts, scores, outline, kind, chars }
         NbCoach.KINDS · NbCoach.LABELS · NbCoach.detectKind · NbCoach.taskFor(k)
   ═══════════════════════════════════════════════════════════════════════ */
var NbCoach = (function () {
  'use strict';
  var LABELS = {
    long: ['📏', '긴 문장'], filler: ['🧹', '군더더기'], passive: ['🔁', '번역투 · 피동'], vague: ['🌫', '모호한 말'], number: ['🔢', '숫자 · 날짜 없음'],
    repeat: ['🔂', '같은 말 되풀이'], double: ['➰', '겹말'], spell: ['✏️', '맞춤법'], head: ['🎯', '결론이 뒤에'], outline: ['🗂', '제목 없이 긴 글'], missing: ['🧩', '빠진 칸'], data: ['📊', '데이터와 다름']
  };
  var KINDS = { meeting: '회의록', review: '기술 검토', trip: '출장 보고', why: '문제 분석', mail: '업무 메일', daily: '업무 일지', weekly: '주간 업무 보고', note: '업무 노트' };
  // 연습 과제 — 가장 많이 나온 버릇 하나로
  var TASKS = {
    long: '이번 주는 한 문장을 50자 안으로 — "~하고 · ~하며 · ~해서" 가 나오면 거기서 끊어 보기',
    filler: '이번 주는 "~하도록 하겠습니다 · ~하는 부분 · ~것으로 보임" 을 쓰지 않고 바로 말하기',
    passive: '이번 주는 "되어지다 · 보여지다 · ~에 의해" 대신 누가 무엇을 했는지 주어를 세워 쓰기',
    vague: '이번 주는 "조만간 · 추후 · 최대한" 을 쓸 때마다 날짜나 숫자로 바꿔 쓰기',
    number: '이번 주 보고는 "진행 중" 마다 % 나 마감일을 하나씩 붙이기',
    repeat: '이번 주는 같은 문장에 같은 낱말이 세 번 나오면 하나를 대명사나 다른 말로 바꾸기',
    double: '이번 주는 "미리 예약 · 다시 재검토 · 약 ~정도" 처럼 뜻이 겹치는 말을 찾아 하나만 남기기',
    spell: '이번 주는 보내기 전에 맞춤법 점검을 한 번 — 자주 틀리는 말 목록을 메모해 두기',
    head: '이번 주 보고는 첫 줄에 결론(결과 · 요청 · 결정)부터 쓰고 이유는 그 뒤에',
    outline: '이번 주는 긴 노트를 쓰기 전에 ## 제목 세 개로 뼈대부터 잡기',
    missing: '이번 주는 양식의 빈 칸(담당 · 기한 · 결정)을 다 채운 뒤에 공유하기'
  };

  /* ─── 규칙 ─── */
  var FILLER = [
    [/하도록 하겠습니다/g, '"~하도록 하겠습니다" 는 "~하겠습니다" 로 충분합니다', '하겠습니다'],
    [/(진행|검토|확인|조치)하도록 하겠습니다|(진행|검토|확인|조치)(을|를) 진행하/g, '"검토를 진행하다" 처럼 동작을 두 번 말하고 있습니다', '검토하겠습니다'],
    [/하는 부분/g, '"~하는 부분" 은 뜻을 흐립니다 — 무엇을 하는지 바로 쓰세요', '"설치하는 부분이 늦어짐" → "설치가 늦어짐"'],
    [/것으로 (보임|보입니다|판단됨|판단됩니다|사료됨|사료됩니다)/g, '"~것으로 보입니다" 는 확신이 없어 보입니다 — 근거와 함께 단정하세요', '"원인은 센서 불량입니다 (교체 후 정상)"'],
    [/에 있어서/g, '"~에 있어서" 는 번역투 군더더기입니다', '"설계에 있어서" → "설계에서"'],
    [/(관련하여|관련해서)/g, '"~와 관련하여" 는 대부분 "~의 · ~에 대해" 로 짧게 됩니다', '"납기와 관련하여 문의" → "납기 문의"'],
    [/(기본적으로|전반적으로|일단|우선적으로|사실상|어떻게 보면|다소|약간)\s/g, '뜻을 더하지 않는 부사입니다 — 빼도 뜻이 같으면 빼세요', '(빼고 읽어 보기)'],
    [/수 있을 것 ?같습니다|것 ?같습니다/g, '"~것 같습니다" 는 업무 글에서 자신 없어 보입니다', '"가능합니다 · 어렵습니다 (이유)"']
  ];
  var PASSIVE = [
    [/되어지(다|는|고|며|면|게|었|어)|되어진/g, '"되어지다" 는 피동이 겹쳤습니다', '"되다"'],
    [/보여지(다|는|고|며|면|게|었|어)|보여진/g, '"보여지다" 는 피동이 겹쳤습니다', '"보이다"'],
    [/불리워/g, '"불리워" 는 틀린 피동입니다', '"불려"'],
    [/에 의해(서)?\s/g, '"~에 의해" 는 번역투 — 누가 했는지 주어로 세우세요', '"작업자에 의해 교체됨" → "작업자가 교체함"'],
    [/(을|를) 가지고 있(다|습니다|음)/g, '"~을 가지고 있다" 는 영어 have 번역투입니다', '"~이 있다"'],
    [/(을|를) 통해(서)?\s/g, '"~을 통해" 는 자주 쓰면 번역투가 됩니다', '"회의를 통해 결정" → "회의에서 결정"'],
    [/하게 되었습니다/g, '"~하게 되었습니다" 는 스스로 한 일을 남 일처럼 말합니다', '"~했습니다"']
  ];
  var VAGUE = [
    [/적절(히|한)/g, '"적절히" — 무엇이 적절한지 읽는 사람이 판단할 수 없습니다', '기준을 숫자로 (예: 온도 60℃ 이하)'],
    [/빠른 시일 ?내|조만간|추후|차후|향후 ?(진행|검토|확인)/g, '언제인지 알 수 없습니다 — 날짜를 쓰세요', '"11/15(금)까지"'],
    [/최대한 (빨리|빠르게)|가능한 한 빨리|ASAP|asap/g, '"최대한 빨리" 는 기한이 아닙니다', '"11/12 오전까지"'],
    [/어느 정도|여러 가지|등등|많이|대부분/g, '양을 숫자로 바꿀 수 있는지 보세요', '"대부분" → "12대 중 10대"'],
    [/확인 필요|검토 필요|조치 필요/g, '누가 · 언제까지 하는지가 빠졌습니다', '"확인 필요 (@김과장 · 11/14)"']
  ];
  var DOUBLE = [
    [/미리 (예약|예견|준비)/g, '"예약" 에 이미 "미리" 가 들어 있습니다', '"예약"'],
    [/다시 재(검토|확인|시작|발송|작업)/g, '"재-" 가 이미 "다시" 입니다', '"재검토" 또는 "다시 검토"'],
    [/과반수 이상/g, '"과반수" 가 이미 "반을 넘는 수" 입니다', '"과반수"'],
    [/약\s?\d+[^\s]*\s?(정도|가량)/g, '"약" 과 "정도" 가 겹칩니다', '"약 30분" 또는 "30분 정도"'],
    [/먼저 (선행|선결)/g, '"선행" 에 "먼저" 가 들어 있습니다', '"선행"'],
    [/(서로|상호) (간|간에)/g, '"서로" 와 "간" 이 겹칩니다', '"서로"'],
    [/새로 (신설|신규)/g, '"신설" 에 "새로" 가 들어 있습니다', '"신설"']
  ];
  var SPELL = [
    [/몇일/g, '며칠'], [/금새/g, '금세'], [/웬지/g, '왠지'], [/왠만/g, '웬만'], [/할께/g, '할게'], [/할께요/g, '할게요'], [/됬/g, '됐'],
    [/어떻해/g, '어떡해 · 어떻게'], [/일일히/g, '일일이'], [/틈틈히/g, '틈틈이'], [/깨끗히/g, '깨끗이'], [/오랫만/g, '오랜만'], [/역활/g, '역할'],
    [/희안/g, '희한'], [/어의없/g, '어이없'], [/문안하게/g, '무난하게'], [/내노라/g, '내로라'], [/설레임/g, '설렘'], [/바램/g, '바람 (바라다)'],
    [/되요/g, '돼요'], [/안되요/g, '안 돼요'], [/뵈요/g, '봬요'], [/돼었/g, '되었'], [/있슴/g, '있음'], [/없슴/g, '없음'], [/했슴/g, '했음'],
    [/결제(를|가)? ?(올리|올려|받|부탁)/g, '결재 (서류를 올려 승인받는 것 — 결제는 돈을 치르는 것)'], [/계약 ?채결/g, '계약 체결'], [/곰곰히/g, '곰곰이']
  ];
  var PROG_RE = /(진행 ?중|진행중|진척|지연|완료 예정|마무리 ?예정|대기 ?중|작업 ?중)/;
  var HAS_NUM_RE = /\d|[일이삼사오육칠팔구십]+ ?(일|주|개월|%)|오늘|내일|모레|이번 ?주|다음 ?주|금주|차주|월요일|화요일|수요일|목요일|금요일/;
  var CONCL_RE = /(결론|요약|결과|요청|결정|완료|승인|부탁|공유드립니다|알려드립니다|보고드립니다|안내드립니다|필요합니다)/;
  var CHECK = {
    meeting: [['일시', /일시|날짜|\d{1,2}\/\d{1,2}|\d{4}[.-]\d/], ['참석', /참석/], ['안건 · 논의', /안건|논의|의제/], ['결정 사항', /결정|합의|확정/], ['할 일 · 담당 · 기한', /할 ?일|액션|action|담당/i]],
    review: [['배경 · 목적', /배경|목적/], ['요구 사항', /요구|조건|사양/], ['비교 · 검토', /검토|비교|안\b|A안|B안/], ['결론 · 추천', /결론|추천|제안/], ['위험', /위험|리스크|risk|우려/i]],
    trip: [['기간', /기간|일정|\d{1,2}\/\d{1,2}/], ['장소 · 고객', /장소|고객|현장|사이트/], ['목적', /목적/], ['결과', /결과|성과/], ['후속 조치', /후속|조치|할 ?일/]],
    why: [['현상', /현상|증상|문제/], ['원인', /원인|왜/], ['대책', /대책|조치|개선/], ['효과 확인', /효과|확인|검증/]],
    mail: [['받는 사람', /받는|수신|님/], ['용건', /용건|건|목적/], ['요청 · 기한', /요청|부탁|까지|기한/]],
    daily: [['오늘 할 일', /오늘|할 ?일/], ['끝낸 일', /끝낸|완료|한 일/], ['내일 이어서', /내일|다음/]]
  };

  function detectKind(o) {
    o = o || {};
    if (o.kind && KINDS[o.kind]) return o.kind;
    var s = (o.title || '') + ' ' + (o.tags || []).join(' ');
    if (/회의/.test(s)) return 'meeting';
    if (/기술 ?검토|검토/.test(s)) return 'review';
    if (/출장/.test(s)) return 'trip';
    if (/문제 ?분석|5 ?why|원인 ?분석/i.test(s)) return 'why';
    if (/메일/.test(s)) return 'mail';
    if (/일일|업무 ?일지|일일업무/.test(s)) return 'daily';
    if (/주간/.test(s)) return 'weekly';
    return 'note';
  }

  /** 글을 줄로 — 코드 블록 · 손글씨 · 표 구분 · 주소는 건너뜀. 각 줄의 시작 위치(원문 기준)를 함께 */
  function lines(text) {
    var out = [], pos = 0, code = false;
    String(text || '').split('\n').forEach(function (l, i) {
      var start = pos; pos += l.length + 1;
      if (/^\s*(```|~~~)/.test(l)) { code = !code; return; }
      if (code || /^::ink\[/.test(l) || /^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l) || !l.trim()) return;
      out.push({ i: i, start: start, raw: l, head: /^#{1,6}\s/.test(l) });
    });
    return out;
  }
  /** 문장 단위 (줄 안) — 마크다운 표시는 길이에서 뺌 */
  function sentences(l) {
    var res = [], re = /[^.!?。]+(?:[.!?。]+|$)/g, m;
    var body = l.raw;
    while ((m = re.exec(body))) { if (m[0].trim()) res.push({ off: m.index, s: m[0] }); if (m[0] === '') break; }
    return res;
  }
  function plainLen(s) { return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'URL').replace(/[*_`~=#>|-]/g, '').replace(/\s+/g, ' ').trim().length; }

  function check(text, opts) {
    opts = opts || {};
    text = String(text || '');
    var kind = detectKind(opts);
    var L = lines(text), F = [];
    function add(k, l, idx, len, msg, why, hint, ex) {
      var st = l.start + idx;
      if (F.some(function (f) { return f.k === k && f.start < st + len && st < f.end; })) return;   // 같은 종류가 겹치면 하나만
      F.push({ k: k, line: l.i, start: st, end: st + len, quote: text.slice(st, st + Math.min(len, 60)), msg: msg, why: why, hint: hint, ex: ex || '' });
    }
    function scan(l, list, k, why, hint) {
      list.forEach(function (r) {
        r[0].lastIndex = 0; var m;
        var masked = l.raw.replace(/https?:\/\/\S+|`[^`]*`/g, function (x) { return new Array(x.length + 1).join(' '); });
        while ((m = r[0].exec(masked))) { add(k, l, m.index, m[0].length, r[1], why, hint, r[2]); if (!r[0].global) break; }
      });
    }
    L.forEach(function (l) {
      if (!l.head) {
        sentences(l).forEach(function (s) {
          var n = plainLen(s.s);
          if (n > 80) add('long', l, s.off, s.s.length, '한 문장이 ' + n + '자입니다', '한 문장에 여러 뜻이 섞이면 읽는 사람이 무엇이 핵심인지 놓칩니다. 업무 글은 한 문장에 한 가지가 좋습니다.', '"~하고 · ~하며 · ~해서 · ~인데" 가 나오는 곳에서 끊어 두 문장으로', '');
          // 같은 말 되풀이 (두 글자 이상 낱말이 한 문장에 3번+)
          var words = {}, wm, wre = /[가-힣A-Za-z0-9]{2,}/g;
          while ((wm = wre.exec(s.s))) { var w = wm[0].replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|까지|부터)$/, ''); if (w.length >= 2) words[w] = (words[w] || 0) + 1; }
          Object.keys(words).forEach(function (w) { if (words[w] >= 3 && !/^\d+$/.test(w)) add('repeat', l, s.off + Math.max(0, s.s.indexOf(w)), w.length, '"' + w + '" — 한 문장에 ' + words[w] + '번', '같은 말이 되풀이되면 글이 늘어지고 핵심이 묻힙니다.', '한 번만 쓰고 나머지는 "이 · 그 · 해당" 이나 다른 말로', ''); });
        });
      }
      scan(l, FILLER, 'filler', '뜻을 더하지 않는 말은 읽는 시간만 늘립니다. 빼고 읽어도 뜻이 같으면 군더더기입니다.', '빼고 다시 읽어 보기 — 뜻이 그대로면 빼세요');
      scan(l, PASSIVE, 'passive', '번역투 · 겹친 피동은 누가 했는지 흐리고 문장을 길게 만듭니다.', '누가 무엇을 했는지 주어를 세워 능동으로');
      scan(l, VAGUE, 'vague', '모호한 말은 읽는 사람마다 다르게 받아들여 일이 어긋납니다.', '숫자 · 날짜 · 담당으로 바꿔 쓰기');
      scan(l, DOUBLE, 'double', '같은 뜻이 두 번 들어간 겹말입니다.', '뜻이 겹치는 한쪽을 빼세요');
      SPELL.forEach(function (r) {
        r[0].lastIndex = 0; var m;
        while ((m = r[0].exec(l.raw))) add('spell', l, m.index, m[0].length, '"' + m[0] + '" → "' + r[1] + '"', '자주 틀리는 말입니다. 맞춤법이 틀리면 내용까지 덜 믿게 됩니다.', '바른 말: ' + r[1], r[1]);
      });
      // 숫자 없는 진척 — "진행 중" 인데 %·날짜가 없음
      var pm = PROG_RE.exec(l.raw);
      if (pm && !HAS_NUM_RE.test(l.raw.replace(/\(wm:[^)]*\)|nbf:\S+/g, ''))) add('number', l, pm.index, pm[0].length, '"' + pm[0] + '" 인데 숫자 · 날짜가 없습니다', '읽는 사람은 "얼마나 · 언제" 가 궁금합니다. 숫자가 없으면 다시 물어봐야 합니다.', '진척률(%)이나 마감일(~11/15)을 붙이기', '"설치 진행 중 (70% · ~11/15)"');
    });
    // 큰 구조 — 결론이 뒤에 · 제목 없는 긴 글
    var body = L.filter(function (l) { return !l.head; });
    var chars = text.replace(/\s/g, '').length;
    if (kind !== 'note' && kind !== 'daily' && chars > 300 && body.length >= 4) {
      var firstTwo = body.slice(0, 2).map(function (l) { return l.raw; }).join(' ');
      if (!CONCL_RE.test(firstTwo)) {
        var concAt = body.filter(function (l) { return CONCL_RE.test(l.raw); })[0];
        add('head', body[0], 0, Math.min(body[0].raw.length, 40), '결론이 ' + (concAt ? (concAt.i + 1) + '번째 줄에' : '보이지 않습니다'), '바쁜 사람은 첫 두 줄만 읽습니다. 결론(결과 · 요청 · 결정)이 앞에 있어야 다음 행동이 빨라집니다.', '맨 앞에 "결론: ~" 한 줄을 두고 이유 · 세부는 그 아래로', '"결론: 센서 교체로 해결, 11/14 재가동 예정"');
      }
    }
    if (chars > 900 && !L.some(function (l) { return l.head; })) add('outline', L[0] || { i: 0, start: 0, raw: '' }, 0, 0, '제목 없이 ' + chars + '자', '긴 글에 제목이 없으면 원하는 부분을 찾기 어렵습니다.', '## 제목 두세 개로 나누기 (예: 현황 · 문제 · 다음 할 일)', '');
    // 글 종류별 빠진 칸
    var outline = null;
    if (CHECK[kind]) {
      outline = CHECK[kind].map(function (c) { return { label: c[0], ok: c[1].test(text) }; });
      outline.filter(function (c) { return !c.ok; }).forEach(function (c) {
        F.push({ k: 'missing', line: -1, start: -1, end: -1, quote: '', msg: KINDS[kind] + ' — "' + c.label + '" 칸이 없습니다', why: '읽는 사람이 꼭 찾는 칸입니다. 빠지면 다시 물어보게 됩니다.', hint: '"' + c.label + '" 를 제목이나 한 줄로 넣기', ex: '' });
      });
    }
    // 주간 보고 — 항목 줄에 % · 마감이 없는 것
    if (kind === 'weekly') {
      L.forEach(function (l) {
        if (/^\s*(?:[-*•]\s*)?\[[^\]]+\]\s*\S/.test(l.raw) && !/\[(개발|셋업|C\/S|CS|기타)/.test(l.raw) && !/\d+%|~\s?\d{1,2}\/\d{1,2}|#완료/.test(l.raw)) {
          add('number', l, 0, Math.min(l.raw.length, 40), '항목에 진척률 · 마감이 없습니다', '주간 보고를 읽는 사람은 "얼마나 됐고 언제 끝나는지" 를 먼저 봅니다.', '"50%" 나 "~11/15" 를 붙이기', '"- [A사] 컨베이어 설치 ~11/15 70% #진행중"');
        }
      });
    }
    F.sort(function (a, b) { return (a.start < 0 ? 1e9 : a.start) - (b.start < 0 ? 1e9 : b.start); });
    var counts = {};
    F.forEach(function (f) { counts[f.k] = (counts[f.k] || 0) + 1; });
    return { findings: F, counts: counts, scores: score(counts, chars, outline), outline: outline, kind: kind, chars: chars };
  }
  /** 규칙 점수 — 1000자당 개수로 (긴 글이라고 손해 보지 않게) */
  function score(c, chars, outline) {
    var per = 1000 / Math.max(500, chars);
    function r(k, w) { return (c[k] || 0) * per * w; }
    function cl(v) { return Math.max(20, Math.min(100, Math.round(v))); }
    var s = {
      clarity: cl(100 - r('long', 8) - r('passive', 5) - r('vague', 6) - r('spell', 8) - r('repeat', 3)),
      concise: cl(100 - r('filler', 7) - r('double', 6) - r('repeat', 4) - r('long', 3)),
      structure: cl(outline ? 100 * outline.filter(function (x) { return x.ok; }).length / outline.length - (c.head ? 15 : 0) : 100 - (c.head ? 25 : 0) - (c.outline ? 20 : 0)),
      evidence: cl(100 - r('number', 10) - r('vague', 5))
    };
    s.total = Math.round((s.clarity + s.concise + s.structure + s.evidence) / 4);
    return s;
  }
  function taskFor(k) { return TASKS[k] || TASKS.head; }

  return { check: check, detectKind: detectKind, LABELS: LABELS, KINDS: KINDS, TASKS: TASKS, taskFor: taskFor, score: score };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NbCoach;
