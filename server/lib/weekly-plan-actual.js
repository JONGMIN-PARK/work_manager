/**
 * 주간 업무 — 🎯 계획 대비 실적 (v13.492)
 *
 * 놓치는 업무가 없게: 주 W 의 계획(그 주 보고서의 '금주' 칸)과 주 W 의 실적(다음 주 보고서의 '지난주' 칸)을 짝지어
 * 계획한 일이 어떻게 됐는지, 계획에 없던 일이 얼마나 끼어들었는지, 무엇이 모자라서(인력 · 일정 · 계획 · 집중 · 보고) 그런지를 본다.
 *
 * 짝짓기: 같은 팀 · 업체(공백 · 기호 뺀 이름이 같거나 한쪽이 다른 쪽을 품음) + 업무 이름 글자 겹침(Dice ≥ 0.5),
 *         손으로 묶은 것(weekly_item_links merge)이 먼저. 점수 높은 짝부터 하나씩.
 * 결과(계획 1건마다):
 *   done        실적 칸에 완료(#완료 · 100%)
 *   progressed  실적 칸에 있고 나아감(#진행 · 진행률 올라감 · 세부 줄 완료/진행)
 *   stalled     실적 칸에 있는데 나아간 표시가 없음
 *   unreported  실적 칸엔 없는데 그 주 업무일지에 그 업체 시간이 있음 — 일은 했는데 보고에서 빠짐
 *   missed      실적 칸에도 업무일지에도 없음 — 계획만 하고 못 함
 *   (실적 칸에만 있는 일) unplanned — 계획 외로 끼어든 일
 * 이행률 = (완료 + 진척 + 보고 누락) / 계획 · 완료율 = 완료 / 계획 · 계획 외 비율 = 계획 외 / 실적 칸 전체
 *
 * 업무일지(work_records: date 'YYYYMMDD' · name · oclient · ocmt · abbr · hours) — 사람 · 업체 · 주별 투입 시간. 휴가(abbr V)는 뺌.
 * 거르기(모두 AND, 같은 축 안에서는 OR): clients · members · projects('업체|이름') · sections(dev setup cs etc)
 */
var wi = require('./weekly-insights');
var norm = wi.norm, dice = wi.dice;
var DAY = 86400000;
var SECTION_LABEL = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
var ABBR_SECTION = { D: 'dev', M: 'setup', A: 'cs' };
var PLAN_RES = ['done', 'progressed', 'stalled', 'unreported', 'missed'];

function ymd(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays(s, n) { return ymd(Date.parse(s + 'T00:00:00Z') + n * DAY); }
function mondayOf(s) { var t = Date.parse(s + 'T00:00:00Z'); var d = new Date(t).getUTCDay(); return ymd(t - ((d + 6) % 7) * DAY); }
function r1(n) { return n == null || isNaN(n) ? null : Math.round(n * 10) / 10; }
function pct(a, b) { return b ? r1(a / b * 100) : null; }

function clientMatch(a, b) {
  a = norm(a); b = norm(b);
  return !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 2 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)));
}
function hasPct(it) { return typeof it.pct === 'number' && it.pct >= 0; }
function isDone(it) { return it.status === 'done' || (hasPct(it) && it.pct >= 100); }
function moved(a, p) {
  if (a.status === 'in_progress') return true;
  if (hasPct(a) && hasPct(p) && a.pct > p.pct) return true;
  return (a.details || []).some(function (d) { return d.status === 'done' || d.status === 'in_progress'; });
}

/** 계획 · 실적 짝짓기 — [{ p, a }] + 남은 실적 */
function matchItems(team, plan, actual, canon) {
  var pairs = [];
  plan.forEach(function (p, i) {
    var kp = canon(wi.itemKey(team, p));
    actual.forEach(function (a, j) {
      var s = canon(wi.itemKey(team, a)) === kp ? 2 : (clientMatch(p.client, a.client) ? dice(norm(p.name), norm(a.name)) : 0);
      if (s >= 0.5) pairs.push({ i: i, j: j, s: s });
    });
  });
  pairs.sort(function (x, y) { return y.s - x.s; });
  var usedP = {}, usedA = {}, out = [];
  pairs.forEach(function (x) { if (usedP[x.i] || usedA[x.j]) return; usedP[x.i] = usedA[x.j] = true; out.push({ p: plan[x.i], a: actual[x.j] }); });
  plan.forEach(function (p, i) { if (!usedP[i]) out.push({ p: p, a: null }); });
  actual.forEach(function (a, j) { if (!usedA[j]) out.push({ p: null, a: a }); });
  return out;
}

function hourSection(h) { var a = String(h.abbr || '').trim().toUpperCase().charAt(0); return a === 'V' ? null : (ABBR_SECTION[a] || 'etc'); }
function hourWeek(h) { var d = String(h.date || '').replace(/-/g, ''); return d.length >= 8 ? mondayOf(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8)) : null; }

/**
 * rows: weekly_reports (wi.load 모양) · hours: work_records 행 · opts { links, from, to, capacity, filter: { clients, members, projects, sections }, insightItems }
 */
function compute(rows, hours, opts) {
  opts = opts || {};
  var f = opts.filter || {};
  var cap = Math.max(1, Math.min(80, Number(opts.capacity) || 40));
  var links = opts.links || {}, merge = links.merge || {};
  function canon(k) { for (var i = 0; i < 6 && merge[k] && merge[k] !== k; i++) k = merge[k]; return k; }

  // 팀 · 주차마다 가장 최근 보고서
  var reps = wi.latestPerWeek(rows), byTW = {};
  reps.forEach(function (r) { byTW[(r.team || '') + '|' + r.week_start] = r; });

  // 업무일지 — 휴가 빼고 주 · 사람 · 업체로
  var H = [];
  (hours || []).forEach(function (h) {
    var sec = hourSection(h), w = hourWeek(h), n = Number(h.hours) || 0;
    if (!sec || !w || !n) return;
    H.push({ w: w, name: h.name || '', client: h.oclient || '', title: h.ocmt || '', content: h.content || '', sec: sec, h: n });
  });

  // ── 거르기 ──
  var fClients = (f.clients || []).filter(Boolean), fMembers = (f.members || []).filter(Boolean),
      fProjects = (f.projects || []).filter(Boolean).map(function (k) { var i = k.indexOf('|'); return { client: k.slice(0, i), name: k.slice(i + 1) }; }),
      fSections = (f.sections || []).filter(Boolean);
  function projHit(client, name) { return fProjects.some(function (p) { return clientMatch(client, p.client) && (norm(name) === norm(p.name) || dice(norm(name), norm(p.name)) >= 0.6); }); }
  function recOk(r) {
    if (fClients.length && !fClients.some(function (c) { return clientMatch(r.client, c); })) return false;
    if (fMembers.length && !r.members.some(function (m) { return fMembers.indexOf(m) >= 0; })) return false;
    if (fProjects.length && !projHit(r.client, r.name)) return false;
    if (fSections.length && fSections.indexOf(r.section) < 0) return false;
    return true;
  }
  function hourOk(h) {
    if (fClients.length && !fClients.some(function (c) { return clientMatch(h.client, c); })) return false;
    if (fMembers.length && fMembers.indexOf(h.name) < 0) return false;
    if (fProjects.length && !fProjects.some(function (p) { return clientMatch(h.client, p.client) && (dice(norm(h.title), norm(p.name)) >= 0.5 || dice(norm(h.content), norm(p.name)) >= 0.5); })) return false;
    if (fSections.length && fSections.indexOf(h.sec) < 0) return false;
    return true;
  }

  // ── 주마다 계획 ↔ 실적 ──
  var weeks = [], pending = [], recs = [];
  var from = opts.from ? mondayOf(opts.from) : null, to = opts.to ? mondayOf(opts.to) : null;
  reps.forEach(function (r) {
    var team = r.team || '', W = r.week_start;
    if ((from && W < from) || (to && W > to)) return;
    var plan = (r.parsed && r.parsed.cur && r.parsed.cur.items) || [];
    var next = byTW[team + '|' + addDays(W, 7)];
    if (!next) { if (plan.length && pending.indexOf(W) < 0) pending.push(W); return; }   // 아직 실적 보고가 없는 주
    var actual = (next.parsed && next.parsed.last && next.parsed.last.items) || [];
    if (!plan.length && !actual.length) return;
    if (weeks.indexOf(W) < 0) weeks.push(W);
    matchItems(team, plan, actual, canon).forEach(function (m) {
      var it = m.a || m.p, p = m.p, a = m.a;
      var members = [];
      [p, a].forEach(function (x) { (x && x.members || []).forEach(function (n) { if (members.indexOf(n) < 0) members.push(n); }); });
      var res;
      if (!p) res = 'unplanned';
      else if (!a) res = 'missed';
      else if (isDone(a)) res = 'done';
      else if (moved(a, p)) res = 'progressed';
      else res = 'stalled';
      recs.push({ w: W, team: team, client: it.client || '', name: (a && a.name) || (p && p.name) || '', planName: p ? p.name : '', section: (p || a).section || 'etc',
        members: members, res: res, pctFrom: p && hasPct(p) ? p.pct : null, pctTo: a && hasPct(a) ? a.pct : null,
        deadline: (a && a.deadline) || (p && p.deadline) || '' });
    });
  });
  weeks.sort(); pending.sort();

  // 보고 누락 — 계획했는데 실적 칸에 없지만, 그 주 업무일지에 그 업체(담당이 있으면 그 사람) 시간이 있음
  recs.forEach(function (r) {
    if (r.res !== 'missed') return;
    var hit = H.filter(function (h) { return h.w === r.w && clientMatch(h.client, r.client) && (!r.members.length || r.members.indexOf(h.name) >= 0); });
    if (hit.length) { r.res = 'unreported'; r.hours = r1(hit.reduce(function (s, h) { return s + h.h; }, 0)); }
  });

  var R = recs.filter(recOk);
  var inWeeks = {}; weeks.forEach(function (w) { inWeeks[w] = true; });
  var HH = H.filter(function (h) { return inWeeks[h.w] && hourOk(h); });

  function agg(list) {
    var c = { done: 0, progressed: 0, stalled: 0, unreported: 0, missed: 0, unplanned: 0 };
    list.forEach(function (r) { c[r.res]++; });
    var planned = c.done + c.progressed + c.stalled + c.unreported + c.missed;
    var reported = c.done + c.progressed + c.stalled + c.unplanned;
    return Object.assign(c, { planned: planned, reported: reported,
      execRate: pct(c.done + c.progressed + c.unreported, planned), doneRate: pct(c.done, planned),
      missRate: pct(c.missed, planned), unplannedRate: pct(c.unplanned, reported) });
  }
  function hoursOf(list) {
    var t = 0, who = {};
    list.forEach(function (h) { t += h.h; who[h.name] = (who[h.name] || 0) + h.h; });
    var heads = Object.keys(who).length;
    return { hours: r1(t), heads: heads, perHead: heads ? r1(t / heads) : null };
  }

  // 주별 추세
  var weekly = weeks.map(function (w) {
    var a = agg(R.filter(function (r) { return r.w === w; }));
    var h = hoursOf(HH.filter(function (x) { return x.w === w; }));
    return Object.assign({ week: w }, a, h, { load: h.perHead != null ? r1(h.perHead / cap * 100) : null });
  });
  var kpi = Object.assign(agg(R), hoursOf(HH));
  kpi.weeks = weeks.length;
  kpi.perHeadWeek = kpi.heads && weeks.length ? r1(kpi.hours / kpi.heads / weeks.length) : null;   // 1인 주당 시간(기록 있는 사람 평균)
  kpi.load = kpi.perHeadWeek != null ? r1(kpi.perHeadWeek / cap * 100) : null;
  // 앞 절반 ↔ 뒤 절반 (추세)
  if (weekly.length >= 4) {
    var half = Math.floor(weekly.length / 2), A = agg(R.filter(function (r) { return r.w < weeks[half]; })), B = agg(R.filter(function (r) { return r.w >= weeks[half]; }));
    kpi.trend = { execRate: [A.execRate, B.execRate], doneRate: [A.doneRate, B.doneRate], unplannedRate: [A.unplannedRate, B.unplannedRate], missRate: [A.missRate, B.missRate] };
  }

  // 사람별
  var names = {};
  R.forEach(function (r) { r.members.forEach(function (m) { names[m] = true; }); });
  HH.forEach(function (h) { if (h.name) names[h.name] = true; });
  var byMember = Object.keys(names).map(function (n) {
    var a = agg(R.filter(function (r) { return r.members.indexOf(n) >= 0; }));
    var hl = HH.filter(function (h) { return h.name === n; });
    var hw = {}; hl.forEach(function (h) { hw[h.w] = (hw[h.w] || 0) + h.h; });
    var t = hl.reduce(function (s, h) { return s + h.h; }, 0), wk = Object.keys(hw).length;
    var perWeek = wk ? r1(t / wk) : null;
    return Object.assign({ key: n }, a, { hours: r1(t), weeksWithHours: wk, perWeek: perWeek, load: perWeek != null ? r1(perWeek / cap * 100) : null,
      plannedPerWeek: weeks.length ? r1(a.planned / weeks.length) : null, overWeeks: Object.keys(hw).filter(function (w) { return hw[w] > cap * 1.1; }).length });
  }).sort(function (x, y) { return (y.planned + y.unplanned) - (x.planned + x.unplanned) || (y.hours || 0) - (x.hours || 0); });

  // 업체별 (이름은 가장 많이 쓴 것)
  var cg = {};
  function cKey(c) { var k = norm(c); return k || '(없음)'; }
  R.forEach(function (r) { var k = cKey(r.client), g = cg[k] = cg[k] || { names: {}, recs: [], hrs: [] }; g.names[r.client] = (g.names[r.client] || 0) + 1; g.recs.push(r); });
  HH.forEach(function (h) {
    var k = Object.keys(cg).filter(function (x) { return clientMatch(x, h.client); })[0];
    if (k) cg[k].hrs.push(h);
  });
  var byClient = Object.keys(cg).map(function (k) {
    var g = cg[k], nm = Object.keys(g.names).sort(function (a, b) { return g.names[b] - g.names[a]; })[0] || k;
    return Object.assign({ key: nm }, agg(g.recs), { hours: r1(g.hrs.reduce(function (s, h) { return s + h.h; }, 0)) });
  }).sort(function (x, y) { return (y.planned + y.unplanned) - (x.planned + x.unplanned); });

  // 분야별
  var bySection = ['dev', 'setup', 'cs', 'etc'].map(function (s) {
    return Object.assign({ key: s, label: SECTION_LABEL[s] }, agg(R.filter(function (r) { return r.section === s; })), hoursOf(HH.filter(function (h) { return h.sec === s; })));
  }).filter(function (x) { return x.planned || x.unplanned || x.hours; });

  // 프로젝트(진행률 · 납기가 있는 일) — 분석(weekly-insights)의 경과를 같은 거르기로
  var projects = (opts.insightItems || []).filter(function (i) {
    if (i.pct == null && !i.deadline) return false;
    return recOk({ client: i.client, name: i.name, members: i.members || [], section: i.section });
  }).map(function (i) {
    var mine = R.filter(function (r) { return clientMatch(r.client, i.client) && dice(norm(r.name), norm(i.name)) >= 0.5; });
    var weeksLeft = i.deadline ? Math.max(0, Math.round((Date.parse(i.deadline) - Date.parse((weeks[weeks.length - 1] || ymd(Date.now())))) / (7 * DAY))) : null;
    var ph = i.pctHist || [], vel = null;
    if (ph.length >= 2) vel = r1((ph[ph.length - 1].p - ph[0].p) / Math.max(1, Math.round((Date.parse(ph[ph.length - 1].w) - Date.parse(ph[0].w)) / (7 * DAY))));
    var need = i.pct != null && weeksLeft ? r1((100 - i.pct) / weeksLeft) : null;
    return { key: i.key, client: i.client, name: i.name, section: i.section, members: i.members, pct: i.pct, expected: i.expected, deadline: i.deadline,
      deadlineFirst: i.deadlineFirst, slips: i.slips, state: i.state, weeks: i.weeks, velocity: vel, needPerWeek: need, weeksLeft: weeksLeft,
      plan: agg(mine) };
  }).sort(function (a, b) { return (a.deadline || '9') < (b.deadline || '9') ? -1 : 1; });

  var out = {
    range: { from: weeks[0] || null, to: weeks[weeks.length - 1] || null, weeks: weeks, pending: pending },
    capacity: cap, kpi: kpi, weekly: weekly, byMember: byMember, byClient: byClient.slice(0, 40), bySection: bySection, projects: projects.slice(0, 60),
    records: R.slice().sort(function (a, b) { return a.w < b.w ? 1 : a.w > b.w ? -1 : 0; }).slice(0, 1500)
  };
  out.diagnostics = diagnose(out);
  out.options = optionsOf(recs, H);
  return out;
}

/** 고를 수 있는 값 (거르기 전 전체) — 업체 · 사람 · 프로젝트(진행률 · 납기 있는 일) */
function optionsOf(recs, H) {
  var cl = {}, mem = {}, pj = {};
  recs.forEach(function (r) {
    var k = norm(r.client); if (k) { cl[k] = cl[k] || { name: r.client, n: 0 }; cl[k].n++; }
    r.members.forEach(function (m) { mem[m] = (mem[m] || 0) + 1; });
    if (r.client && r.name && (r.pctFrom != null || r.pctTo != null || r.deadline)) {
      var pk = norm(r.client) + '|' + norm(r.name);
      if (!pj[pk]) pj[pk] = { key: r.client + '|' + r.name, client: r.client, name: r.name, n: 0 };
      pj[pk].n++;
    }
  });
  H.forEach(function (h) { if (h.name && !mem[h.name]) mem[h.name] = 0; });
  return {
    clients: Object.keys(cl).map(function (k) { return cl[k]; }).sort(function (a, b) { return b.n - a.n; }),
    members: Object.keys(mem).map(function (k) { return { name: k, n: mem[k] }; }).sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); }),
    projects: Object.keys(pj).map(function (k) { return pj[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 80)
  };
}

/** 부족 요인 — 규칙으로 (근거 숫자와 함께). kind: people 인력 · time 일정 · plan 계획 · focus 집중 · report 보고 · stall 정체 · slack 여유 · good 잘 됨 */
function diagnose(o) {
  var k = o.kpi, cap = o.capacity, out = [];
  if (!k.planned && !k.unplanned) return out;
  function add(kind, level, title, detail, list) { out.push({ kind: kind, level: level, title: title, detail: detail, items: (list || []).slice(0, 6) }); }

  // 인력 — 시간이 꽉 찼는데 이행이 낮음 / 사람별 과부하
  // 평균이 넘거나, 기준의 110% 를 넘긴 주가 있으면 과부하
  var over = o.byMember.filter(function (m) { return (m.perWeek != null && m.perWeek > cap * 1.1) || m.overWeeks > 0; });
  if (k.perHeadWeek != null && k.perHeadWeek >= cap * 0.95 && k.execRate != null && k.execRate < 75)
    add('people', 'high', '인력 부족', '1인 주당 ' + k.perHeadWeek + '시간(기준 ' + cap + 'h의 ' + k.load + '%)으로 꽉 찼는데 계획 이행률 ' + k.execRate + '% — 사람이 모자라 계획을 다 못 함. 충원 · 외주 · 계획 줄이기 검토',
      over.map(function (m) { return m.key + ' 주 ' + m.perWeek + 'h'; }));
  else if (over.length)
    add('people', 'mid', '일부 인원 과부하', over.length + '명이 주 ' + Math.round(cap * 1.1) + '시간을 넘긴 적이 있음 — 몰린 일을 나눠 맡기기',
      over.map(function (m) { return m.key + ' 평균 주 ' + m.perWeek + 'h · 넘긴 주 ' + m.overWeeks + '번 · 이행 ' + (m.execRate == null ? '-' : m.execRate + '%'); }));

  // 일정 — 납기 지남 · 뒤처짐 · 연기 · 속도 부족
  var late = o.projects.filter(function (p) { return p.state === 'overdue' || p.state === 'at_risk' || (p.needPerWeek != null && p.velocity != null && p.velocity < p.needPerWeek); });
  var slipped = o.projects.filter(function (p) { return p.slips > 0 && p.state !== 'done'; });
  if (late.length || slipped.length)
    add('time', late.length >= 2 ? 'high' : 'mid', '일정 부족',
      (late.length ? '납기에 못 맞출 일 ' + late.length + '건' : '') + (late.length && slipped.length ? ' · ' : '') + (slipped.length ? '납기를 미룬 일 ' + slipped.length + '건' : '') + ' — 남은 기간에 필요한 주당 진척보다 실제 진척이 느림. 범위 조정 · 인력 집중 · 납기 재협의',
      late.concat(slipped.filter(function (p) { return late.indexOf(p) < 0; })).map(function (p) {
        return (p.client ? p.client + ' ' : '') + p.name + ' ' + (p.pct == null ? '' : p.pct + '%') + (p.velocity != null && p.needPerWeek != null ? ' (주 +' + p.velocity + ' / 필요 +' + p.needPerWeek + ')' : '') + (p.slips ? ' · 연기 ' + p.slips + '번' : '');
      }));

  // 계획 — 계획 외가 많음
  if (k.unplannedRate != null && k.unplannedRate >= 30) {
    var cs = o.byClient.filter(function (c) { return c.unplanned; }).sort(function (a, b) { return b.unplanned - a.unplanned; });
    add('plan', k.unplannedRate >= 45 ? 'high' : 'mid', '계획 외 업무가 많음', '실적의 ' + k.unplannedRate + '%가 계획에 없던 일 — C/S · 돌발 대응이 계획을 밀어냄. 주간 계획에 대응 시간(버퍼) ' + Math.min(40, Math.round(k.unplannedRate / 5) * 5) + '% 를 미리 잡기',
      cs.map(function (c) { return c.key + ' 계획 외 ' + c.unplanned + '건'; }));
  }
  // 집중 — 한 사람이 동시에 맡은 계획이 많음
  var busy = o.byMember.filter(function (m) { return m.plannedPerWeek != null && m.plannedPerWeek >= 6; });
  if (busy.length)
    add('focus', 'mid', '동시 업무 과다', busy.length + '명이 한 주에 계획 6건 이상 — 일을 자주 바꾸면 끝내는 일이 줄어듦. 우선순위 3~5건으로 좁히기',
      busy.map(function (m) { return m.key + ' 주 ' + m.plannedPerWeek + '건 · 완료 ' + (m.doneRate == null ? '-' : m.doneRate + '%'); }));
  // 보고 — 일은 했는데 실적 칸에서 빠짐
  if (k.unreported)
    add('report', k.unreported >= 3 ? 'mid' : 'info', '보고 누락 의심', '계획한 일 ' + k.unreported + '건이 실적 칸엔 없지만 그 주 업무일지에 시간이 있음 — 지난주 칸에 결과를 적어야 실적으로 잡힘',
      o.records.filter(function (r) { return r.res === 'unreported'; }).map(function (r) { return r.w.slice(5).replace('-', '/') + ' ' + r.client + ' ' + r.name + ' (' + r.hours + 'h)'; }));
  // 정체 — 보고는 했는데 나아간 표시가 없음
  if (k.planned && k.stalled / k.planned >= 0.2)
    add('stall', 'mid', '진척 없는 보고', '계획 ' + k.planned + '건 중 ' + k.stalled + '건이 실적 칸에 그대로 — 막힌 곳(자재 · 고객 회신 · 기술 문제)을 세부 줄로 적고 도움 요청',
      o.records.filter(function (r) { return r.res === 'stalled'; }).map(function (r) { return r.w.slice(5).replace('-', '/') + ' ' + r.client + ' ' + r.name; }));
  // 미이행 — 계획만 하고 흔적이 없음
  if (k.missed && k.missRate >= 15)
    add('time', k.missRate >= 30 ? 'high' : 'mid', '계획만 하고 못 한 일', '계획의 ' + k.missRate + '%(' + k.missed + '건)가 실적 칸에도 업무일지에도 없음 — 계획을 너무 많이 잡았거나 우선순위에서 밀림. 다음 주로 넘길지 정리',
      o.records.filter(function (r) { return r.res === 'missed'; }).map(function (r) { return r.w.slice(5).replace('-', '/') + ' ' + r.client + ' ' + r.name; }));
  // 여유 — 시간 여유가 있는데 이행이 낮음
  if (k.perHeadWeek != null && k.perHeadWeek < cap * 0.6 && k.execRate != null && k.execRate < 70)
    add('slack', 'info', '시간은 남는데 이행이 낮음', '1인 주당 ' + k.perHeadWeek + '시간 기록 — 업무일지 기록이 빠졌거나, 일이 다른 사람 · 외부를 기다리는 중일 수 있음');
  // 추세
  if (k.trend && k.trend.execRate[0] != null && k.trend.execRate[1] != null) {
    var d = r1(k.trend.execRate[1] - k.trend.execRate[0]);
    if (d <= -10) add('trend', 'mid', '이행률이 떨어지는 중', '앞 절반 ' + k.trend.execRate[0] + '% → 뒤 절반 ' + k.trend.execRate[1] + '% (' + d + '%p) — 최근 무엇이 늘었는지(계획 외 · 인원 변화) 확인');
    else if (d >= 10) add('good', 'info', '이행률이 오르는 중', '앞 절반 ' + k.trend.execRate[0] + '% → 뒤 절반 ' + k.trend.execRate[1] + '% (+' + d + '%p)');
  }
  if (!out.some(function (x) { return x.level === 'high' || x.level === 'mid'; }) && k.execRate != null && k.execRate >= 80)
    add('good', 'info', '계획대로 잘 가고 있음', '이행률 ' + k.execRate + '% · 완료율 ' + k.doneRate + '% — 다음 단계: 완료율 목표를 올리거나 납기 여유를 줄여 도전');
  var rank = { high: 0, mid: 1, info: 2 };
  return out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
}

/** 업무일지 시간 — 기간(월~일) 안 · 테넌트 전체 (업무일지는 공용, v13.481) */
async function loadHours(db, tenantId, fromYmd, toYmd) {
  var r = await db.query(
    'SELECT date, name, oclient, ocmt, content, abbr, hours FROM work_records WHERE tenant_id = $1 AND date >= $2 AND date <= $3 LIMIT 50000',
    [tenantId, fromYmd.replace(/-/g, ''), toYmd.replace(/-/g, '')]);
  return r.rows;
}

module.exports = { compute: compute, diagnose: diagnose, matchItems: matchItems, loadHours: loadHours, clientMatch: clientMatch, PLAN_RES: PLAN_RES, mondayOf: mondayOf, addDays: addDays };
