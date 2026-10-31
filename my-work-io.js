/* ═══════════════════════════════════════════════════════════════════════
   my-work-io.js — 🎯 내 업무 휴지통 · 내보내기 · 맵으로 (v13.268)
   ─────────────────────────────────────────────────────────────────────
   🗑 휴지통 — 지운 개인 할 일은 비우기 전까지 보관. 되살리기 · 하나씩 영구 삭제 · 비우기
   📤 내보내기 — 지금 보이는 그대로 (출처 · 거르기 · 보드 요약 · 사람). 엑셀(목록 + 요약) · CSV · 글로 복사
   🧠 맵으로 — 새 맵 또는 내 맵에 가지로. 가운데 → 칸 → 항목 (중요도 마커 · 마감 · 완료 · 하위 항목 · 메모 · 원래 화면 연결)
       복사(기본, '담당 비우기' 켜짐 — 내 업무에 두 번 안 보이게) · 옮기기(개인 할 일은 맵 주제로 가고 원래는 휴지통)
   서버 API: GET /api/my-work/trash · POST /todos/:id/restore · DELETE /trash/:id · DELETE /trash
             GET /api/mindmaps · GET·PUT /api/mindmaps/:id · POST /api/mindmaps · GET /api/locks
   전역 의존: _mw · _mwPaint · _mwEsc · _mwToast · _mwErr · _mwMe · _mwLS · _mwDueLabel · _mwGroupOf · MW_SRC · MW_GROUPS · renderMyWork (my-work.js)
              MW_PRI · MW_TODO_STATUS · mwFilterItem (my-work-task.js) · mwUndoToast · mwRestoreTodo (my-work-panel.js)
              mwBoardColOf · mwBoardItems · mwBoardCols · MW_NONE_COL (my-work-board.js) · XLSX · mmUid · _mm · setPage · wmGuardedModal · createModal
   ═══════════════════════════════════════════════════════════════════════ */

/** 머리 도구 버튼 (my-work.js _mwPaint 가 부름) */
/** 머리 ⋯ 메뉴 항목 (my-work.js _mwPaint 가 부름, v13.295) */
function mwIoToolsHtml(r) {
  return '<button class="hdr-mi" data-mwio="export" title="엑셀 · CSV · 글로 복사 — 지금 보이는 그대로">📤 내보내기</button>' +
    (r.self ? '<button class="hdr-mi" data-mwio="map" title="마인드맵으로 옮기기 · 복사">🧠 맵으로 옮기기</button>' +
      '<button class="hdr-mi" data-mwio="tg" title="텔레그램 — 연동 확인 · 지금 추천 받기 · 추천 시각 (/mywork · /rec)">📨 텔레그램</button>' +
      '<div class="hdr-mi-sep"></div><button class="hdr-mi mwio-trash" data-mwio="trash" title="휴지통 — 비우기 전까지 보관">🗑 휴지통' + (r.trashN ? ' <b>' + r.trashN + '</b>' : '') + '</button>' : '');
}
function mwIoClick(e) {
  var b = e.target.closest('[data-mwio]');
  if (!b) return false;
  var k = b.getAttribute('data-mwio');
  // ⋯ 메뉴 안에서 눌렀으면 메뉴가 닫히므로 펼침 메뉴(내보내기 · 텔레그램)는 ⋯ 단추 밑에 (v13.295)
  var pop = b.closest('.hdr-pop');
  if (pop) b = pop.querySelector(':scope > button') || b;
  if (k === 'trash') mwTrashOpen();
  else if (k === 'export') _mwioExportMenu(b);
  else if (k === 'map') mwToMapOpen();
  else if (k === 'tg') mwTgMenu(b);
  return true;
}

/* ═══ 📨 텔레그램 (v13.274) — 연동 확인 · 지금 받기 · 추천 시각. 명령어 /mywork · /rec · /myproj · /board ═══ */
var MW_TG_SLOTS = ['10:00', '13:30', '16:30'];
function mwTgMenu(anchor) {
  apiFetch('/api/telegram/status').then(function (st) {
    var s = (st && st.data) || {};
    if (!s.configured) { _mwToast('서버에 텔레그램 봇이 설정되어 있지 않습니다', 'warn'); return; }
    if (!s.linked || !s.isActive) {
      mwPopMenu(anchor, '<div class="mw-pmenu-n">📨 텔레그램 — 연동 안 됨</div><div class="mwio-tgtip">프로필 → 텔레그램 연동에서 QR 로 연결하면<br>내 업무 조회(/mywork) · 완료 버튼 · 💡 추천을 받을 수 있습니다.</div>', function () {});
      return;
    }
    return apiFetch('/api/telegram/prefs').then(function (p) {
      var slots = p && p.recSlots != null ? p.recSlots : '13:30';
      var on = slots ? slots.split(',') : [];
      var h = '<div class="mw-pmenu-n">📨 텔레그램 — 연동됨' + (s.username ? ' @' + _mwEsc(s.username) : '') + '</div>' +
        '<button data-v="rec">💡 지금 추천 받기</button><button data-v="list">📋 내 업무 목록 보내기</button>' +
        '<div class="mw-pmenu-n">추천 받을 시각 (평일)</div>' + MW_TG_SLOTS.map(function (t) {
          return '<button data-v="slot:' + t + '"' + (on.indexOf(t) >= 0 ? ' class="on"' : '') + '>' + (on.indexOf(t) >= 0 ? '● ' : '○ ') + t + '</button>';
        }).join('') + (on.length ? '<button data-v="slot:off">🔕 추천 끄기</button>' : '') +
        '<div class="mwio-tgtip">텔레그램에서: /mywork · /rec · /myproj · /board</div>';
      mwPopMenu(anchor, h, function (v) {
        if (v === 'rec' || v === 'list') return mwTgSend(v);
        var t = v.slice(5);
        var next = t === 'off' ? [] : on.indexOf(t) >= 0 ? on.filter(function (x) { return x !== t; }) : on.concat([t]);
        apiFetch('/api/telegram/prefs/rec', { method: 'PUT', body: JSON.stringify({ slots: next.sort().join(',') }) }).then(function (r) {
          var ns = (r && r.data && r.data.recSlots) || '';
          _mwToast(ns ? '💡 추천 ' + ns.split(',').join(' · ') + ' (평일)' : '🔕 추천을 껐습니다');
        }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
      });
    });
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
}
/** 지금 텔레그램으로 — 연동 확인 겸 (설정 화면 '지금 받아 보기'도 이것) */
function mwTgSend(kind) {
  return apiFetch('/api/telegram/mywork-send', { method: 'POST', body: JSON.stringify({ kind: kind }) }).then(function () {
    _mwToast('📨 텔레그램으로 보냈습니다 — ' + (kind === 'list' ? '내 업무 목록' : '💡 추천'));
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
}

/** 지금 화면에 보이는 항목 — 출처 칩 · 거르기 · (보드면) 위 요약 · 다 한 것 */
function mwVisibleItems() {
  var items = ((_mw.data && _mw.data.data) || []).filter(function (it) {
    return (_mw.src === 'all' || _mw.src === 'event' || it.src === _mw.src) && (typeof mwFilterItem !== 'function' || mwFilterItem(it));
  });
  return _mw.view === 'matrix' && typeof mwBoardItems === 'function' ? mwBoardItems(items) : items;
}
function _mwioColName(it) {
  if (typeof mwBoardColOf !== 'function') return '';
  var c = mwBoardColOf(it);
  return (c.icon ? c.icon + ' ' : '') + c.name;
}

/* ═══ 🗑 휴지통 ═══ */
function mwTrashOpen() {
  return wmGuardedModal('mwTrash', function () {
    return apiFetch('/api/my-work/trash').then(function (r) { _mwioTrashBuild((r && r.data) || []); });
  }, 'mwTrashModal');
}
function _mwioWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function _mwioTrashBuild(rows) {
  var ov = createModal({ id: 'mwTrashModal', width: '640px', titleText: '🗑 휴지통', closeOnEsc: true, closeOnOverlay: true, html: '<div id="mwtrBody"></div>' }).overlay;
  var body = ov.querySelector('#mwtrBody');
  // 되살린 것은 서버가 준 한 줄을 바로 목록에 넣음 (v13.270 — 예전엔 창을 닫을 때 전체 다시 받기)
  function done(back) {
    (back || []).forEach(function (row) { if (row) mwPutTodo(row); });
    _mw.data.trashN = rows.length;
    _mwPaint();
    paint();
  }
  function paint() {
    body.innerHTML = '<div class="mw-sub">지운 개인 할 일은 <b>휴지통을 비우기 전까지</b> 여기 남습니다. 이슈 · 맵 · 회의 항목은 원래 화면에서 지웁니다.</div>' +
      (rows.length ? '<div class="mwtr-list">' + rows.map(function (t) {
        var cl = Array.isArray(t.checklist) ? t.checklist : [];
        return '<div class="mwtr-row" data-tid="' + _mwEsc(t.id) + '">' +
          '<span class="mwtr-t">' + (t.done_at ? '✅ ' : '') + _mwEsc(t.title) +
            '<i>' + (t.due_date ? '마감 ' + _mwEsc(t.due_date) + (t.due_time ? ' ' + _mwEsc(t.due_time) : '') + ' · ' : '') + (cl.length ? '☑ ' + cl.length + ' · ' : '') + (t.memo ? '📝 · ' : '') + '지운 때 ' + _mwioWhen(t.deleted_at) + '</i></span>' +
          '<button class="mw-btn" data-tr="restore">↩ 되살리기</button><button class="mw-btn mwtr-del" data-tr="purge" title="영구 삭제 — 되돌릴 수 없음">영구 삭제</button></div>';
      }).join('') + '</div>' : '<div class="mw-empty">휴지통이 비어 있습니다.</div>') +
      '<div class="mwk-foot"><span class="mw-sub">' + rows.length + '개</span>' +
        (rows.length > 1 ? '<button class="mw-btn" data-tr="restoreAll">모두 되살리기</button>' : '') +
        (rows.length ? '<button class="mw-btn mwtr-empty" data-tr="empty">🗑 휴지통 비우기</button>' : '') + '</div>';
  }
  paint();
  var busy = false;
  body.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tr]');
    if (!b || busy) return;
    var k = b.getAttribute('data-tr'), row = b.closest('[data-tid]'), id = row && row.getAttribute('data-tid');
    var t = rows.filter(function (x) { return x.id === id; })[0];
    var p;
    if (k === 'restore') {
      p = apiFetch('/api/my-work/todos/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(function (r) { rows = rows.filter(function (x) { return x !== t; }); _mwToast('↩ "' + t.title + '" 되살렸습니다'); return [r && r.data]; });
    } else if (k === 'purge') {
      if (!confirm('"' + t.title + '" 을(를) 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
      p = apiFetch('/api/my-work/trash/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { rows = rows.filter(function (x) { return x !== t; }); });
    } else if (k === 'restoreAll') {
      p = Promise.all(rows.map(function (x) { return apiFetch('/api/my-work/todos/' + encodeURIComponent(x.id) + '/restore', { method: 'POST' }); })).then(function (rs) { _mwToast('↩ ' + rows.length + '개 되살렸습니다'); rows = []; return rs.map(function (r) { return r && r.data; }); });
    } else if (k === 'empty') {
      if (!confirm('휴지통의 ' + rows.length + '개를 모두 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
      p = apiFetch('/api/my-work/trash', { method: 'DELETE' }).then(function () { _mwToast('🗑 휴지통을 비웠습니다'); rows = []; });
    }
    if (!p) return;
    busy = true;
    p.then(done).catch(function (er) { _mwToast('❌ ' + _mwErr(er), 'error'); }).then(function () { busy = false; });
  });
  return ov;
}

/* ═══ 📤 내보내기 ═══ */
function _mwioExportMenu(anchor) {
  var n = mwVisibleItems().length;
  if (!n) { _mwToast('내보낼 항목이 없습니다', 'warn'); return; }
  mwPopMenu(anchor, '<div class="mw-pmenu-n">지금 보이는 ' + n + '개</div>' +
    '<button data-v="xlsx">📊 엑셀 (.xlsx) <i>목록 + 요약</i></button><button data-v="csv">📄 CSV</button><button data-v="text">📋 글로 복사 <i>칸별 글머리표</i></button>',
    mwExport, { id: 'mwioMenu', key: 'export' });
}
var MW_EXPORT_HEAD = ['칸', '제목', '출처', '중요도', '상태', '마감', '마감 시각', '완료', '완료일', '하위 항목', '진행률(%)', '예상 시간(h)', '위치', '메모', '담당'];
function _mwioRows(items) {
  var who = _mw.data.user ? _mw.data.user.name : '';
  return items.map(function (it) {
    var st = it.src === 'todo' ? (MW_TODO_STATUS[it.todoStatus] || '') + (it.waitingFor ? ' · ' + it.waitingFor : '') : (it.status || '');
    return [_mwioColName(it), it.title, (MW_SRC[it.src] || {}).label || it.src, (MW_PRI[it.pri] || MW_PRI[3]).label, st, it.due || '', it.dueTime || '',
      it.done ? 'O' : '', it.doneAt ? String(it.doneAt).slice(0, 10) : '', it.checkTotal ? it.checkDone + '/' + it.checkTotal : '',
      it.progress != null ? it.progress : '', it.estimateH || '', it.ctx || '', it.memo || '', who];
  });
}
function _mwioSort(items) {
  var cols = typeof mwBoardCols === 'function' ? mwBoardCols() : [];
  var ord = {};
  cols.forEach(function (c, i) { ord[c.id] = i; });
  return items.slice().sort(function (a, b) {
    var ca = mwBoardColOf(a).id, cb = mwBoardColOf(b).id;
    return (ord[ca] != null ? ord[ca] : 99) - (ord[cb] != null ? ord[cb] : 99) || (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
      String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.pri - b.pri;
  });
}
function _mwioFile(ext) {
  var who = _mw.data.user && !_mw.data.self ? '_' + _mw.data.user.name : '';
  return '내업무' + who + '_' + _mw.data.today + '.' + ext;
}
function _mwioDownload(name, blob) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function mwExport(kind) {
  var items = _mwioSort(mwVisibleItems());
  var rows = _mwioRows(items);
  if (kind === 'text') return _mwioCopyText(items);
  if (kind === 'xlsx' && typeof XLSX === 'undefined') { _mwToast('엑셀 도구를 아직 못 불러와 CSV 로 받습니다', 'warn'); kind = 'csv'; }
  if (kind === 'csv') {
    var esc = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [MW_EXPORT_HEAD].concat(rows).map(function (r) { return r.map(esc).join(','); }).join('\r\n');
    _mwioDownload(_mwioFile('csv'), new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    _mwToast('📄 CSV ' + rows.length + '줄을 받았습니다');
    return;
  }
  // 엑셀 — 목록 + 요약
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet([MW_EXPORT_HEAD].concat(rows));
  ws['!cols'] = [16, 44, 8, 7, 12, 11, 8, 5, 11, 8, 8, 9, 30, 40, 10].map(function (w) { return { wch: w }; });
  ws['!autofilter'] = { ref: 'A1:O' + (rows.length + 1) };
  XLSX.utils.book_append_sheet(wb, ws, '목록');
  var today = _mw.data.today, open = items.filter(function (it) { return !it.done; });
  var byCol = {}, bySrc = {};
  open.forEach(function (it) { var c = _mwioColName(it); byCol[c] = (byCol[c] || 0) + 1; var s = (MW_SRC[it.src] || {}).label || it.src; bySrc[s] = (bySrc[s] || 0) + 1; });
  var late = open.filter(function (it) { return it.due && it.due < today; }).length;
  var week = open.filter(function (it) { var g = _mwGroupOf(Object.assign({}, it, { focus: null }), today); return g === 'today' || g === 'week'; }).length;
  var sum = [['내 업무 요약', (_mw.data.user ? _mw.data.user.name : ''), today], [], ['남은 일', open.length], ['지연', late], ['이번 주 마감', week], ['다 한 것 (목록에 포함된)', items.length - open.length], [], ['칸', '남은 일']]
    .concat(Object.keys(byCol).map(function (k) { return [k, byCol[k]]; })).concat([[], ['출처', '남은 일']]).concat(Object.keys(bySrc).map(function (k) { return [k, bySrc[k]]; }));
  var ws2 = XLSX.utils.aoa_to_sheet(sum);
  ws2['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, '요약');
  XLSX.writeFile(wb, _mwioFile('xlsx'));
  _mwToast('📊 엑셀 ' + rows.length + '줄을 받았습니다');
}
function _mwioCopyText(items) {
  var today = _mw.data.today, groups = [], at = {};
  items.forEach(function (it) {
    var c = _mwioColName(it) || '내 업무';
    if (at[c] == null) { at[c] = groups.length; groups.push({ name: c, list: [] }); }
    groups[at[c]].list.push(it);
  });
  var txt = '🎯 ' + (_mw.data.self ? '내 업무' : (_mw.data.user ? _mw.data.user.name + ' 님 업무' : '업무')) + ' — ' + today + '\n' + groups.map(function (g) {
    return '\n■ ' + g.name + ' (' + g.list.filter(function (x) { return !x.done; }).length + ')\n' + g.list.map(function (it) {
      var bits = [];
      if (it.pri && it.pri <= 2) bits.push(MW_PRI[it.pri].label);
      if (it.due) bits.push('마감 ' + _mwDueLabel(it.due, today) + (it.dueTime ? ' ' + it.dueTime : ''));
      if (it.checkTotal) bits.push('☑ ' + it.checkDone + '/' + it.checkTotal);
      if (it.ctx) bits.push(it.ctx);
      return (it.done ? '  ✔ ' : '  - ') + it.title + (bits.length ? ' (' + bits.join(' · ') + ')' : '');
    }).join('\n');
  }).join('\n') + '\n';
  var ok = function () { _mwToast('📋 ' + items.length + '개를 글로 복사했습니다 — 메신저 · 보고서에 붙여 넣으세요'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(fallback); else fallback();
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (_) { _mwToast('복사하지 못했습니다', 'error'); }
    ta.remove();
  }
}

/* ═══ 🧠 맵으로 ═══ */
var MW_MAP_COLOR = { red: 'rose', orange: 'amber', amber: 'amber', green: 'green', teal: 'cyan', blue: 'blue', purple: 'purple', pink: 'rose', slate: 'slate' };
var MW_MAP_REF = { issue: 'issue', milestone: 'milestone', prestudy: 'prestudy' };   // action 은 회의(ctxId)로

function mwToMapOpen() {
  return wmGuardedModal('mwToMap', function () {
    return apiFetch('/api/mindmaps').then(function (r) {
      var me = _mwMe();
      var maps = ((r && r.data) || []).filter(function (m) {
        var eds = Array.isArray(m.editors) ? m.editors : (function () { try { return JSON.parse(m.editors || '[]'); } catch (_) { return []; } })();
        return m.owner_id === me || eds.indexOf(me) >= 0;
      });
      _mwioMapBuild(maps);
    });
  }, 'mwToMapModal', { onOpen: function () { var x = document.getElementById('mwmTitle'); if (x) x.select(); } });
}
function _mwioMapBuild(maps) {
  var items = _mwioSort(mwVisibleItems().filter(function (it) { return !it.done; }));
  if (!items.length) { _mwToast('옮길 남은 일이 없습니다 (다 한 일은 빼고 옮깁니다)', 'warn'); return; }
  var groups = [], at = {};
  items.forEach(function (it) {
    var c = mwBoardColOf(it);
    if (at[c.id] == null) { at[c.id] = groups.length; groups.push({ col: c, list: [] }); }
    groups[at[c.id]].list.push(it);
  });
  var pick = {};
  items.forEach(function (it) { pick[it.key] = true; });
  var html = '<form id="mwmForm" class="mwm">' +
    '<div class="mwm-sec"><div class="mwp-l">어디로</div>' +
      '<label class="mwr-chk"><input type="radio" name="mwmTo" value="new" checked> 새 맵 <input id="mwmTitle" class="mw-input mwm-in" maxlength="255" value="' + _mwEsc('내 업무 ' + _mw.data.today) + '"></label>' +
      '<label class="mwr-chk"><input type="radio" name="mwmTo" value="old"' + (maps.length ? '' : ' disabled') + '> 내 맵에 가지로 붙이기 <select id="mwmMap" class="mw-sel mwm-in"' + (maps.length ? '' : ' disabled') + '>' +
        (maps.length ? maps.map(function (m) { return '<option value="' + _mwEsc(m.id) + '">' + _mwEsc(m.title) + '</option>'; }).join('') : '<option>편집할 수 있는 맵이 없습니다</option>') + '</select></label></div>' +
    '<div class="mwm-sec"><div class="mwp-l">무엇을 <i id="mwmN"></i></div><div class="mwm-tree">' + groups.map(function (g, gi) {
      return '<div class="mwm-g"><label class="mwm-gh" style="--qc:' + (MW_CAT_COLORS[g.col.color] || '#94A3B8') + '"><input type="checkbox" data-mg="' + gi + '"> ' + (g.col.icon ? _mwEsc(g.col.icon) + ' ' : '') + _mwEsc(g.col.name) + ' <i>' + g.list.length + '</i></label>' +
        g.list.map(function (it) {
          return '<label class="mwm-it"><input type="checkbox" data-mk="' + _mwEsc(it.key) + '" data-g="' + gi + '"' + (pick[it.key] ? ' checked' : '') + '> ' + ((MW_SRC[it.src] || {}).icon || '') + ' ' + _mwEsc(it.title) +
            (it.due ? ' <i>' + _mwEsc(_mwDueLabel(it.due, _mw.data.today)) + '</i>' : '') + '</label>';
        }).join('') + '</div>';
    }).join('') + '</div></div>' +
    '<div class="mwm-sec"><div class="mwp-l">방식</div>' +
      '<label class="mwr-chk"><input type="radio" name="mwmMode" value="copy" checked> 복사 <i>원래 항목은 그대로</i></label>' +
      '<label class="mwr-chk mwm-sub"><input type="checkbox" id="mwmClear" checked> 맵 주제는 담당 비우기 <i>— 켜 두면 내 업무에 같은 일이 두 번 보이지 않습니다</i></label>' +
      '<label class="mwr-chk"><input type="radio" name="mwmMode" value="move"> 옮기기 <i>개인 할 일은 맵 주제(담당 나)가 되고 원래 할 일은 휴지통으로 · 다른 출처는 복사만</i></label></div>' +
    '<div class="mwc-q-btns"><span style="flex:1"></span><button type="button" class="mw-btn" id="mwmCancel">닫기</button><button type="submit" class="mw-btn mw-btn-p" id="mwmGo">🧠 맵 만들기</button></div></form>';
  var ov = createModal({ id: 'mwToMapModal', width: '620px', titleText: '🧠 마인드맵으로', closeOnEsc: true, html: html }).overlay;
  var $ = function (s) { return ov.querySelector(s); };
  function sync() {
    var all = ov.querySelectorAll('[data-mk]'), n = 0;
    all.forEach(function (c) { if (c.checked) n++; });
    groups.forEach(function (g, gi) {
      var cs = ov.querySelectorAll('[data-mk][data-g="' + gi + '"]'), on = 0;
      cs.forEach(function (c) { if (c.checked) on++; });
      var gh = $('[data-mg="' + gi + '"]');
      gh.checked = on === cs.length; gh.indeterminate = on > 0 && on < cs.length;
    });
    $('#mwmN').textContent = n + ' / ' + all.length + '개';
    var mode = $('input[name="mwmMode"]:checked').value, to = $('input[name="mwmTo"]:checked').value;
    $('#mwmClear').disabled = mode !== 'copy';
    $('#mwmGo').textContent = (to === 'new' ? '🧠 맵 만들기' : '🧠 맵에 붙이기') + ' (' + n + ')';
    $('#mwmGo').disabled = !n;
  }
  ov.addEventListener('change', function (e) {
    var g = e.target.getAttribute && e.target.getAttribute('data-mg');
    if (g != null) ov.querySelectorAll('[data-mk][data-g="' + g + '"]').forEach(function (c) { c.checked = e.target.checked; });
    if (e.target.id === 'mwmMap') $('input[name="mwmTo"][value="old"]').checked = true;
    sync();
  });
  $('#mwmTitle').addEventListener('focus', function () { $('input[name="mwmTo"][value="new"]').checked = true; sync(); });
  $('#mwmCancel').onclick = function () { ov.remove(); };
  sync();
  var busy = false;
  $('#mwmForm').onsubmit = function (e) {
    e.preventDefault();
    if (busy) return;
    var chosen = items.filter(function (it) { var c = $('[data-mk="' + (window.CSS && CSS.escape ? CSS.escape(it.key) : it.key) + '"]'); return c && c.checked; });
    if (!chosen.length) return;
    var opt = { mode: $('input[name="mwmMode"]:checked').value, clear: $('#mwmClear').checked, to: $('input[name="mwmTo"]:checked').value,
      title: $('#mwmTitle').value.trim() || '내 업무 ' + _mw.data.today, mapId: $('#mwmMap').value };
    busy = true; $('#mwmGo').disabled = true; $('#mwmGo').textContent = '만드는 중…';
    mwSendToMap(chosen, opt).then(function (res) {
      ov.remove();
      var moved = res.moved;
      mwUndoToast('🧠 ' + chosen.length + '개를 맵 "' + res.title + '"에 ' + (opt.mode === 'move' ? '옮겼습니다' + (moved ? ' (할 일 ' + moved + '개는 휴지통으로)' : '') : '복사했습니다'), function () { _mwioOpenMap(res.mapId, res.nodeId); }, '맵 열기');
      if (moved) renderMyWork();
    }).catch(function (er) {
      busy = false; sync();
      _mwToast('❌ ' + _mwErr(er), 'error');
    });
  };
  return ov;
}

function _mwioUid() { return typeof mmUid === 'function' ? mmUid() : 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
/** 항목 → 맵 주제 */
function _mwioNode(it, opt) {
  var me = _mw.data.user ? _mw.data.user.id : _mwMe();
  var n = { id: _mwioUid(), text: it.title, children: [] };
  if (it.pri && it.pri !== 3) n.markers = ['priority-' + it.pri];
  if (it.due) n.dueDate = it.due;
  var keepOwner = opt.mode === 'move' ? it.src === 'todo' : !opt.clear;
  if (keepOwner && me) n.assigneeId = me;
  if (it.done) { n.done = true; n.doneAt = it.doneAt || new Date().toISOString(); }
  var note = [];
  if (it.src !== 'todo') note.push('출처: ' + ((MW_SRC[it.src] || {}).label || it.src) + (it.ctx ? ' · ' + it.ctx : ''));
  if (it.dueTime) note.push('마감 시각 ' + it.dueTime);
  if (it.todoStatus && it.todoStatus !== 'todo') note.push('상태: ' + (MW_TODO_STATUS[it.todoStatus] || it.todoStatus) + (it.waitingFor ? ' — ' + it.waitingFor : ''));
  if (it.estimateH) note.push('예상 ' + it.estimateH + '시간');
  if (it.memo) note.push(it.memo);
  if (note.length) n.note = note.join('\n');
  if (MW_MAP_REF[it.src]) n.ref = { type: MW_MAP_REF[it.src], id: String(it.id) };
  else if (it.src === 'action' && it.ctxId) n.ref = { type: 'meeting', id: String(it.ctxId) };
  (it.checklist || []).forEach(function (c) {
    var k = { id: _mwioUid(), text: c.t, children: [] };
    if (c.d) k.done = true;
    n.children.push(k);
  });
  return n;
}
/** 칸별 가지 */
function _mwioBranches(chosen, opt) {
  var groups = [], at = {};
  chosen.forEach(function (it) {
    var c = mwBoardColOf(it);
    if (at[c.id] == null) { at[c.id] = groups.length; groups.push({ id: _mwioUid(), text: (c.icon ? c.icon + ' ' : '') + c.name, color: MW_MAP_COLOR[c.color] || undefined, children: [] }); }
    groups[at[c.id]].children.push(_mwioNode(it, opt));
  });
  groups.forEach(function (g) { if (!g.color) delete g.color; });
  return groups;
}
/** 맵 만들기 · 붙이기 → { mapId, title, nodeId, moved } */
function mwSendToMap(chosen, opt) {
  var who = _mw.data.self ? '' : ' · ' + (_mw.data.user ? _mw.data.user.name : '');
  var branches = _mwioBranches(chosen, opt);
  var p;
  if (opt.to === 'new') {
    var doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: { id: _mwioUid(), text: opt.title + who, children: branches } }] };
    p = apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: opt.title, scope: 'personal', doc: doc }) })
      .then(function (r) { return { mapId: r.data.id, title: r.data.title, nodeId: null }; });
  } else {
    var me = _mwMe();
    p = apiFetch('/api/locks?resourceType=mindmap&resourceId=' + encodeURIComponent(opt.mapId)).then(function (r) {
      var lk = r && r.data;
      if (lk && lk.user_id !== me && new Date(lk.expires_at).getTime() > Date.now()) throw new Error((lk.user_name || '다른 사용자') + ' 님이 이 맵을 편집 중입니다. 새 맵으로 만들거나 잠시 뒤에 다시 해 주세요.');
      return apiFetch('/api/mindmaps/' + encodeURIComponent(opt.mapId));
    }).then(function (r) {
      var row = r.data;
      if (!row.can_edit) throw new Error('이 맵을 편집할 권한이 없습니다.');
      var d = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
      var root = d.sheets[0].root;
      var top = { id: _mwioUid(), text: '🎯 내 업무 · ' + _mw.data.today + who, children: branches };
      root.children = (root.children || []).concat([top]);
      return apiFetch('/api/mindmaps/' + encodeURIComponent(opt.mapId), { method: 'PUT', body: JSON.stringify({ version: row.version, doc: d }) })
        .then(function () { return { mapId: row.id, title: row.title, nodeId: top.id }; });
    });
  }
  return p.then(function (res) {
    if (opt.mode !== 'move') return Object.assign(res, { moved: 0 });
    var todos = chosen.filter(function (it) { return it.src === 'todo' && _mw.data.self; });
    return Promise.all(todos.map(function (it) { return apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(function () { return 1; }).catch(function () { return 0; }); }))
      .then(function (ns) { return Object.assign(res, { moved: ns.reduce(function (a, b) { return a + b; }, 0) }); });
  });
}
function _mwioOpenMap(mapId, nodeId) {
  if (typeof _mm === 'undefined' || typeof setPage !== 'function') { _mwToast('마인드맵 화면을 열 수 없습니다', 'warn'); return; }
  if (typeof mmHasAccess === 'function' && !mmHasAccess()) { _mwToast('🔒 마인드맵 사용 권한이 없습니다', 'warn'); return; }
  _mm.goto = nodeId ? { mapId: mapId, sheet: 0, node: nodeId } : null;
  _mm.mapId = mapId;
  setPage('mindmap');
}
