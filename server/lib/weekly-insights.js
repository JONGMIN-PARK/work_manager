/**
 * 주간 업무 보고 → 분석 (v13.310) — 보고용으로 끝나지 않게, 주를 넘어 같은 일을 이어 붙여 추세 · 경과 · 효율을 본다.
 *
 * 입력: weekly_reports 행 [{ id, team, week_start 'YYYY-MM-DD', updated_at, parsed: { last:{items}, cur:{items} } }]
 *   · 같은 팀 · 주차의 여러 버전(R1, R2 …)은 가장 최근 것만 (예전 /stats 는 모두 더해 두 번 셌다)
 *   · 보고서 하나 = 지난주 실적(last, 주 W-1 결과) + 이번 주 계획(cur, 주 W 시작 상태)
 *     → 주마다 '결과'가 있으면 결과, 없으면 계획을 그 주의 모습으로 씀
 * 같은 일 잇기: 팀 + 업체 + 이름(공백 · 기호 뺀 것). 이름이 조금 바뀌면 같은 업체 안에서 글자 겹침(바이그램 Dice ≥ 0.6)으로 이음
 *
 * 출력 (compute):
 *   weekly[]   주별 — 전체 · 완료 · 진행 · 예정 · 새로 · 끝냄 · 이월 · 완료율 · 평균 진행률
 *   kpi        처리량(주당 끝낸 수) · 진행 중 평균 · 완료까지 주 수(중앙 · 평균) · 납기 안 완료율 · 연기 · 정체 · 지남 · 사라짐
 *   items[]    일마다 — 처음 · 마지막 주 · 진행률 흐름 · 납기 흐름 · 연기 횟수 · 끝낸 주 · 걸린 주 · 지금 상태
 *   risks      overdue(납기 지남) · atRisk(진행률이 일정보다 뒤짐) · stalled(3주째 그대로) · slipped(납기 미룸) · dropped(끝내지 않고 사라짐)
 *   byMember · bySection · byClient   사람 · 분야 · 업체별 효율
 *   findings[] 규칙으로 뽑은 한 줄 결론 (AI 없이)
 */
var SECTION_LABEL = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
var DAY = 86400000;

function ymd(d) { return new Date(d).toISOString().slice(0, 10); }
function addDays(s, n) { return ymd(Date.parse(s + 'T00:00:00Z') + n * DAY); }
function norm(s) { return String(s || '').toLowerCase().replace(/[\s\-_.,()[\]{}·:/\\'"`~!?#@%&*+=|<>]+/g, ''); }
function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) o[s.slice(i, i + 2)] = (o[s.slice(i, i + 2)] || 0) + 1; return o; }
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  var A = bigrams(a), B = bigrams(b), n = 0, ta = 0, tb = 0, k;
  for (k in A) ta += A[k];
  for (k in B) { tb += B[k]; if (A[k]) n += Math.min(A[k], B[k]); }
  return ta + tb ? (2 * n) / (ta + tb) : 0;
}
function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
function r1(n) { return n == null ? null : Math.round(n * 10) / 10; }

/** '~MM/DD' → 'YYYY-MM-DD' — 기준 주에서 반년 안쪽 해로 */
function deadlineDate(dl, baseYmd) {
  var m = /(\d{1,2})\/(\d{1,2})/.exec(String(dl || ''));
  if (!m || !baseYmd) return null;
  var y = +baseYmd.slice(0, 4), mm = ('0' + m[1]).slice(-2), dd = ('0' + m[2]).slice(-2);
  var c = y + '-' + mm + '-' + dd, base = Date.parse(baseYmd + 'T00:00:00Z'), t = Date.parse(c + 'T00:00:00Z');
  if (isNaN(t)) return null;
  if (t < base - 180 * DAY) c = (y + 1) + '-' + mm + '-' + dd;
  else if (t > base + 185 * DAY) c = (y - 1) + '-' + mm + '-' + dd;
  return c;
}

/** 같은 팀 · 주차는 가장 최근 저장본만 */
function latestPerWeek(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (!r.week_start) return;
    var k = (r.team || '') + '|' + r.week_start;
    var t = Date.parse(r.updated_at || r.saved_at || 0) || 0;
    if (!by[k] || t >= by[k]._t) by[k] = Object.assign({}, r, { _t: t });
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

/** 주마다 한 장 — { team, week, kind: 'result'|'plan', items } */
function snapshots(rows) {
  var by = {};
  rows.forEach(function (r) {
    var p = r.parsed || {};
    var team = r.team || '';
    var last = (p.last && p.last.items) || [], cur = (p.cur && p.cur.items) || [];
    if (last.length) {
      var k1 = team + '|' + addDays(r.week_start, -7);
      by[k1] = { team: team, week: addDays(r.week_start, -7), kind: 'result', items: last };   // 결과가 계획보다 우선
    }
    var k2 = team + '|' + r.week_start;
    if (cur.length && !(by[k2] && by[k2].kind === 'result')) by[k2] = { team: team, week: r.week_start, kind: 'plan', items: cur };
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.week < b.week ? -1 : a.week > b.week ? 1 : 0; });
}

function compute(rows, opts) {
  opts = opts || {};
  var reps = latestPerWeek(rows);
  var snaps = snapshots(reps);
  var weeks = [];
  snaps.forEach(function (s) { if (weeks.indexOf(s.week) < 0) weeks.push(s.week); });
  weeks.sort();
  var tracks = [];          // 일마다
  var byKey = {};           // team|client|norm(name) → track

  function find(team, it, week) {
    var k = team + '|' + norm(it.client) + '|' + norm(it.name);
    if (byKey[k]) return byKey[k];
    // 이름이 조금 바뀐 같은 일 — 같은 팀 · 업체, 최근 4주 안에 본 것 중 가장 비슷한 것
    var n = norm(it.name), best = null, bs = 0;
    tracks.forEach(function (t) {
      if (t.team !== team || norm(t.client) !== norm(it.client)) return;
      if (Date.parse(week) - Date.parse(t.lastWeek) > 28 * DAY || t.lastWeek === week) return;
      var s = dice(norm(t.name), n);
      if (s > bs) { bs = s; best = t; }
    });
    if (best && bs >= 0.6) { byKey[k] = best; return best; }
    var t = { key: k, team: team, client: it.client || '', name: it.name || '', section: it.section || 'etc', members: [], firstWeek: week, lastWeek: week,
      seen: [], pctHist: [], dlHist: [], statusHist: [], doneWeek: null };
    tracks.push(t); byKey[k] = t;
    return t;
  }

  var weekly = weeks.map(function (w) { return { week: w, total: 0, done: 0, doing: 0, planned: 0, newItems: 0, closed: 0, carried: 0, pctSum: 0, pctN: 0 }; });
  var wIdx = {}; weeks.forEach(function (w, i) { wIdx[w] = i; });

  snaps.forEach(function (s) {
    var W = weekly[wIdx[s.week]];
    var seenThis = {};
    s.items.forEach(function (it) {
      var t = find(s.team, it, s.week);
      if (seenThis[t.key]) return;          // 같은 주에 같은 일이 두 번 — 한 번만
      seenThis[t.key] = true;
      var prevWeek = t.seen.length ? t.seen[t.seen.length - 1] : null;
      var isNew = !t.seen.length;
      t.seen.push(s.week); t.lastWeek = s.week;
      t.name = it.name || t.name;
      (it.members || []).forEach(function (m) { if (t.members.indexOf(m) < 0) t.members.push(m); });
      if (typeof it.pct === 'number' && it.pct >= 0) t.pctHist.push({ w: s.week, p: it.pct });
      var dl = deadlineDate(it.deadline, s.week);
      if (dl && (!t.dlHist.length || t.dlHist[t.dlHist.length - 1].d !== dl)) t.dlHist.push({ w: s.week, d: dl });
      var st = it.status === 'done' ? 'done' : it.status === 'in_progress' ? 'doing' : 'planned';
      t.statusHist.push({ w: s.week, s: st });
      W.total++;
      W[st === 'done' ? 'done' : st === 'doing' ? 'doing' : 'planned']++;
      if (typeof it.pct === 'number' && it.pct >= 0) { W.pctSum += it.pct; W.pctN++; }
      if (isNew) W.newItems++;
      else if (prevWeek && Date.parse(s.week) - Date.parse(prevWeek) <= 14 * DAY) W.carried++;
      if (st === 'done' && !t.doneWeek) { t.doneWeek = s.week; W.closed++; }
    });
  });

  var lastWeek = weeks[weeks.length - 1] || null;
  var asOf = lastWeek ? addDays(lastWeek, 6) : ymd(Date.now());   // 마지막 주 끝(일요일)
  var asOfT = Date.parse(asOf + 'T00:00:00Z');

  var items = tracks.map(function (t) {
    var last = t.statusHist[t.statusHist.length - 1] || {};
    var done = !!t.doneWeek;
    var dl = t.dlHist.length ? t.dlHist[t.dlHist.length - 1].d : null;
    var slips = 0;
    for (var i = 1; i < t.dlHist.length; i++) if (t.dlHist[i].d > t.dlHist[i - 1].d) slips++;
    var pct = t.pctHist.length ? t.pctHist[t.pctHist.length - 1].p : (done ? 100 : null);
    var cycle = done ? Math.round((Date.parse(t.doneWeek) - Date.parse(t.firstWeek)) / (7 * DAY)) + 1 : null;
    var onTime = done && dl ? t.doneWeek <= dl : null;   // 끝낸 주(시작일)가 납기 이전이면 기한 안
    // 지금 상태
    var state;
    var gone = !done && lastWeek && t.lastWeek < addDays(lastWeek, -7);   // 2주 넘게 안 보임 — 끝냈다는 표시 없이 사라짐
    var stalled = false;
    if (!done && t.seen.length >= 3) {
      var recent = t.pctHist.filter(function (h) { return h.w >= t.seen[t.seen.length - 3]; });
      if (recent.length >= 2) stalled = recent[recent.length - 1].p <= recent[0].p;
      else if (!t.pctHist.length) stalled = t.seen.length >= 4 && last.s !== 'planned';
    }
    var expected = null;
    if (!done && dl && t.firstWeek < dl) {
      var span = Date.parse(dl) - Date.parse(t.firstWeek);
      expected = Math.max(0, Math.min(100, Math.round((asOfT - Date.parse(t.firstWeek)) / span * 100)));
    }
    if (done) state = onTime === false ? 'done_late' : 'done';
    else if (gone) state = 'dropped';
    else if (dl && dl < asOf) state = 'overdue';
    else if (stalled) state = 'stalled';
    else if (expected != null && pct != null && pct + 20 < expected) state = 'at_risk';
    else state = dl ? 'on_track' : 'open';
    return {
      key: t.key, team: t.team, client: t.client, name: t.name, section: t.section, sectionLabel: SECTION_LABEL[t.section] || t.section,
      members: t.members, firstWeek: t.firstWeek, lastWeek: t.lastWeek, weeks: t.seen.length,
      status: done ? 'done' : last.s || 'planned', pct: pct, expected: expected,
      pctHist: t.pctHist, deadline: dl, deadlineFirst: t.dlHist.length ? t.dlHist[0].d : null, slips: slips,
      doneWeek: t.doneWeek, cycleWeeks: cycle, onTime: onTime, state: state
    };
  });

  weekly.forEach(function (w) {
    w.completionRate = w.total ? r1(w.done / w.total * 100) : 0;
    w.avgPct = w.pctN ? Math.round(w.pctSum / w.pctN) : null;
    delete w.pctSum; delete w.pctN;
  });

  var doneItems = items.filter(function (i) { return i.doneWeek; });
  var cycles = doneItems.map(function (i) { return i.cycleWeeks; }).filter(function (x) { return x != null; });
  var withDl = doneItems.filter(function (i) { return i.onTime != null; });
  function pick(state, n) { return items.filter(function (i) { return i.state === state; }).sort(function (a, b) { return (a.deadline || '9') < (b.deadline || '9') ? -1 : 1; }).slice(0, n || 20); }
  var risks = {
    overdue: pick('overdue'), atRisk: pick('at_risk'), stalled: pick('stalled'),
    slipped: items.filter(function (i) { return i.slips > 0 && i.state !== 'done'; }).sort(function (a, b) { return b.slips - a.slips; }).slice(0, 20),
    dropped: pick('dropped')
  };
  var active = items.filter(function (i) { return ['overdue', 'at_risk', 'stalled', 'on_track', 'open'].indexOf(i.state) >= 0; });
  var kpi = {
    weeks: weeks.length, items: items.length, active: active.length, done: doneItems.length,
    throughput: weeks.length ? r1(doneItems.length / weeks.length) : 0,
    wipAvg: r1(avg(weekly.map(function (w) { return w.doing; })) || 0),
    cycleMedian: r1(median(cycles)), cycleAvg: r1(avg(cycles)),
    onTimeRate: withDl.length ? r1(withDl.filter(function (i) { return i.onTime; }).length / withDl.length * 100) : null,
    overdue: risks.overdue.length, atRisk: risks.atRisk.length, stalled: risks.stalled.length,
    slipped: items.filter(function (i) { return i.slips > 0; }).length, slipsTotal: items.reduce(function (s, i) { return s + i.slips; }, 0),
    dropped: risks.dropped.length,
    completionRate: weekly.length ? weekly[weekly.length - 1].completionRate : 0
  };

  function groupBy(keyFn) {
    var g = {};
    items.forEach(function (i) {
      (keyFn(i) || []).forEach(function (k) {
        var e = g[k] = g[k] || { key: k, items: 0, done: 0, active: 0, overdue: 0, stalled: 0, atRisk: 0, cyc: [], ontime: 0, dlDone: 0 };
        e.items++;
        if (i.doneWeek) { e.done++; if (i.cycleWeeks != null) e.cyc.push(i.cycleWeeks); if (i.onTime != null) { e.dlDone++; if (i.onTime) e.ontime++; } }
        if (['overdue', 'at_risk', 'stalled', 'on_track', 'open'].indexOf(i.state) >= 0) e.active++;
        if (i.state === 'overdue') e.overdue++;
        if (i.state === 'stalled') e.stalled++;
        if (i.state === 'at_risk') e.atRisk++;
      });
    });
    return Object.keys(g).map(function (k) {
      var e = g[k];
      return { key: k, items: e.items, done: e.done, active: e.active, overdue: e.overdue, stalled: e.stalled, atRisk: e.atRisk,
        cycleAvg: r1(avg(e.cyc)), onTimeRate: e.dlDone ? r1(e.ontime / e.dlDone * 100) : null,
        throughput: weeks.length ? r1(e.done / weeks.length) : 0 };
    }).sort(function (a, b) { return b.items - a.items; });
  }
  var byMember = groupBy(function (i) { return i.members.length ? i.members : ['(담당 없음)']; });
  var bySection = groupBy(function (i) { return [i.section]; }).map(function (e) { e.label = SECTION_LABEL[e.key] || e.key; return e; });
  var byClient = groupBy(function (i) { return [i.client || '(없음)']; }).slice(0, 15);

  return {
    range: { from: weeks[0] || null, to: lastWeek, asOf: asOf, weeks: weeks.length, reports: reps.length },
    weekly: weekly, kpi: kpi, risks: risks, byMember: byMember, bySection: bySection, byClient: byClient,
    findings: findings(weekly, kpi, risks, byMember, bySection),
    items: opts.withItems ? items : undefined
  };
}

/** 규칙으로 뽑은 결론 — AI 없이도 무엇을 봐야 하는지 */
function findings(weekly, kpi, risks, byMember, bySection) {
  var f = [];
  if (!weekly.length) return f;
  var n = weekly.length, h = Math.max(1, Math.min(4, Math.floor(n / 2)));
  if (n >= 4) {
    var a = avg(weekly.slice(-h * 2, -h).map(function (w) { return w.completionRate; })), b = avg(weekly.slice(-h).map(function (w) { return w.completionRate; }));
    var d = r1(b - a);
    if (Math.abs(d) >= 5) f.push({ level: d > 0 ? 'good' : 'warn', text: '완료율 ' + (d > 0 ? '상승' : '하락') + ' — 앞 ' + h + '주 ' + r1(a) + '% → 최근 ' + h + '주 ' + r1(b) + '% (' + (d > 0 ? '+' : '') + d + '%p)' });
    var ta = avg(weekly.slice(-h * 2, -h).map(function (w) { return w.closed; })), tb = avg(weekly.slice(-h).map(function (w) { return w.closed; }));
    if (ta != null && tb != null && Math.abs(tb - ta) >= 1) f.push({ level: tb > ta ? 'good' : 'warn', text: '주당 끝낸 일 ' + r1(ta) + ' → ' + r1(tb) + '건' });
    var na = avg(weekly.slice(-h * 2, -h).map(function (w) { return w.newItems; })), nb = avg(weekly.slice(-h).map(function (w) { return w.newItems; }));
    if (nb != null && tb != null && nb > tb + 1) f.push({ level: 'warn', text: '새로 생기는 일(주 ' + r1(nb) + '건)이 끝내는 일(주 ' + r1(tb) + '건)보다 많아 쌓이는 중' });
  }
  if (kpi.overdue) f.push({ level: 'risk', text: '납기 지난 일 ' + kpi.overdue + '건 — ' + risks.overdue.slice(0, 3).map(function (i) { return i.client + ' ' + i.name; }).join(', ') });
  if (kpi.atRisk) f.push({ level: 'warn', text: '진행률이 일정보다 20%p 넘게 뒤처진 일 ' + kpi.atRisk + '건' });
  if (kpi.stalled) f.push({ level: 'warn', text: '3주째 진척 없는 일 ' + kpi.stalled + '건 — 막힌 곳 확인 필요' });
  if (kpi.slipped) f.push({ level: 'warn', text: '납기를 미룬 일 ' + kpi.slipped + '건 (모두 ' + kpi.slipsTotal + '번)' });
  if (kpi.dropped) f.push({ level: 'info', text: '끝냈다는 표시 없이 보고서에서 사라진 일 ' + kpi.dropped + '건 — 완료 표시 누락인지 확인' });
  if (kpi.onTimeRate != null) f.push({ level: kpi.onTimeRate >= 80 ? 'good' : kpi.onTimeRate >= 60 ? 'info' : 'warn', text: '납기가 있던 일 중 기한 안에 끝낸 비율 ' + kpi.onTimeRate + '%' });
  if (kpi.cycleMedian != null) f.push({ level: 'info', text: '일 하나를 끝내는 데 보통 ' + kpi.cycleMedian + '주 (평균 ' + kpi.cycleAvg + '주)' });
  var busy = byMember.filter(function (m) { return m.key !== '(담당 없음)'; }).sort(function (a, b) { return b.active - a.active; })[0];
  if (busy && busy.active >= 5) f.push({ level: 'warn', text: '가장 많이 맡은 사람: ' + busy.key + ' — 진행 중 ' + busy.active + '건' });
  var big = bySection.slice().sort(function (a, b) { return b.items - a.items; })[0];
  if (big) f.push({ level: 'info', text: '가장 많은 분야: ' + big.label + ' (' + big.items + '건, 완료 ' + big.done + ')' });
  return f;
}

/** AI 질문용 요약 글 (숫자 · 위험 목록) */
function toText(r) {
  var k = r.kpi, L = [];
  L.push('기간 ' + r.range.from + ' ~ ' + r.range.to + ' (' + r.range.weeks + '주, 보고서 ' + r.range.reports + '개)');
  L.push('일 ' + k.items + '개 · 끝냄 ' + k.done + ' · 진행 중 ' + k.active + ' · 주당 처리 ' + k.throughput + ' · 완료까지 중앙 ' + k.cycleMedian + '주 · 납기 안 완료율 ' + (k.onTimeRate == null ? '-' : k.onTimeRate + '%'));
  L.push('위험: 납기 지남 ' + k.overdue + ' · 뒤처짐 ' + k.atRisk + ' · 정체 ' + k.stalled + ' · 납기 연기 ' + k.slipped + ' · 사라짐 ' + k.dropped);
  L.push('주별: ' + r.weekly.map(function (w) { return w.week.slice(5) + ' 전체' + w.total + '/완료' + w.done + '/새' + w.newItems + '/끝냄' + w.closed + '(' + w.completionRate + '%)'; }).join(' | '));
  ['overdue', 'atRisk', 'stalled', 'slipped'].forEach(function (key) {
    var nm = { overdue: '납기 지남', atRisk: '뒤처짐', stalled: '정체', slipped: '납기 연기' }[key];
    r.risks[key].slice(0, 8).forEach(function (i) { L.push('[' + nm + '] ' + i.client + ' ' + i.name + ' · 담당 ' + (i.members.join(',') || '-') + ' · 납기 ' + (i.deadline || '-') + ' · ' + (i.pct == null ? '-' : i.pct + '%') + (i.slips ? ' · 연기 ' + i.slips + '번' : '')); });
  });
  r.byMember.slice(0, 12).forEach(function (m) { L.push('[사람] ' + m.key + ' 전체' + m.items + ' 끝냄' + m.done + ' 진행' + m.active + ' 지남' + m.overdue + ' 정체' + m.stalled + ' 평균' + (m.cycleAvg == null ? '-' : m.cycleAvg + '주') + ' 기한내' + (m.onTimeRate == null ? '-' : m.onTimeRate + '%')); });
  r.bySection.forEach(function (s) { L.push('[분야] ' + s.label + ' 전체' + s.items + ' 끝냄' + s.done + ' 평균' + (s.cycleAvg == null ? '-' : s.cycleAvg + '주')); });
  return L.join('\n');
}

/** DB 에서 분석할 보고서 읽기 — q: { team, weeks(기본 12), from, to } */
async function load(db, tenantId, q) {
  q = q || {};
  var where = ['tenant_id = $1', 'week_start IS NOT NULL'];
  var params = [tenantId];
  var idx = 2;
  if (q.team) { where.push('team = $' + idx++); params.push(String(q.team)); }
  if (q.from) { where.push('week_start >= $' + idx++); params.push(q.from); }
  if (q.to) { where.push('week_start <= $' + idx++); params.push(q.to); }
  if (!q.from && !q.to) {
    var n = Math.min(Math.max(parseInt(q.weeks, 10) || 12, 1), 104);
    where.push('week_start >= (CURRENT_DATE - $' + idx++ + '::int * 7)'); params.push(n + 1);
  }
  var r = await db.query(
    "SELECT id, team, to_char(week_start, 'YYYY-MM-DD') AS week_start, updated_at, saved_at, " +
    "jsonb_build_object('last', parsed->'last', 'cur', parsed->'cur') AS parsed " +
    'FROM weekly_reports WHERE ' + where.join(' AND ') + ' ORDER BY week_start', params);
  return r.rows;
}

module.exports = { load: load, compute: compute, toText: toText, latestPerWeek: latestPerWeek, snapshots: snapshots, deadlineDate: deadlineDate, dice: dice, norm: norm };
