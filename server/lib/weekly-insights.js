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
 *
 * v13.311 opts:
 *   links   { merge: { 열쇠: 묶을 열쇠 }, split: { 열쇠: true } } — 사람이 손으로 묶고 나눈 것 (weekly_item_links)
 *           merge 는 글자 비교보다 먼저, split 은 글자 비교로 잇지 않고 따로 셈
 *   draftId 작성 중인 보고서(저장 전) 행 id — 그 보고서에서 본 일은 inDraft
 *   histKey 이 열쇠의 일만 주마다 기록(hist)까지 — 경과 기록 창
 *   goals   [{ member, metric, target }] — 목표 대비 실적 (goals[])
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
      by[k1] = { team: team, week: addDays(r.week_start, -7), kind: 'result', items: last, rowId: r.id };   // 결과가 계획보다 우선
    }
    var k2 = team + '|' + r.week_start;
    if (cur.length && !(by[k2] && by[k2].kind === 'result')) by[k2] = { team: team, week: r.week_start, kind: 'plan', items: cur, rowId: r.id };
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
  var links = opts.links || {}, merge = links.merge || {}, split = links.split || {};

  function canon(k) {       // 손으로 묶은 것 따라가기 (A→B→C, 고리 방지)
    for (var i = 0; i < 6 && merge[k] && merge[k] !== k; i++) k = merge[k];
    return k;
  }
  function addKey(t, k, name) {
    if (t.keys.indexOf(k) < 0) { t.keys.push(k); t.names.push(name || ''); }
  }
  function find(team, it, week) {
    var k = itemKey(team, it);
    if (byKey[k]) { addKey(byKey[k], k, it.name); return byKey[k]; }
    var c = canon(k);
    if (c !== k && byKey[c]) { byKey[k] = byKey[c]; addKey(byKey[c], k, it.name); byKey[c].manual = true; return byKey[c]; }
    if (c !== k) {        // 묶을 곳이 아직 안 나왔다 — 그 열쇠로 새로 만든다
      var tm = newTrack(c, team, it, week); tm.manual = true;
      byKey[k] = tm; addKey(tm, k, it.name);
      return tm;
    }
    // 이름이 조금 바뀐 같은 일 — 같은 팀 · 업체, 최근 4주 안에 본 것 중 가장 비슷한 것 (나눈 일은 빼고)
    var n = norm(it.name), best = null, bs = 0;
    if (!split[k]) tracks.forEach(function (t) {
      if (t.noFuzzy || t.team !== team || norm(t.client) !== norm(it.client)) return;
      if (Date.parse(week) - Date.parse(t.lastWeek) > 28 * DAY || t.lastWeek === week) return;
      var s = dice(norm(t.name), n);
      if (s > bs) { bs = s; best = t; }
    });
    if (best && bs >= 0.6) { byKey[k] = best; addKey(best, k, it.name); best.fuzzy = true; return best; }
    var t = newTrack(k, team, it, week);
    if (split[k]) t.noFuzzy = true;
    return t;
  }
  function newTrack(k, team, it, week) {
    var t = { key: k, team: team, client: it.client || '', name: it.name || '', section: it.section || 'etc', members: [], firstWeek: week, lastWeek: week,
      seen: [], pctHist: [], dlHist: [], statusHist: [], doneWeek: null, keys: [], names: [], hist: [], inDraft: false, slipWeek: null };
    tracks.push(t); byKey[k] = t; addKey(t, k, it.name);
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
      t.client = it.client || t.client;
      if (opts.draftId && s.rowId === opts.draftId) t.inDraft = true;
      if (opts.histKey) t.hist.push({ w: s.week, kind: s.kind, client: it.client || '', name: it.name || '', pct: typeof it.pct === 'number' ? it.pct : null,
        deadline: it.deadline || '', status: it.status || 'none', members: it.members || [],
        details: (it.details || []).slice(0, 8).map(function (d) { return { text: String(d.text || '').slice(0, 200), status: d.status || 'none' }; }) });
      (it.members || []).forEach(function (m) { if (t.members.indexOf(m) < 0) t.members.push(m); });
      if (typeof it.pct === 'number' && it.pct >= 0) t.pctHist.push({ w: s.week, p: it.pct });
      var dl = deadlineDate(it.deadline, s.week);
      if (dl && (!t.dlHist.length || t.dlHist[t.dlHist.length - 1].d !== dl)) {
        if (t.dlHist.length && dl > t.dlHist[t.dlHist.length - 1].d) t.slipWeek = s.week;
        t.dlHist.push({ w: s.week, d: dl });
      }
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
      doneWeek: t.doneWeek, cycleWeeks: cycle, onTime: onTime, state: state,
      slipWeek: t.slipWeek, inDraft: t.inDraft || undefined,
      variants: t.keys.length > 1 ? t.keys.map(function (k, i) { return { key: k, name: t.names[i] }; }) : undefined,
      linked: t.manual ? 'manual' : t.fuzzy ? 'auto' : undefined, split: t.noFuzzy || undefined,
      hist: opts.histKey && t.keys.indexOf(opts.histKey) >= 0 ? t.hist : undefined, dlHist: opts.histKey && t.keys.indexOf(opts.histKey) >= 0 ? t.dlHist : undefined
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

  var out = {
    range: { from: weeks[0] || null, to: lastWeek, asOf: asOf, weeks: weeks.length, reports: reps.length },
    weekly: weekly, kpi: kpi, risks: risks, byMember: byMember, bySection: bySection, byClient: byClient,
    findings: findings(weekly, kpi, risks, byMember, bySection),
    items: opts.withItems ? items : undefined
  };
  if (opts.histKey) out.item = items.filter(function (i) { return i.hist; })[0] || null;
  if (opts.goals) out.goals = evalGoals(opts.goals, out);
  if (opts.draftId) Object.defineProperty(out, '_items', { value: items, enumerable: false });
  return out;
}

function itemKey(team, it) { return (team || '') + '|' + norm(it.client) + '|' + norm(it.name); }

/* ─── 목표 (v13.311) — 정해 둔 값과 지금 기간의 실적 ─── */
var GOAL_METRICS = {
  throughput:     { label: '주당 끝낸 일', unit: '건', dir: 'ge', member: true },
  completionRate: { label: '완료율 (최근 4주 평균)', unit: '%', dir: 'ge', member: false },
  onTimeRate:     { label: '기한 안 완료율', unit: '%', dir: 'ge', member: true },
  cycle:          { label: '끝내는 데 걸린 주 (평균)', unit: '주', dir: 'le', member: true },
  overdue:        { label: '납기 지난 일', unit: '건', dir: 'le', member: true },
  stalled:        { label: '정체된 일', unit: '건', dir: 'le', member: true },
  active:         { label: '동시에 진행 중', unit: '건', dir: 'le', member: true }
};
function goalActual(metric, out, member) {
  if (member) {
    var m = out.byMember.filter(function (x) { return x.key === member; })[0];
    if (!m) return null;
    return { throughput: m.throughput, onTimeRate: m.onTimeRate, cycle: m.cycleAvg, overdue: m.overdue, stalled: m.stalled, active: m.active }[metric];
  }
  var k = out.kpi;
  if (metric === 'completionRate') {
    var ws = out.weekly.slice(-4);
    return ws.length ? r1(avg(ws.map(function (w) { return w.completionRate; }))) : null;
  }
  return { throughput: k.throughput, onTimeRate: k.onTimeRate, cycle: k.cycleAvg, overdue: k.overdue, stalled: k.stalled, active: k.active }[metric];
}
function evalGoals(goals, out) {
  return (goals || []).filter(function (g) { return GOAL_METRICS[g.metric] && (!g.member || GOAL_METRICS[g.metric].member); }).map(function (g) {
    var def = GOAL_METRICS[g.metric], target = Number(g.target);
    var actual = goalActual(g.metric, out, g.member || '');
    if (actual === undefined) actual = null;
    var ok = null, ratio = null;
    if (actual != null && !isNaN(target)) {
      ok = def.dir === 'ge' ? actual >= target : actual <= target;
      ratio = def.dir === 'ge' ? (target > 0 ? actual / target : 1) : (actual > 0 ? target / actual : 1);
      ratio = Math.max(0, Math.min(1, ratio));
    }
    return { member: g.member || '', metric: g.metric, label: def.label, unit: def.unit, dir: def.dir, target: target, actual: actual, ok: ok, ratio: ratio == null ? null : Math.round(ratio * 100) };
  });
}

/* ─── 작성 중 점검 (v13.311) — 분석 탭에서 보기 전에, 쓰는 순간 잡는다 ───
 * rows: 작성 주차 앞 보고서들 · draft: { team, week_start, parsed: { last, cur } }
 * 돌려줌: missing(바로 앞 주 보고서에 있던 일이 빠짐) · flags(지남 · 정체 · 뒤처짐 · 연기) · quality(납기 · 담당 없음) */
function check(rows, draft, opts) {
  opts = opts || {};
  var W = draft.week_start, DRAFT = '__draft';
  var last = (draft.parsed.last && draft.parsed.last.items) || [], cur = (draft.parsed.cur && draft.parsed.cur.items) || [];
  var res = { week: W, missing: [], flags: [], quality: [], lastEmpty: !last.length, prevWeeks: 0 };
  if (!last.length && !cur.length) return res;
  var all = (rows || []).concat([Object.assign({}, draft, { id: DRAFT, updated_at: '9999-12-31T00:00:00Z' })]);
  var out = compute(all, { links: opts.links, draftId: DRAFT });
  var items = out._items;
  res.prevWeeks = out.range.weeks;
  var since = addDays(W, -7);    // 바로 앞 주에 있던 일만 (더 전에 빠진 건 분석 탭 '사라짐')
  // 빠진 일 — 앞 보고서들만으로 본 일 중, 작성 중인 보고서에 (열쇠로도 · 비슷한 이름으로도) 없는 것
  // (지난주 칸 결과가 그 주 계획을 덮어써서 전체 계산에선 계획에만 있던 일이 안 보이므로 따로 계산)
  var inKeys = {}, inDraft = items.filter(function (i) { return i.inDraft; });
  inDraft.forEach(function (i) { (i.variants || [{ key: i.key }]).forEach(function (v) { inKeys[v.key] = true; }); });
  var prev = rows && rows.length ? compute(rows, { links: opts.links, withItems: true }).items : [];
  var bin = opts.bin || {};   // v13.490 🗑 휴지통 — { item_key: 없앨 때 마지막으로 본 주 }. 그 주 뒤에 다시 나온 일은 다시 점검
  res.binned = 0;
  prev.forEach(function (i) {
    if (i.doneWeek || i.lastWeek < since) return;
    if ((i.variants || [{ key: i.key }]).some(function (v) { return inKeys[v.key]; })) return;
    if ((i.variants || [{ key: i.key }]).some(function (v) { return bin[v.key] && bin[v.key] >= i.lastWeek; })) { res.binned++; return; }
    if (!i.split && inDraft.some(function (d) { return norm(d.client) === norm(i.client) && dice(norm(d.name), norm(i.name)) >= 0.6; })) return;
    res.missing.push({ key: i.key, team: i.team, section: i.section, client: i.client, name: i.name, members: i.members, pct: i.pct, deadline: i.deadline, lastWeek: i.lastWeek, line: itemLine(i) });
  });
  items.forEach(function (i) {
    if (!i.inDraft || i.doneWeek) return;
    var base = { key: i.key, client: i.client, name: i.name };
    if (i.deadline && i.deadline < W) res.flags.push(Object.assign({ kind: 'overdue', text: '납기 ' + md(i.deadline) + ' 지남 — 끝냈으면 #완료, 아니면 새 납기로' }, base));
    else if (i.state === 'stalled') res.flags.push(Object.assign({ kind: 'stalled', text: '3주째 진행률 ' + (i.pct == null ? '' : i.pct + '% ') + '그대로 — 막힌 곳을 세부 줄로' }, base));
    else if (i.state === 'at_risk') res.flags.push(Object.assign({ kind: 'at_risk', text: '진행률 ' + i.pct + '% · 일정상 ' + i.expected + '% — 뒤처짐' }, base));
    if (i.slipWeek && i.slipWeek >= addDays(W, -7)) res.flags.push(Object.assign({ kind: 'slipped', text: '납기 미룸 ' + md(i.deadlineFirst) + ' → ' + md(i.deadline) + (i.slips > 1 ? ' (모두 ' + i.slips + '번)' : '') }, base));
  });
  cur.forEach(function (it) {
    if (it.status === 'done') return;
    var miss = [];
    if (!it.deadline && it.status === 'in_progress') miss.push('납기');
    if (!(it.members || []).length) miss.push('담당');
    if (miss.length) res.quality.push({ key: itemKey(draft.team, it), client: it.client || '', name: it.name || '', text: miss.join(' · ') + ' 없음' });
  });
  return res;
}
function md(d) { return d ? d.slice(5).replace('-', '/') : ''; }
function itemLine(i) {
  return '- [' + (i.client || '') + '] ' + i.name + (i.deadline ? ' ~' + md(i.deadline) : '') + (i.pct != null ? ' ' + i.pct + '%' : '')
    + (i.members || []).map(function (m) { return ' @' + m; }).join('');
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
  if (r.goals && r.goals.length) L.push('목표 대비: ' + r.goals.map(function (g) { return (g.member ? g.member + ' ' : '팀 ') + g.label + ' 목표 ' + (g.dir === 'ge' ? '≥' : '≤') + g.target + g.unit + ' · 실적 ' + (g.actual == null ? '-' : g.actual + g.unit) + (g.ok == null ? '' : g.ok ? ' 달성' : ' 미달'); }).join(' | '));
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

/** 손으로 묶고 나눈 것 (v13.311) — compute 의 opts.links 모양으로 */
async function loadLinks(db, tenantId) {
  var r = await db.query('SELECT item_key, kind, target_key FROM weekly_item_links WHERE tenant_id = $1', [tenantId]);
  var out = { merge: {}, split: {} };
  r.rows.forEach(function (x) { if (x.kind === 'merge' && x.target_key) out.merge[x.item_key] = x.target_key; else if (x.kind === 'split') out.split[x.item_key] = true; });
  return out;
}
/** 팀(빈 값 = 모든 팀) 목표 */
/** 🗑 휴지통 (v13.490) — 점검에서 빼 둔 일 { item_key: 'YYYY-MM-DD'(마지막으로 본 주) } */
async function loadBin(db, tenantId, team) {
  var r = await db.query("SELECT item_key, to_char(last_week, 'YYYY-MM-DD') AS w FROM weekly_item_bin WHERE tenant_id = $1 AND team = $2", [tenantId, team || '']);
  var out = {};
  r.rows.forEach(function (x) { out[x.item_key] = x.w || '9999-12-31'; });
  return out;
}
async function loadGoals(db, tenantId, team) {
  var r = await db.query('SELECT member, metric, target::float AS target FROM weekly_goals WHERE tenant_id = $1 AND team = $2 ORDER BY member, metric', [tenantId, team || '']);
  return r.rows;
}

module.exports = { loadLinks: loadLinks, loadBin: loadBin, loadGoals: loadGoals, GOAL_METRICS: GOAL_METRICS, check: check, itemKey: itemKey, itemLine: itemLine, load: load, compute: compute, toText: toText, latestPerWeek: latestPerWeek, snapshots: snapshots, deadlineDate: deadlineDate, dice: dice, norm: norm };
