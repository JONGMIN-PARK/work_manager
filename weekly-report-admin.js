/* ═══ 주간 업무 보고 — 관리자 페이지 ═══
 * 업로드/검색/통계/목록 4개 서브탭으로 /api/weekly-reports 호출
 * apiFetch (auth.js) 사용 — 자동 JWT 첨부
 */

(function () {
  var SECTION_LABEL = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
  var STATE = { tab: 'author', searchResults: null, stats: null, list: null };

  // 섹션별 색상 — 원본 도구와 일관성 유지
  var SEC_COLORS = {
    dev:   { main: '#3a6ab0', bg: 'rgba(58,106,176,.12)', bar: 'linear-gradient(90deg,#3a6ab0,#7aaade)', num: '#3a6ab0' },
    setup: { main: '#7030b0', bg: 'rgba(112,48,176,.12)', bar: 'linear-gradient(90deg,#7030b0,#a878d6)', num: '#7030b0' },
    cs:    { main: '#c06000', bg: 'rgba(192,96,0,.12)',   bar: 'linear-gradient(90deg,#c06000,#e09850)', num: '#c06000' },
    etc:   { main: '#506070', bg: 'rgba(80,96,112,.12)',  bar: 'linear-gradient(90deg,#506070,#80909a)', num: '#506070' }
  };
  var SEC_NUM = { dev: '01', setup: '02', cs: '03', etc: '04' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function statusPill(st) {
    if (st === 'done') return '<span style="color:#1a8a40;background:rgba(26,138,64,.12);padding:1px 6px;border-radius:4px;font-size:11px">● 완료</span>';
    if (st === 'in_progress') return '<span style="color:#d03030;background:rgba(208,48,48,.12);padding:1px 6px;border-radius:4px;font-size:11px">● 진행중</span>';
    return '';
  }

  // D-day 계산 (deadline = "~05/29" 형식)
  function dday(deadline) {
    if (!deadline) return null;
    var m = String(deadline).match(/~?(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    var diff = Math.round((target - today) / 86400000);
    if (diff === 0) return { label: 'D-DAY', color: '#fff', bg: '#c05000' };
    if (diff > 0) return {
      label: 'D-' + diff,
      color: diff <= 3 ? '#e03030' : (diff <= 7 ? '#c05000' : '#6070a0'),
      bg:    diff <= 3 ? 'rgba(224,48,48,.22)' : (diff <= 7 ? 'rgba(192,80,0,.18)' : 'rgba(96,112,160,.10)')
    };
    return { label: 'D+' + Math.abs(diff), color: '#fff', bg: '#d03030' };
  }
  function ddayBadge(deadline) {
    var d = dday(deadline);
    if (!d) return '';
    return '<span style="font-family:ui-monospace,monospace;font-size:9.5px;font-weight:700;color:' + d.color + ';background:' + d.bg + ';border-radius:4px;padding:1px 5px;white-space:nowrap;margin-left:4px">' + esc(d.label) + '</span>';
  }

  // 인라인 마크업 (=y{...}, **bold**, ~~strike~~, {bold})
  function inlineMarkup(text) {
    if (!text) return '';
    var out = esc(text);
    var hlBg = { y: 'rgba(255,224,80,.45)', r: 'rgba(255,140,140,.45)', g: 'rgba(140,220,160,.45)', b: '#d0e4ff', p: '#e8d8f8' };
    out = out.replace(/=([yrgbp])\{([^}]*)\}/g, function (_, c, t) {
      return '<span style="background:' + (hlBg[c] || hlBg.y) + ';padding:1px 4px;border-radius:3px">' + t + '</span>';
    });
    var fc = { r: '#d03030', g: '#1a8a40', b: '#2060c0', p: '#7030b0', o: '#c06000' };
    out = out.replace(/#([rgbpo])\{([^}]*)\}/g, function (_, c, t) {
      return '<span style="color:' + (fc[c] || fc.r) + '">' + t + '</span>';
    });
    out = out.replace(/\{([^}]*)\}/g, '<strong>$1</strong>');
    out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/~~(.*?)~~/g, '<del>$1</del>');
    // #완료/#진행중 도형만 (원본 정책 — 라벨 제거)
    out = out.replace(/#완료/g, '<span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;background:#1a8a40;border-radius:50%;vertical-align:middle;margin:0 2px"><svg width="8" height="6" viewBox="0 0 9 7"><path d="M1 3.5L3.5 6L8 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>');
    out = out.replace(/#진행중?/g, '<span style="display:inline-block;width:8px;height:8px;background:#d03030;border-radius:50%;box-shadow:0 0 0 2px rgba(208,48,48,.2);vertical-align:middle;margin:0 4px"></span>');
    out = out.replace(/#%(\d+)/g, function (_, p) {
      var v = Math.min(100, Math.max(0, parseInt(p, 10)));
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 5px;border:1px solid var(--bd);border-radius:10px;font-size:10px;color:var(--ac);vertical-align:middle;margin:0 3px"><span style="font-weight:700">' + v + '%</span><span style="width:14px;height:4px;background:var(--bd);border-radius:2px;overflow:hidden;display:inline-block"><span style="display:block;height:100%;width:' + v + '%;background:linear-gradient(90deg,var(--ac),#7aaade)"></span></span></span>';
    });
    return out;
  }

  // 파싱된 sections/items 배열을 보기용 HTML로 빌드
  function buildPreviewHTML(parsedPane) {
    if (!parsedPane || !parsedPane.sections || !parsedPane.sections.length) {
      return '<div style="padding:24px;text-align:center;color:var(--t5)">내용 없음</div>';
    }
    var SEC_LABELS = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
    var html = '';
    parsedPane.sections.forEach(function (sec) {
      var cl = SEC_COLORS[sec.type] || SEC_COLORS.dev;
      html += '<div style="margin-bottom:18px">'
        +   '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        +     '<span style="background:' + cl.num + ';color:#fff;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px">' + (SEC_NUM[sec.type] || '') + '</span>'
        +     '<span style="font-size:14px;font-weight:700;color:var(--t2)">' + esc(SEC_LABELS[sec.type] || sec.type) + '</span>'
        +   '</div>';
      sec.items.forEach(function (it) {
        var pct = (typeof it.pct === 'number' && it.pct >= 0) ? it.pct : null;
        var members = (it.members || []).map(function (m) {
          return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10.5px;background:var(--bg-i);color:var(--t5);margin:0 0 0 4px">@' + esc(m) + '</span>';
        }).join('');
        var detailsHtml = '';
        if (it.details && it.details.length) {
          detailsHtml = '<ul style="margin:6px 0 0;padding:0;list-style:none">'
            + it.details.map(function (d) {
                var dMembers = (d.members || []).map(function (m) {
                  return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10.5px;background:var(--bg-i);color:var(--t5);margin-left:4px">@' + esc(m) + '</span>';
                }).join('');
                // 텍스트에서 @멤버 제거 후 인라인 마크업
                var dText = String(d.text || '').replace(/@[^\s@]+/g, '').trim();
                return '<li style="display:flex;align-items:center;font-size:11.5px;color:var(--t3);padding:2px 0;line-height:1.7">'
                  + '<span style="color:var(--t6);margin:0 6px 0 4px">–</span>'
                  + '<span style="flex:1">' + inlineMarkup(dText) + '</span>'
                  + dMembers + '</li>';
              }).join('')
            + '</ul>';
        }
        html += '<div style="background:var(--bg-p);border:1px solid var(--bd);border-left:3px solid ' + cl.main + ';border-radius:6px;padding:8px 12px;margin-bottom:6px">'
          + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
          +   '<span style="background:' + cl.bg + ';color:' + cl.main + ';font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;flex-shrink:0">' + esc(it.client || '') + '</span>'
          +   '<span style="font-size:12.5px;color:var(--t2);flex:1;min-width:0">' + inlineMarkup(it.name || '') + '</span>'
          +   members
          +   (it.deadline ? '<span style="font-size:10.5px;color:var(--t5);font-family:ui-monospace,monospace">' + esc(it.deadline) + '</span>' : '')
          +   (pct !== null ? '<span style="font-size:11.5px;font-weight:700;color:' + cl.main + ';font-family:ui-monospace,monospace">' + pct + '%</span>' : '')
          +   (it.deadline ? ddayBadge(it.deadline) : '')
          + '</div>'
          + (pct !== null ? '<div style="height:4px;background:var(--bd);border-radius:2px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + cl.bar + '"></div></div>' : '')
          + detailsHtml
          + '</div>';
      });
      html += '</div>';
    });
    return html;
  }

  function shell() {
    return ''
      + '<div style="margin-bottom:14px">'
      +   '<h2 style="margin:0 0 4px;font-size:18px">📅 주간 업무 보고</h2>'
      +   '<p class="sub" style="margin:0;font-size:12px;color:var(--t5)">JSON을 누적 적재하여 검색·통계로 활용합니다 (관리자 전용)</p>'
      + '</div>'
      + '<div class="tabs sub-tabs" id="wrSubTabs" role="tablist" style="margin-bottom:14px">'
      +   '<button class="tab on" data-wt="author" role="tab">✍️ 작성</button>'
      +   '<button class="tab" data-wt="search" role="tab">🔍 검색</button>'
      +   '<button class="tab" data-wt="stats" role="tab">📊 통계</button>'
      +   '<button class="tab" data-wt="list" role="tab">🗂️ 목록</button>'
      +   '<button class="tab" data-wt="upload" role="tab">📤 업로드</button>'
      + '</div>'
      + '<div id="wrPanel"></div>';
  }

  function renderWeeklyReportPage() {
    var root = $('mWeeklyReport');
    if (!root) return;
    if (!root.dataset.init) {
      root.innerHTML = shell();
      root.dataset.init = '1';
      var bar = $('wrSubTabs');
      bar.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () { setTab(t.dataset.wt); });
      });
    }
    setTab(STATE.tab);
  }
  window.renderWeeklyReportPage = renderWeeklyReportPage;

  function setTab(name) {
    STATE.tab = name;
    var bar = $('wrSubTabs'); if (!bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.wt === name);
      t.setAttribute('aria-selected', t.dataset.wt === name);
    });
    if (name === 'author') renderAuthor();
    else if (name === 'upload') renderUpload();
    else if (name === 'search') renderSearch();
    else if (name === 'stats') renderStats();
    else if (name === 'list') renderList();
  }

  /* ─── 업로드 ─── */
  function renderUpload() {
    $('wrPanel').innerHTML = ''
      + '<div id="wrDrop" style="border:2px dashed var(--bd);border-radius:10px;padding:32px;text-align:center;cursor:pointer;color:var(--t5);transition:all .15s">'
      +   '<div style="font-size:36px;margin-bottom:8px">📄</div>'
      +   '<div style="font-weight:700;color:var(--t2);margin-bottom:4px">JSON 파일을 드롭하거나 클릭하여 선택</div>'
      +   '<div style="font-size:12px">여러 개 동시 선택 가능 · 같은 이름이면 덮어씀</div>'
      +   '<input id="wrFileInput" type="file" accept=".json,application/json" multiple style="display:none">'
      + '</div>'
      + '<div id="wrUploadResult" style="margin-top:14px"></div>';

    var dz = $('wrDrop');
    var fi = $('wrFileInput');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function (e) { handleFiles(e.target.files); fi.value = ''; });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = 'var(--ac)'; dz.style.background = 'var(--ac-bg)'; });
    dz.addEventListener('dragleave', function () { dz.style.borderColor = 'var(--bd)'; dz.style.background = ''; });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.style.borderColor = 'var(--bd)'; dz.style.background = '';
      handleFiles(e.dataTransfer.files);
    });
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    var box = $('wrUploadResult');
    box.innerHTML = '<div style="color:var(--t5);font-size:12px">⏳ 업로드 중... ' + files.length + '개</div>';
    var ok = [], fail = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var text = await f.text();
        var json = JSON.parse(text);
        var r = await apiFetch('/api/weekly-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        ok.push({ file: f.name, saved: r.data && r.data[0] });
      } catch (e) {
        fail.push({ file: f.name, error: (e && e.message) || String(e) });
      }
    }
    var rows = ''
      + ok.map(function (r) {
          var wk = (r.saved && r.saved.week_label) || '-';
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(r.file) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(wk) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd);color:#1a8a40">저장됨</td></tr>';
        }).join('')
      + fail.map(function (r) {
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--bd)">' + esc(r.file) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd)">-</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid var(--bd);color:#d03030">실패: ' + esc(r.error) + '</td></tr>';
        }).join('');
    box.innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
      +   '<div style="font-size:12px;margin-bottom:8px;color:var(--t3)">처리 결과 — 성공 ' + ok.length + ' / 실패 ' + fail.length + '</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      +     '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">파일</th>'
      +     '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">주차</th>'
      +     '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--t5);font-weight:600">상태</th></tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
    if (typeof showToast === 'function') {
      showToast('업로드 완료 — 성공 ' + ok.length + ' / 실패 ' + fail.length, fail.length ? 'warn' : 'ok');
    }
  }

  /* ─── 검색 ─── */
  function renderSearch() {
    $('wrPanel').innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">'
      +     inputCell('wrSQ', 'text', '키워드 (이름/세부)')
      +     inputCell('wrSAssignee', 'text', '담당자 (예: 박종민)')
      +     inputCell('wrSClient', 'text', '사이트 (예: 디케이티)')
      +     selectCell('wrSStatus', [['','상태 전체'],['done','완료'],['in_progress','진행중'],['none','미표시']])
      +     selectCell('wrSSection', [['','섹션 전체'],['dev','개발'],['setup','셋업'],['cs','C/S'],['etc','기타']])
      +     selectCell('wrSPane', [['cur','금주'],['last','지난주']])
      +     inputCell('wrSFrom', 'date', '')
      +     inputCell('wrSTo', 'date', '')
      +   '</div>'
      +   '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">'
      +     '<button id="wrSearchBtn" class="tab on" style="padding:7px 18px">검색</button>'
      +     '<button id="wrSearchReset" class="tab" style="padding:7px 14px">초기화</button>'
      +     '<span id="wrSearchCount" style="font-size:12px;color:var(--t5)"></span>'
      +   '</div>'
      + '</div>'
      + '<div id="wrSearchResult"></div>';

    $('wrSearchBtn').addEventListener('click', runSearch);
    $('wrSearchReset').addEventListener('click', function () {
      ['wrSQ','wrSAssignee','wrSClient','wrSStatus','wrSSection','wrSFrom','wrSTo'].forEach(function (k) { var el = $(k); if (el) el.value = ''; });
      $('wrSPane').value = 'cur';
      $('wrSearchResult').innerHTML = '';
      $('wrSearchCount').textContent = '';
    });
    ['wrSQ','wrSAssignee','wrSClient'].forEach(function (k) {
      $(k).addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
    });
  }

  function inputCell(id, type, ph) {
    return '<input id="' + id + '" type="' + type + '" placeholder="' + esc(ph) + '" '
      + 'style="padding:7px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">';
  }
  function selectCell(id, opts) {
    return '<select id="' + id + '" style="padding:7px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('')
      + '</select>';
  }

  async function runSearch() {
    var f = {
      q: $('wrSQ').value.trim(),
      assignee: $('wrSAssignee').value.trim(),
      client: $('wrSClient').value.trim(),
      status: $('wrSStatus').value,
      section: $('wrSSection').value,
      pane: $('wrSPane').value,
      from: $('wrSFrom').value,
      to: $('wrSTo').value
    };
    var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(f[k]);
    }).join('&');
    var box = $('wrSearchResult');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 검색 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/search?' + qs);
      var rows = r.data || [];
      $('wrSearchCount').textContent = rows.length + '건';
      if (!rows.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">결과 없음</div>';
        return;
      }
      var html = '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;overflow:auto">'
        + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +   '<thead><tr>'
        +     th('주차') + th('섹션') + th('사이트') + th('업무') + th('D-day') + th('%') + th('담당자') + th('상태')
        +   '</tr></thead><tbody>'
        + rows.map(function (m) {
            var it = m.item || {};
            var details = (it.details || []).map(function (d) {
              return '<div style="color:var(--t5);font-size:11px;margin-top:2px">: ' + esc(d.text) + '</div>';
            }).join('');
            var members = (it.members || []).map(function (mm) {
              return '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;background:var(--bg-i);color:var(--t5);margin:1px 2px 1px 0">@' + esc(mm) + '</span>';
            }).join('');
            return '<tr>'
              + td('<div style="font-weight:600">' + esc(m.week_label || '-') + '</div><div style="font-size:10px;color:var(--t6)">' + esc(m.team || '') + '</div>')
              + td(esc(SECTION_LABEL[it.section] || it.section || ''))
              + td('<strong>' + esc(it.client || '') + '</strong>')
              + td(esc(it.name || '') + details)
              + td(esc(it.deadline || ''))
              + td(it.pct >= 0 ? esc(it.pct + '%') : '')
              + td(members)
              + td(statusPill(it.status))
              + '</tr>';
          }).join('')
        + '</tbody></table></div>';
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">검색 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function th(t) { return '<th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--bd);font-size:11px;color:var(--t5);font-weight:600;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">' + t + '</th>'; }
  function td(html) { return '<td style="padding:8px 10px;border-bottom:1px solid var(--bd);vertical-align:top">' + html + '</td>'; }

  /* ─── 통계 ─── */
  function renderStats() {
    $('wrPanel').innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +     inputCell('wrStTeam', 'text', '팀 (예: 소프트웨어팀)')
      +     inputCell('wrStFrom', 'date', '')
      +     inputCell('wrStTo', 'date', '')
      +     '<button id="wrStatsBtn" class="tab on" style="padding:7px 18px">조회</button>'
      +   '</div>'
      + '</div>'
      + '<div id="wrStatsResult"></div>';
    $('wrStatsBtn').addEventListener('click', runStats);
    runStats();
  }

  async function runStats() {
    var f = { team: $('wrStTeam').value.trim(), from: $('wrStFrom').value, to: $('wrStTo').value };
    var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(f[k]);
    }).join('&');
    var box = $('wrStatsResult');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 조회 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/stats' + (qs ? '?' + qs : ''));
      var d = r.data;
      if (!d || !d.weekly || !d.weekly.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">데이터 없음 — 먼저 업로드 탭에서 JSON을 올려주세요</div>';
        return;
      }
      var totals = d.totals;
      var stHtml = ''
        + statCard('주차 수', totals.weeks)
        + statCard('총 항목', totals.items)
        + statCard('완료', totals.byStatus.done, '#1a8a40')
        + statCard('진행중', totals.byStatus.in_progress, '#d03030')
        + statCard('완료율', totals.completion_rate + '%');
      var weeklyRows = d.weekly.map(function (w) {
        return '<tr>'
          + td('<strong>' + esc(w.week_label || '-') + '</strong> <span style="color:var(--t6);font-size:11px">' + esc(w.week_start || '') + '</span>')
          + td(String(w.total))
          + td('<span style="color:#1a8a40">' + w.done + '</span>')
          + td('<span style="color:#d03030">' + w.in_progress + '</span>')
          + td('<div>' + w.completion_rate + '%</div><div style="height:5px;background:var(--bd);border-radius:3px;margin-top:4px;overflow:hidden"><div style="height:100%;width:' + w.completion_rate + '%;background:linear-gradient(90deg,var(--ac),#7aaade)"></div></div>')
          + td(w.avg_pct == null ? '-' : (w.avg_pct + '%'))
          + '</tr>';
      }).join('');
      var memHtml = (d.byMember || []).slice(0, 15).map(function (m) {
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>@' + esc(m.key) + '</span><span style="color:var(--t5)">' + m.count + '건</span></div>';
      }).join('');
      var cliHtml = (d.byClient || []).slice(0, 15).map(function (c) {
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>' + esc(c.key) + '</span><span style="color:var(--t5)">' + c.count + '건</span></div>';
      }).join('');
      box.innerHTML = ''
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">' + stHtml + '</div>'
        + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:12px">'
        +   '<div style="font-size:13px;font-weight:600;margin-bottom:10px">주차별 진행</div>'
        +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +     '<thead><tr>' + th('주차') + th('총') + th('완료') + th('진행중') + th('완료율') + th('평균%') + '</tr></thead>'
        +     '<tbody>' + weeklyRows + '</tbody>'
        +   '</table>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
        +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
        +     '<div style="font-size:13px;font-weight:600;margin-bottom:8px">담당자별 (상위 15)</div>' + memHtml
        +   '</div>'
        +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
        +     '<div style="font-size:13px;font-weight:600;margin-bottom:8px">사이트별 (상위 15)</div>' + cliHtml
        +   '</div>'
        + '</div>';
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function statCard(label, val, color) {
    return '<div style="flex:1 1 140px;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px">'
      +   '<div style="font-size:11px;color:var(--t6);text-transform:uppercase;letter-spacing:.5px">' + esc(label) + '</div>'
      +   '<div style="font-size:22px;font-weight:700;margin-top:4px' + (color ? ';color:' + color : '') + '">' + esc(String(val)) + '</div>'
      + '</div>';
  }

  /* ─── 목록 ─── */
  async function renderList() {
    var box = $('wrPanel');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports');
      var rows = r.data || [];
      if (!rows.length) {
        box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5);background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">업로드된 보고서가 없습니다</div>';
        return;
      }
      var bodyRows = rows.map(function (it) {
        var st = (it.stats && it.stats.cur) || {};
        var bs = st.byStatus || {};
        return '<tr>'
          + td('<strong>' + esc(it.week_label || '-') + '</strong>')
          + td(esc(it.team || '-'))
          + td('<span style="font-size:11px;color:var(--t5)">' + esc(it.name) + '</span>')
          + td(esc(it.week_start || '-') + ' ~ ' + esc(it.week_end || '-'))
          + td('<span style="color:#1a8a40">' + (bs.done || 0) + '</span> / <span style="color:#d03030">' + (bs.in_progress || 0) + '</span> / ' + (st.total || 0))
          + td('<span style="font-size:11px;color:var(--t6)">' + esc(it.saved_at ? new Date(it.saved_at).toLocaleString('ko-KR') : '-') + '</span>')
          + td('<button class="tab" data-prev="' + esc(it.id) + '" style="padding:4px 10px;font-size:11px;color:var(--ac);border:1px solid var(--ac);background:transparent;margin-right:4px">미리보기</button>'
              + '<button class="tab" data-del="' + esc(it.id) + '" style="padding:4px 10px;font-size:11px;color:#d03030;border:1px solid #d03030;background:transparent">삭제</button>')
          + '</tr>';
      }).join('');
      box.innerHTML = ''
        + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;overflow:auto">'
        +   '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        +     '<thead><tr>'
        +       th('주차') + th('팀') + th('이름') + th('기간') + th('완료/진행/총') + th('저장') + th('')
        +     '</tr></thead>'
        +     '<tbody>' + bodyRows + '</tbody>'
        +   '</table>'
        + '</div>';
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () { deleteReport(b.dataset.del); });
      });
      box.querySelectorAll('[data-prev]').forEach(function (b) {
        b.addEventListener('click', function () { renderPreview(b.dataset.prev); });
      });
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  /* ─── 미리보기 ─── */
  var _previewState = { id: null, pane: 'cur', data: null };
  async function renderPreview(id) {
    var box = $('wrPanel');
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t5)">⏳ 불러오는 중...</div>';
    try {
      var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
      _previewState.id = id;
      _previewState.data = r.data;
      _previewState.pane = 'cur';
      drawPreview();
    } catch (e) {
      box.innerHTML = '<div style="padding:14px;color:#d03030;background:var(--bg-p);border:1px solid var(--bd);border-radius:8px">불러오기 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function drawPreview() {
    var box = $('wrPanel');
    var d = _previewState.data;
    if (!d) return;
    var parsed = d.parsed || {};
    var pane = _previewState.pane;
    var paneData = parsed[pane];
    var meta = parsed.meta || {};
    box.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      +   '<button id="wrPrevBack" class="tab" style="padding:6px 12px">← 목록</button>'
      +   '<div style="flex:1">'
      +     '<div style="font-size:15px;font-weight:700">' + esc(meta.weekLabel || d.week_label || '-') + ' · ' + esc(meta.team || d.team || '') + '</div>'
      +     '<div style="font-size:11px;color:var(--t5)">' + esc(d.name) + ' · ' + esc(d.week_start || '') + ' ~ ' + esc(d.week_end || '') + '</div>'
      +   '</div>'
      +   '<div class="tabs sub-tabs" style="margin:0">'
      +     '<button class="tab' + (pane === 'last' ? ' on' : '') + '" data-pp="last">지난주</button>'
      +     '<button class="tab' + (pane === 'cur'  ? ' on' : '') + '" data-pp="cur">금주</button>'
      +   '</div>'
      + '</div>'
      + '<div id="wrPrevBody" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:8px;padding:16px">'
      +   buildPreviewHTML(paneData)
      + '</div>';
    $('wrPrevBack').addEventListener('click', function () { renderList(); });
    box.querySelectorAll('[data-pp]').forEach(function (b) {
      b.addEventListener('click', function () { _previewState.pane = b.dataset.pp; drawPreview(); });
    });
  }

  async function deleteReport(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await apiFetch('/api/weekly-reports/' + encodeURIComponent(id), { method: 'DELETE' });
      if (typeof showToast === 'function') showToast('삭제됨', 'ok');
      renderList();
    } catch (e) {
      alert('삭제 실패: ' + (e.message || e));
    }
  }

  /* ═══════════════════════════════════════════════════════════
     작성 탭 — 편집기 + 라이브 프리뷰 + 팀관리 데이터 인서트
     ═══════════════════════════════════════════════════════════ */

  // 클라이언트 사이드 텍스트 파서 (서버와 동일 로직)
  function clientParseText(text) {
    var SEC_MAP = { '개발': 'dev', '셋업': 'setup', 'C/S': 'cs', 'CS': 'cs', '기타': 'etc' };
    if (!text) return { sections: [] };
    var sections = [], cur = null, item = null;
    var lines = text.split('\n');
    function detectStatus(t) {
      if (/#완료/.test(t)) return 'done';
      if (/#진행중?/.test(t)) return 'in_progress';
      return 'none';
    }
    function members(t) {
      return (t.match(/@([^\s@]+)/g) || []).map(function (s) { return s.slice(1); });
    }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (!line) continue;
      var sm = line.match(/^\[([^\]]+)\]$/);
      if (sm) {
        var k = Object.keys(SEC_MAP).find(function (key) { return sm[1].indexOf(key) >= 0; });
        if (k) { cur = { type: SEC_MAP[k], label: sm[1], items: [] }; sections.push(cur); item = null; continue; }
      }
      if (!cur) continue;
      var im = line.match(/^-\s+\[([^\]]+)\]\s*(.*)/);
      if (im) {
        var rest = im[2].trim();
        var dm = rest.match(/(~\d{2}\/\d{2})/);
        var pm = rest.match(/(\d+)%/) || rest.match(/#%(\d+)/);
        var name = rest.replace(/@[^\s@]+/g, '').replace(/(~\d{2}\/\d{2})/g, '').replace(/\d+%/g, '').replace(/#%\d+/g, '').replace(/#완료|#진행중?/g, '').trim();
        item = {
          section: cur.type,
          client: im[1].trim(),
          name: name,
          deadline: dm ? dm[1] : '',
          pct: pm ? parseInt(pm[1], 10) : -1,
          members: members(rest),
          status: detectStatus(rest),
          details: []
        };
        cur.items.push(item);
        continue;
      }
      if (item && !/^-\s*\[/.test(line)) {
        var c = line.match(/^:\s*(.+)/);
        var d = line.match(/^[-–]\.\s*(.+)/);
        var dt = c ? c[1].trim() : (d ? d[1].trim() : null);
        if (dt) {
          var dMembers = members(dt);
          item.details.push({ text: dt, members: dMembers, status: detectStatus(dt) });
          dMembers.forEach(function (m) { if (item.members.indexOf(m) < 0) item.members.push(m); });
        }
      }
    }
    sections.forEach(function (sec) {
      sec.items.forEach(function (it) {
        if (it.status === 'none' && it.details.length) {
          var hasDone = it.details.some(function (x) { return x.status === 'done'; });
          var hasProg = it.details.some(function (x) { return x.status === 'in_progress'; });
          if (hasDone && !hasProg) it.status = 'done';
          else if (hasProg) it.status = 'in_progress';
        }
      });
    });
    return { sections: sections };
  }

  // 작성 탭 상태
  var _authorState = {
    team: '',
    weekStart: '',
    weekEnd: '',
    lastText: '',
    curText: '',
    editPane: 'cur',
    previewPane: 'cur',
    loadedId: null,
    loadedName: '',
    workRecords: [],
    sourceFilter: { name: '', oclient: '' },
    sourceGroupBy: 'name'
  };

  function defaultWeekRange() {
    var now = new Date();
    var day = now.getDay();
    var diffToMon = (day === 0 ? -6 : 1 - day);
    var mon = new Date(now); mon.setDate(now.getDate() + diffToMon);
    var fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    function toIso(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return { start: toIso(mon), end: toIso(fri) };
  }

  function renderAuthor() {
    if (!_authorState.weekStart) {
      var d = defaultWeekRange();
      _authorState.weekStart = d.start;
      _authorState.weekEnd = d.end;
    }
    var box = $('wrPanel');
    box.innerHTML = ''
      + '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:12px;margin-bottom:10px">'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +     '<label style="font-size:11px;color:var(--t5)">팀</label>'
      +     '<input id="wrAuTeam" type="text" placeholder="소프트웨어팀" value="' + esc(_authorState.team) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit;width:140px">'
      +     '<label style="font-size:11px;color:var(--t5);margin-left:6px">주차</label>'
      +     '<input id="wrAuStart" type="date" value="' + esc(_authorState.weekStart) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<span style="color:var(--t6)">~</span>'
      +     '<input id="wrAuEnd" type="date" value="' + esc(_authorState.weekEnd) + '" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<button id="wrAuLoadList" class="tab" style="padding:6px 12px">📂 불러오기</button>'
      +     '<button id="wrAuLoadPrev" class="tab" style="padding:6px 12px" title="가장 최근 주의 curText를 lastText로 복사">⬅ 지난주에서 가져오기</button>'
      +     '<button id="wrAuNew" class="tab" style="padding:6px 12px">📋 새로 만들기</button>'
      +     '<div style="flex:1"></div>'
      +     '<span id="wrAuStatusBadge" style="font-size:11px;color:var(--t5)"></span>'
      +     '<button id="wrAuSave" class="tab on" style="padding:6px 14px">💾 저장 (R+1)</button>'
      +     '<button id="wrAuOverwrite" class="tab" style="padding:6px 12px;display:none">💾 덮어쓰기</button>'
      +   '</div>'
      +   '<div id="wrAuLoadDropdown" style="display:none;margin-top:8px"></div>'
      + '</div>'
      + '<div id="wrAuMain" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
      +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:10px;display:flex;flex-direction:column;min-height:480px">'
      +     '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      +       '<div style="font-size:12px;font-weight:600;color:var(--t3)">✏️ 편집</div>'
      +       '<div class="tabs sub-tabs" style="margin:0">'
      +         '<button class="tab' + (_authorState.editPane === 'last' ? ' on' : '') + '" data-ep="last">지난주</button>'
      +         '<button class="tab' + (_authorState.editPane === 'cur'  ? ' on' : '') + '" data-ep="cur">금주</button>'
      +       '</div>'
      +     '</div>'
      +     authorToolbar()
      +     '<textarea id="wrAuEditor" spellcheck="false" placeholder="[개발]\n- [사이트] 업무명 ~MM/DD 50% @담당자\n  : 세부내용 #진행중\n\n[셋업]\n..." style="flex:1;width:100%;min-height:380px;padding:10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12.5px;font-family:ui-monospace,Consolas,monospace;line-height:1.6;resize:vertical"></textarea>'
      +     '<div style="font-size:10.5px;color:var(--t6);margin-top:6px;line-height:1.5">'
      +       '섹션: <code>[개발][셋업][C/S][기타]</code> · 항목: <code>- [사이트] 이름 ~MM/DD 50% @담당자</code> · 세부: <code>: 세부내용</code> · 태그: <code>#완료 #진행중 #%70 {bold} =y{형광}</code>'
      +     '</div>'
      +   '</div>'
      +   '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:10px;min-height:480px">'
      +     '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      +       '<div style="font-size:12px;font-weight:600;color:var(--t3)">👁 미리보기</div>'
      +       '<div class="tabs sub-tabs" style="margin:0">'
      +         '<button class="tab' + (_authorState.previewPane === 'last' ? ' on' : '') + '" data-pv="last">지난주</button>'
      +         '<button class="tab' + (_authorState.previewPane === 'cur'  ? ' on' : '') + '" data-pv="cur">금주</button>'
      +       '</div>'
      +     '</div>'
      +     '<div id="wrAuPreview" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:6px;padding:12px;min-height:380px;overflow:auto"></div>'
      +   '</div>'
      + '</div>'
      + '<details id="wrAuSrc" open style="background:var(--bg-p);border:1px solid var(--bd);border-radius:8px;padding:10px">'
      +   '<summary style="cursor:pointer;font-size:13px;font-weight:600;padding:4px 0">📋 팀관리 데이터 — 선택 주차의 업무일지 <span id="wrAuSrcCount" style="color:var(--t5);font-weight:400"></span></summary>'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center">'
      +     '<button id="wrAuSrcReload" class="tab" style="padding:6px 12px">↻ 새로고침</button>'
      +     '<input id="wrAuSrcName" type="text" placeholder="담당자 필터" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<input id="wrAuSrcOClient" type="text" placeholder="사이트 필터" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +     '<select id="wrAuSrcGroup" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg-i);color:var(--t2);font-size:12px;font-family:inherit">'
      +       '<option value="name">담당자별 그룹</option>'
      +       '<option value="oclient">사이트별 그룹</option>'
      +       '<option value="none">그룹 없음</option>'
      +     '</select>'
      +   '</div>'
      +   '<div id="wrAuSrcBody" style="max-height:340px;overflow:auto"></div>'
      + '</details>';

    applyResponsiveAuthor();

    $('wrAuTeam').addEventListener('input', function (e) { _authorState.team = e.target.value.trim(); });
    $('wrAuStart').addEventListener('change', function (e) { _authorState.weekStart = e.target.value; loadWorkRecords(); });
    $('wrAuEnd').addEventListener('change', function (e) { _authorState.weekEnd = e.target.value; loadWorkRecords(); });

    box.querySelectorAll('[data-ep]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ed = $('wrAuEditor');
        _authorState[_authorState.editPane === 'last' ? 'lastText' : 'curText'] = ed.value;
        _authorState.editPane = b.dataset.ep;
        renderAuthor();
      });
    });
    box.querySelectorAll('[data-pv]').forEach(function (b) {
      b.addEventListener('click', function () { _authorState.previewPane = b.dataset.pv; renderAuthor(); });
    });

    var ed = $('wrAuEditor');
    ed.value = _authorState.editPane === 'last' ? _authorState.lastText : _authorState.curText;
    var debounceT = null;
    ed.addEventListener('input', function () {
      _authorState[_authorState.editPane === 'last' ? 'lastText' : 'curText'] = ed.value;
      clearTimeout(debounceT);
      debounceT = setTimeout(updateAuthorPreview, 200);
    });
    ed.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAuthor(false); }
    });

    box.querySelectorAll('[data-insert]').forEach(function (b) {
      b.addEventListener('click', function () { insertAtCursor('wrAuEditor', b.dataset.insert); });
    });

    $('wrAuNew').addEventListener('click', authorNew);
    $('wrAuLoadList').addEventListener('click', toggleLoadDropdown);
    $('wrAuLoadPrev').addEventListener('click', authorLoadFromPrevWeek);
    $('wrAuSave').addEventListener('click', function () { saveAuthor(true); });
    $('wrAuOverwrite').addEventListener('click', function () { saveAuthor(false); });

    $('wrAuSrcReload').addEventListener('click', loadWorkRecords);
    $('wrAuSrcName').addEventListener('input', function (e) { _authorState.sourceFilter.name = e.target.value.trim(); renderSourcePanel(); });
    $('wrAuSrcOClient').addEventListener('input', function (e) { _authorState.sourceFilter.oclient = e.target.value.trim(); renderSourcePanel(); });
    $('wrAuSrcGroup').value = _authorState.sourceGroupBy;
    $('wrAuSrcGroup').addEventListener('change', function (e) { _authorState.sourceGroupBy = e.target.value; renderSourcePanel(); });

    updateAuthorPreview();
    updateAuthorStatusBadge();
    if (!_authorState.workRecords.length && _authorState.weekStart && _authorState.weekEnd) loadWorkRecords();
    else renderSourcePanel();
  }

  function applyResponsiveAuthor() {
    var main = $('wrAuMain');
    if (!main) return;
    function check() {
      if (window.innerWidth < 1100) main.style.gridTemplateColumns = '1fr';
      else main.style.gridTemplateColumns = '1fr 1fr';
    }
    check();
    if (!window._wrAuRz) {
      window.addEventListener('resize', function () { var m = $('wrAuMain'); if (m) check(); });
      window._wrAuRz = true;
    }
  }

  function authorToolbar() {
    function btn(label, insert, title) {
      return '<button class="tab" data-insert="' + esc(insert) + '" title="' + esc(title || '') + '" style="padding:4px 8px;font-size:11px">' + esc(label) + '</button>';
    }
    return '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">'
      + btn('[개발]', '\n[개발]\n')
      + btn('[셋업]', '\n[셋업]\n')
      + btn('[C/S]', '\n[C/S]\n')
      + btn('[기타]', '\n[기타]\n')
      + '<span style="width:8px"></span>'
      + btn('- 항목', '- [사이트] 업무명 ~MM/DD 50% @담당자\n')
      + btn(': 세부', '  : ')
      + '<span style="width:8px"></span>'
      + btn('#완료', ' #완료 ')
      + btn('#진행중', ' #진행중 ')
      + btn('#%50', ' #%50 ')
      + '<span style="width:8px"></span>'
      + btn('{굵게}', '{}')
      + btn('=y{형광}', '=y{}')
      + '</div>';
  }

  function insertAtCursor(taId, text) {
    var ta = $(taId);
    if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var v = ta.value;
    ta.value = v.slice(0, s) + text + v.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateAuthorPreview() {
    var pv = $('wrAuPreview');
    if (!pv) return;
    var text = _authorState.previewPane === 'last' ? _authorState.lastText : _authorState.curText;
    if (!text || !text.trim()) {
      pv.innerHTML = '<div style="color:var(--t6);text-align:center;padding:32px">내용을 입력하면 여기에 미리보기가 표시됩니다</div>';
      return;
    }
    var parsed = clientParseText(text);
    pv.innerHTML = buildPreviewHTML(parsed);
  }

  function updateAuthorStatusBadge() {
    var el = $('wrAuStatusBadge');
    if (!el) return;
    if (_authorState.loadedId) {
      el.innerHTML = '✏️ 편집 중: <strong style="color:var(--t3)">' + esc(_authorState.loadedName) + '</strong>';
      var ow = $('wrAuOverwrite'); if (ow) ow.style.display = '';
    } else {
      el.innerHTML = '<span style="color:var(--t6)">새 보고서 (저장 시 자동 R 부여)</span>';
      var ow2 = $('wrAuOverwrite'); if (ow2) ow2.style.display = 'none';
    }
  }

  function authorNew() {
    if (_authorState.lastText || _authorState.curText) {
      if (!confirm('현재 작성 내용이 사라집니다. 새로 만드시겠습니까?')) return;
    }
    _authorState.lastText = '';
    _authorState.curText = '';
    _authorState.loadedId = null;
    _authorState.loadedName = '';
    renderAuthor();
  }

  async function authorLoadFromPrevWeek() {
    try {
      var r = await apiFetch('/api/weekly-reports?limit=10');
      var rows = r.data || [];
      if (!rows.length) { alert('저장된 보고서가 없습니다.'); return; }
      var match = _authorState.team ? rows.filter(function (x) { return x.team === _authorState.team; })[0] : rows[0];
      if (!match) match = rows[0];
      var d = await apiFetch('/api/weekly-reports/' + encodeURIComponent(match.id));
      var prevCur = d.data && d.data.cur_text || '';
      if (!prevCur) { alert('이전 주 금주 텍스트가 비어있습니다.'); return; }
      if (_authorState.lastText && !confirm('현재 [지난주] 텍스트를 덮어씁니다. 진행할까요?')) return;
      _authorState.lastText = prevCur;
      _authorState.editPane = 'last';
      renderAuthor();
    } catch (e) {
      alert('가져오기 실패: ' + (e.message || e));
    }
  }

  async function toggleLoadDropdown() {
    var dd = $('wrAuLoadDropdown');
    if (dd.style.display === 'block') { dd.style.display = 'none'; return; }
    dd.innerHTML = '<div style="color:var(--t5);padding:6px;font-size:12px">⏳ 목록 로드...</div>';
    dd.style.display = 'block';
    try {
      var r = await apiFetch('/api/weekly-reports?limit=50');
      var rows = r.data || [];
      if (!rows.length) { dd.innerHTML = '<div style="color:var(--t5);padding:6px;font-size:12px">저장된 보고서가 없습니다.</div>'; return; }
      dd.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + rows.map(function (it) {
            return '<button class="tab" data-load-id="' + esc(it.id) + '" style="padding:5px 10px;font-size:11px;text-align:left">'
              + esc(it.week_label || '-') + ' · ' + esc(it.team || '') + ' <span style="color:var(--t6);margin-left:6px">' + esc(it.name) + '</span>'
              + '</button>';
          }).join('')
        + '</div>';
      dd.querySelectorAll('[data-load-id]').forEach(function (b) {
        b.addEventListener('click', function () { authorLoadById(b.dataset.loadId); $('wrAuLoadDropdown').style.display = 'none'; });
      });
    } catch (e) {
      dd.innerHTML = '<div style="color:#d03030;padding:6px;font-size:12px">조회 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  async function authorLoadById(id) {
    try {
      var r = await apiFetch('/api/weekly-reports/' + encodeURIComponent(id));
      var d = r.data;
      _authorState.loadedId = d.id;
      _authorState.loadedName = d.name;
      _authorState.team = d.team || _authorState.team;
      _authorState.weekStart = d.week_start ? String(d.week_start).slice(0, 10) : _authorState.weekStart;
      _authorState.weekEnd = d.week_end ? String(d.week_end).slice(0, 10) : _authorState.weekEnd;
      _authorState.lastText = d.last_text || '';
      _authorState.curText = d.cur_text || '';
      renderAuthor();
    } catch (e) {
      alert('불러오기 실패: ' + (e.message || e));
    }
  }

  async function saveAuthor(asNewVersion) {
    if (!_authorState.team) { alert('팀명을 입력하세요.'); return; }
    if (!_authorState.weekStart || !_authorState.weekEnd) { alert('주차를 선택하세요.'); return; }
    var ed = $('wrAuEditor');
    if (ed) _authorState[_authorState.editPane === 'last' ? 'lastText' : 'curText'] = ed.value;

    var name;
    if (asNewVersion || !_authorState.loadedName) {
      try {
        var r = await apiFetch('/api/weekly-reports/next-name?team=' + encodeURIComponent(_authorState.team)
          + '&weekStart=' + encodeURIComponent(_authorState.weekStart)
          + '&weekEnd=' + encodeURIComponent(_authorState.weekEnd));
        name = r.data && r.data.nextName;
      } catch (e) { alert('이름 조회 실패: ' + (e.message || e)); return; }
    } else {
      name = _authorState.loadedName;
    }
    if (!name) { alert('이름 생성 실패'); return; }

    var payload = {
      version: 1,
      name: name,
      savedAt: new Date().toLocaleString('ko-KR'),
      lastText: _authorState.lastText || '',
      curText: _authorState.curText || ''
    };

    try {
      var resp = await apiFetch('/api/weekly-reports', { method: 'POST', body: JSON.stringify(payload) });
      var saved = resp.data && resp.data[0];
      _authorState.loadedId = saved && saved.id;
      _authorState.loadedName = name;
      if (typeof showToast === 'function') showToast('저장됨: ' + name, 'ok');
      else alert('저장됨: ' + name);
      updateAuthorStatusBadge();
    } catch (e) {
      alert('저장 실패: ' + (e.message || e));
    }
  }

  async function loadWorkRecords() {
    var body = $('wrAuSrcBody');
    var cnt = $('wrAuSrcCount');
    if (!_authorState.weekStart || !_authorState.weekEnd) { if (cnt) cnt.textContent = ''; if (body) body.innerHTML = ''; return; }
    var start = _authorState.weekStart.replace(/-/g, '');
    var end = _authorState.weekEnd.replace(/-/g, '');
    if (body) body.innerHTML = '<div style="color:var(--t5);padding:8px;font-size:12px">⏳ 로드 중...</div>';
    try {
      var r = await apiFetch('/api/archives/records?startDate=' + start + '&endDate=' + end + '&all=true&limit=2000');
      _authorState.workRecords = r.data || [];
      if (cnt) cnt.textContent = '· ' + _authorState.workRecords.length + '건';
      renderSourcePanel();
    } catch (e) {
      if (body) body.innerHTML = '<div style="color:#d03030;padding:8px;font-size:12px">로드 실패: ' + esc(e.message || e) + '</div>';
    }
  }

  function renderSourcePanel() {
    var body = $('wrAuSrcBody');
    if (!body) return;
    var rows = _authorState.workRecords;
    var f = _authorState.sourceFilter;
    if (f.name) rows = rows.filter(function (r) { return (r.name || '').indexOf(f.name) >= 0; });
    if (f.oclient) rows = rows.filter(function (r) { return (r.oclient || '').indexOf(f.oclient) >= 0; });
    if (!rows.length) { body.innerHTML = '<div style="color:var(--t6);padding:12px;text-align:center;font-size:12px">데이터 없음</div>'; return; }

    var grouped = {};
    var groupKey = _authorState.sourceGroupBy;
    if (groupKey === 'none') {
      grouped['전체'] = rows;
    } else {
      rows.forEach(function (r) {
        var k = (r[groupKey] || '미지정') + '';
        (grouped[k] = grouped[k] || []).push(r);
      });
    }

    var html = '';
    Object.keys(grouped).sort().forEach(function (k) {
      html += '<details open style="margin-bottom:6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i)">'
        + '<summary style="cursor:pointer;padding:6px 10px;font-size:12px;font-weight:600;color:var(--t3)">' + esc(k) + ' <span style="color:var(--t6);font-weight:400">(' + grouped[k].length + ')</span></summary>'
        + '<div style="padding:0 10px 8px">'
        + grouped[k].map(function (r) {
            var dateStr = r.date ? (String(r.date).length === 8 ? String(r.date).slice(4, 6) + '/' + String(r.date).slice(6, 8) : r.date) : '';
            var content = r.content || '';
            var ocl = r.oclient || '';
            var nm = r.name || '';
            var hrs = r.hours || 0;
            var inj = '- [' + (ocl || '미정') + '] ' + content.replace(/\s+/g, ' ').trim() + (nm ? ' @' + nm : '');
            return '<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--bd);font-size:11.5px;align-items:flex-start">'
              + '<span style="color:var(--t6);font-family:ui-monospace,monospace;flex-shrink:0;width:42px">' + esc(dateStr) + '</span>'
              + '<span style="color:var(--t5);flex-shrink:0;width:50px">' + esc(nm) + '</span>'
              + '<span style="color:var(--ac);flex-shrink:0;width:60px">' + esc(ocl) + '</span>'
              + '<span style="color:var(--t6);flex-shrink:0;width:36px;font-family:ui-monospace,monospace">' + hrs + 'h</span>'
              + '<span style="flex:1;color:var(--t3);min-width:0">' + esc(content) + '</span>'
              + '<button class="tab" data-src-add="' + esc(inj) + '" title="편집기에 항목으로 삽입" style="padding:2px 8px;font-size:11px;flex-shrink:0">+ 추가</button>'
              + '</div>';
          }).join('')
        + '</div></details>';
    });
    body.innerHTML = html;
    body.querySelectorAll('[data-src-add]').forEach(function (b) {
      b.addEventListener('click', function () { insertAtCursor('wrAuEditor', '\n' + b.dataset.srcAdd + '\n'); });
    });
  }
})();
