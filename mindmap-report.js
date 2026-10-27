/* mindmap-report.js — 맵 → 주간 업무 보고 문장 (v13.236)
 * 주간 보고 형식(server/services/weekly-report-parser.js 가 읽는 텍스트):
 *   [개발]
 *   - [사이트] 업무명 ~MM/DD 70% @담당 #진행중
 *     : 세부 @담당 #완료
 *         └ 더 아래 세부
 * 맵 구조: 1단계 주제 = 사이트(고객 · 프로젝트, "[SDC] 글라스 챔퍼링" 이면 사이트 SDC · 이름 앞머리 "글라스 챔퍼링"),
 *          2단계 = 업무 항목(하위가 없는 1단계는 그 자체가 항목), 3단계 = 세부, 4단계 아래 = └ 하위 세부.
 * 지난주 = 버전 기록 중 약 일주일 전 것 → 같은 형식으로 lastText 를 만들어 주간 보고의 지난주 · 이번 주 비교가 그대로 된다.
 * 업로드용 JSON { name, savedAt, lastText, curText } 도 내려받기 가능 (주간 업무 관리자 화면 업로드 형식).
 */

var MM_WR_SECTIONS = [{ k: 'dev', l: '개발' }, { k: 'setup', l: '셋업' }, { k: 'cs', l: 'C/S' }, { k: 'etc', l: '기타' }];

/** "[SDC] 글라스 챔퍼링" → { client: 'SDC', prefix: '글라스 챔퍼링' }, "TSE" → { client: 'TSE', prefix: '' } */
function mmWrSite(text) {
  var first = String(text || '').split('\n')[0].trim();
  var m = /^\[([^\]]+)\]\s*(.*)$/.exec(first);
  return m ? { client: m[1].trim(), prefix: m[2].trim() } : { client: first || '(이름 없음)', prefix: '' };
}
function _mmWrDue(s) { return s ? '~' + String(s).slice(5, 7) + '/' + String(s).slice(8, 10) : ''; }
/** 한 줄 꼬리표: ~마감 · % · @담당 · #상태 */
function _mmWrTail(n, g, who) {
  var t = [];
  if (n.dueDate) t.push(_mmWrDue(n.dueDate));
  var done = !!n.done || (g && g.p >= 100);
  if (g && !done) t.push(g.p + '%');
  if (who) t.push('@' + String(who).replace(/\s+/g, ''));
  if (done) t.push('#완료');
  else if (g && g.p > 0) t.push('#진행중');
  return t.join(' ');
}

/**
 * 맵 → 항목 목록. prog = _mmProgressMap(root), whoOf(n) = 담당 표시 이름
 * 반환 [{ mainId, client, name, line, details: [{ text, sub }] }]
 */
function mmWeeklyItems(root, prog, whoOf) {
  var out = [];
  function lineOf(n, prefix) {
    var first = String(n.text || '').split('\n')[0].trim();
    var name = (prefix ? prefix + ' ' : '') + first;
    var tail = _mmWrTail(n, prog[n.id], whoOf(n));
    return (name + (tail ? ' ' + tail : '')).trim();
  }
  function details(n, depth, acc) {
    // 주제 안 둘째 줄부터 = 세부
    mmSplitLineItems(String(n.text || '').split('\n').slice(1).join('\n')).forEach(function (it) {
      acc.push({ text: it.text + (it.who ? ' @' + it.who.replace(/\s+/g, '') : ''), sub: depth > 0 });
    });
    (n.children || []).forEach(function (c) {
      acc.push({ text: lineOf(c, ''), sub: depth > 0 });
      details(c, depth + 1, acc);
    });
    return acc;
  }
  (root.children || []).forEach(function (main) {
    var site = mmWrSite(main.text);
    var kids = main.children || [];
    if (!kids.length) {
      out.push({ mainId: main.id, client: site.client, name: site.prefix, line: (site.prefix ? site.prefix + ' ' : '') + _mmWrTail(main, prog[main.id], whoOf(main)), details: [] });
      return;
    }
    kids.forEach(function (it) {
      out.push({ mainId: main.id, client: site.client, line: lineOf(it, site.prefix), details: details(it, 0, []) });
    });
  });
  return out;
}

/** 항목 → 주간 보고 텍스트. sectionOf(mainId) → 'dev' | 'setup' | 'cs' | 'etc' */
function mmWeeklyText(items, sectionOf) {
  var lines = [];
  MM_WR_SECTIONS.forEach(function (s) {
    var its = items.filter(function (it) { return (sectionOf(it.mainId) || 'dev') === s.k; });
    if (!its.length) return;
    if (lines.length) lines.push('');
    lines.push('[' + s.l + ']');
    its.forEach(function (it) {
      lines.push('- [' + it.client + '] ' + it.line.trim());
      it.details.forEach(function (d) { lines.push(d.sub ? '      └ ' + d.text : '  : ' + d.text); });
    });
  });
  return lines.join('\n');
}

/**
 * 지난 기록과 비교한 이번 주 변화 — 주제 id 기준.
 * 반환 { done: [text], up: [{ text, from, to }], added: [text], late: [text] }
 */
function mmWeeklyDiff(oldRoot, newRoot, oldProg, newProg, today) {
  var old = {};
  if (oldRoot) mmWalk(oldRoot, function (n) { old[n.id] = n; });
  var res = { done: [], up: [], added: [], late: [] };
  mmWalk(newRoot, function (n, parent, depth) {
    if (!depth) return;
    var text = String(n.text || '').split('\n')[0].trim() || '(빈 주제)';
    // 하위 평균(own 아님)은 세지 않는다 — 상위 주제가 하위 변화로 중복해서 잡히지 않게
    var g = newProg[n.id] && newProg[n.id].own ? newProg[n.id] : null;
    var og = oldProg[n.id] && oldProg[n.id].own ? oldProg[n.id] : null;
    var o = old[n.id];
    var doneNow = !!n.done || (g && g.p >= 100);
    if (oldRoot && !o) { if (depth >= 2) res.added.push(text); }
    else if (o) {
      var doneBefore = !!o.done || (og && og.p >= 100);
      if (doneNow && !doneBefore) res.done.push(text);
      else if (g && !doneNow && (!og || g.p > og.p)) res.up.push({ text: text, from: og ? og.p : 0, to: g.p });
    }
    if (!doneNow && n.dueDate && n.dueDate < today) res.late.push(text);
  });
  return res;
}

/** ISO 주차 { yy, ww, mon: 'MM/DD', fri: 'MM/DD' } — 주간 보고 이름(팀_26W17_04/20~04/24_R1)용 */
function mmIsoWeek(d) {
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var dow = t.getUTCDay() || 7;
  var mon = new Date(t); mon.setUTCDate(t.getUTCDate() - dow + 1);
  var fri = new Date(mon); fri.setUTCDate(mon.getUTCDate() + 4);
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var ww = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  function md(x) { return String(x.getUTCMonth() + 1).padStart(2, '0') + '/' + String(x.getUTCDate()).padStart(2, '0'); }
  return { yy: String(t.getUTCFullYear()).slice(2), ww: String(ww).padStart(2, '0'), mon: md(mon), fri: md(fri) };
}

/* ═══ 화면 ═══ */
function _mmWrSecKey() { return 'mm-wr-sec:' + _mm.mapId; }
function _mmWrSecs() { try { return JSON.parse(localStorage.getItem(_mmWrSecKey()) || '{}') || {}; } catch (_) { return {}; } }
function _mmWrSaveSecs(o) { try { localStorage.setItem(_mmWrSecKey(), JSON.stringify(o)); } catch (_) {} }
function _mmWrToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** 비교할 기록 — 6일 이상 지난 것 중 가장 최근, 없으면 가장 오래된 것 */
function _mmWrPickSnap(list) {
  if (!list.length) return null;
  var cut = Date.now() - 6 * 86400000;
  var older = list.filter(function (s) { return new Date(s.created_at).getTime() <= cut; });
  return (older[0] || list[list.length - 1]).id;
}

function mmWeeklyReportModal() {
  if (!_mm.doc) return;
  return wmGuardedModal('mmWeekly', function () {
    return apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/snapshots').catch(function () { return { data: [] }; }).then(function (r) {
      var snaps = (r && r.data) || [];
      var root = _mmRoot();
      var secs = _mmWrSecs();
      var wk = mmIsoWeek(new Date());
      var team = (typeof currentUser !== 'undefined' && currentUser && (currentUser.team || currentUser.dept || currentUser.department)) || '';
      var pick = _mmWrPickSnap(snaps);
      var fmt = function (s) { var d = new Date(s.created_at); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + (s.label || (s.kind === 'auto' ? '자동' : s.kind === 'restore' ? '되돌리기 전' : '저장')); };
      var html = '<div class="mm-form mm-wr">' +
        '<div class="mm-wr-top"><label>지난주 비교<select id="mmWrSnap" class="mm-input"><option value="">비교 안 함</option>' +
        snaps.map(function (s) { return '<option value="' + _mmEsc(s.id) + '"' + (s.id === pick ? ' selected' : '') + '>' + _mmEsc(fmt(s)) + '</option>'; }).join('') + '</select></label>' +
        '<label>팀<input id="mmWrTeam" class="mm-input" value="' + _mmEsc(team) + '" placeholder="예: 소프트웨어팀"></label></div>' +
        (snaps.length ? '' : '<div class="mm-sub">버전 기록이 아직 없어 지난주와 비교할 수 없습니다 — 기록은 편집을 쉬었다 다시 할 때 자동으로 쌓입니다.</div>') +
        '<div class="mm-wr-h">구분 <span class="mm-hint">1단계 주제마다 · 이 컴퓨터에 기억</span></div><div class="mm-wr-secs">' +
        (root.children || []).map(function (m) {
          return '<label class="mm-wr-sec"><span>' + _mmEsc(String(m.text || '(빈 주제)').split('\n')[0]) + '</span><select class="mm-input" data-wr-main="' + _mmEsc(m.id) + '">' +
            MM_WR_SECTIONS.map(function (s) { return '<option value="' + s.k + '"' + ((secs[m.id] || 'dev') === s.k ? ' selected' : '') + '>' + s.l + '</option>'; }).join('') + '</select></label>';
        }).join('') + '</div>' +
        '<div id="mmWrDiff" class="mm-wr-diff"></div>' +
        '<div class="mm-wr-h">이번 주 <button class="btn btn-g btn-s" data-wr-copy="mmWrCur">복사</button></div><textarea id="mmWrCur" class="mm-input mm-wr-text" rows="10" spellcheck="false"></textarea>' +
        '<div class="mm-wr-h">지난주 <span class="mm-hint">고른 기록 기준</span> <button class="btn btn-g btn-s" data-wr-copy="mmWrLast">복사</button></div><textarea id="mmWrLast" class="mm-input mm-wr-text" rows="6" spellcheck="false"></textarea>' +
        '<div class="mm-form-acts"><span class="mm-hint" id="mmWrName"></span><button class="btn btn-g" id="mmWrTxt">텍스트 내려받기</button><button class="btn btn-p" id="mmWrJson" title="주간 업무 관리자 화면에서 그대로 올리는 형식">업로드용 JSON 내려받기</button></div></div>';
      createModal({ id: 'mmWeeklyModal', title: '🗓 주간 업무 보고 문장', html: html, width: '720px', closeOnEsc: true });
      var oldCache = {};
      function nameOf() {
        var tm = (_mmEl('mmWrTeam').value || '팀').trim().replace(/[_\s]+/g, '');
        return tm + '_' + wk.yy + 'W' + wk.ww + '_' + wk.mon + '~' + wk.fri + '_R1';
      }
      function secOf(id) { return secs[id] || 'dev'; }
      function refresh() {
        var sid = _mmEl('mmWrSnap').value;
        var prog = _mmProgressMap(root);
        _mmEl('mmWrCur').value = mmWeeklyText(mmWeeklyItems(root, prog, _mmAssigneeName), secOf);
        _mmEl('mmWrName').textContent = nameOf();
        var box = _mmEl('mmWrDiff');
        if (!sid) { _mmEl('mmWrLast').value = ''; box.innerHTML = ''; return; }
        var get = oldCache[sid] ? Promise.resolve(oldCache[sid]) : apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/snapshots/' + encodeURIComponent(sid)).then(function (x) { oldCache[sid] = x.data; return x.data; });
        box.innerHTML = '<span class="mm-hint">기록 불러오는 중…</span>';
        get.then(function (snap) {
          if (_mmEl('mmWrSnap').value !== sid) return;
          var doc = snap.doc || {};
          var sh = (doc.sheets || []).filter(function (s) { return s.id === _mmSheet().id; })[0] || (doc.sheets || [])[0];
          var oldRoot = sh && sh.root;
          if (!oldRoot) { box.innerHTML = '<span class="mm-hint">이 시트의 기록이 없습니다</span>'; _mmEl('mmWrLast').value = ''; return; }
          var oldProg = _mmProgressMap(oldRoot);
          _mmEl('mmWrLast').value = mmWeeklyText(mmWeeklyItems(oldRoot, oldProg, _mmAssigneeName), secOf);
          var df = mmWeeklyDiff(oldRoot, root, oldProg, prog, _mmWrToday());
          function grp(label, arr, cls, fn) {
            return '<details class="mm-wr-g ' + cls + '"' + (arr.length ? '' : ' disabled') + '><summary>' + label + ' <b>' + arr.length + '</b></summary>' +
              (arr.length ? '<ul>' + arr.slice(0, 50).map(function (x) { return '<li>' + _mmEsc(fn ? fn(x) : x) + '</li>'; }).join('') + '</ul>' : '') + '</details>';
          }
          box.innerHTML = '<div class="mm-wr-h">지난 기록 이후 변화</div><div class="mm-wr-gs">' +
            grp('완료', df.done, 'mm-wr-done') + grp('진척 오름', df.up, 'mm-wr-up', function (x) { return x.text + '  ' + x.from + '% → ' + x.to + '%'; }) +
            grp('새 작업', df.added, 'mm-wr-new') + grp('지연', df.late, 'mm-wr-late') + '</div>';
        }).catch(function (e) { box.innerHTML = '<span class="mm-late">기록을 불러오지 못했습니다 — ' + _mmEsc(_mmErr(e)) + '</span>'; });
      }
      _mmEl('mmWrSnap').onchange = refresh;
      _mmEl('mmWrTeam').oninput = function () { _mmEl('mmWrName').textContent = nameOf(); };
      document.querySelectorAll('#mmWeeklyModal [data-wr-main]').forEach(function (sel) {
        sel.onchange = function () { secs[sel.getAttribute('data-wr-main')] = sel.value; _mmWrSaveSecs(secs); refresh(); };
      });
      document.querySelectorAll('#mmWeeklyModal [data-wr-copy]').forEach(function (b) {
        b.onclick = function () {
          var ta = _mmEl(b.getAttribute('data-wr-copy'));
          var done = function () { _mmToast('복사했습니다', 'success'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
          else { ta.select(); document.execCommand('copy'); done(); }
        };
      });
      _mmEl('mmWrTxt').onclick = function () {
        var txt = '[이번 주]\n' + _mmEl('mmWrCur').value + (_mmEl('mmWrLast').value ? '\n\n[지난주]\n' + _mmEl('mmWrLast').value : '');
        _mmDownload(nameOf() + '.txt', new Blob([txt], { type: 'text/plain;charset=utf-8' }));
      };
      _mmEl('mmWrJson').onclick = function () {
        var body = { name: nameOf(), savedAt: new Date().toISOString(), lastText: _mmEl('mmWrLast').value, curText: _mmEl('mmWrCur').value };
        _mmDownload(nameOf() + '.json', new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
      };
      refresh();
    });
  }, 'mmWeeklyModal');
}

if (typeof module !== 'undefined') module.exports = { mmWrSite: mmWrSite, mmWeeklyItems: mmWeeklyItems, mmWeeklyText: mmWeeklyText, mmWeeklyDiff: mmWeeklyDiff, mmIsoWeek: mmIsoWeek };
