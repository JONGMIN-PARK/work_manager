/* notebook-print-ui.js — 🖨 출력 미리 보기 창 (v13.319)
   nbPrintOpen()            지금 노트(또는 일일 노트) 한 장
   nbPrintBundle(src)       여러 날 · 여러 노트 묶어 출력 (src: 'daily' | 'notes')
   왼쪽 A4 종이(쪽 나뉨 표시) · 오른쪽 설정 — 고르는 즉시 다시 그림. 설정은 브라우저에 기억(양식 칸 제외)
   🖨 인쇄 · PDF / 📝 Word / 📋 서식째 복사 / 🤝 프로젝트 회의로 올리기(회의록 양식) */
var NBPR = { items: [], mode: 'one', o: null, ps: null, img: {}, timer: null, last: null, bundle: null, pages: 0 };
var NBPR_KEEP = ['theme', 'accent', 'size', 'landscape', 'margin', 'header', 'docNo', 'pageNo', 'sign', 'ink', 'writer', 'dept', 'perPage', 'toc'];

/* ═══ 공용 (v13.320) — 노트 출력 · 프로젝트 회의록이 같이 씀 ═══ */
/** 출력 설정 — 브라우저에 기억한 것 + 기본값. 양식(form)은 매번 자동. 옛 회의록 결재란(pmtSign)도 이어받음 */
function wmPrintPrefs() {
  var o = {};
  try { o = JSON.parse(localStorage.getItem('nb-print-v1') || 'null') || {}; } catch (e) { o = {}; }
  var me = typeof currentUser !== 'undefined' && currentUser ? currentUser : {};
  var x = {}; NBPR_KEEP.forEach(function (k) { if (o[k] != null) x[k] = o[k]; });
  if (x.sign == null) { try { if (localStorage.getItem('pmtSign') === '1') x.sign = '작성,검토,승인'; } catch (e) { /* */ } }
  if (x.writer == null) x.writer = me.displayName || me.name || '';
  if (x.dept == null) x.dept = me.department || me.dept || '';
  x.form = 'auto';
  return Object.assign({}, NbPrint.DEF, x);
}
function wmPrintPrefsSave(o) {
  var x = {}; NBPR_KEEP.forEach(function (k) { x[k] = o[k]; });
  try { localStorage.setItem('nb-print-v1', JSON.stringify(x)); } catch (e) { /* 기억 못 해도 출력은 됨 */ }
}
/** 서버 회의록 문서에 보낼 설정 */
function wmPrintDocBody(o) {
  o = o || wmPrintPrefs();
  return { theme: o.theme, accent: o.accent, signs: String(o.sign || '').split(/[,·]/).map(function (s) { return s.trim(); }).filter(Boolean), header: !!o.header, docNo: o.docNo !== false };
}
/**
 * 종이 미리 보기 (v13.321 — 인쇄되는 그대로) — A4 종이를 한 장씩 따로 그리고, 쪽이 넘어가는 줄(표 줄 · 문단 · 그림)은
 * 인쇄처럼 다음 장으로 넘기고, 매 장 위아래에 머리글 · 문서 번호 · 쪽 번호를 그대로 보여 준다. 창 폭에 맞게 줄임.
 * 화면용 꾸밈(.pv-*)은 인쇄 때 모두 빠진다 — 인쇄는 @page 가 같은 자리에 붙인다.
 * p: { frame, wrap, paper, scroller, html, o, title, docNo, live, onPages(n) }
 *    live: 같은 머리(설정)면 iframe 을 다시 싣지 않고 본문만 바꿈 — 쓰는 동안 깜빡임 · 스크롤 튐 없이
 */
var WM_PV_CSS = '@media screen{html{background:transparent!important}body{background:transparent!important}' +
  '.pv-sheet{position:absolute;left:0;right:0;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.12),0 6px 18px rgba(15,23,42,.14);z-index:-1}' +
  '.pv-mb{position:absolute;font:8pt \'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}' +
  '.pv-pn{color:#64748b;font-size:8.5pt;left:0;right:0;text-align:center;max-width:none}}' +
  '@media print{.pv-sp,.pv-sheet,.pv-mb{display:none!important}}';
var WM_PV_GAP = 18;
function wmPaperPaint(p) {
  var fr = p.frame; if (!fr) return;
  var o = p.o || {}, pv = p.scroller, st = pv ? pv.scrollTop : 0;
  var W = o.landscape ? 1123 : 794;
  fr.style.width = W + 'px';
  // 창이 좁으면 종이를 줄여서 (가로 스크롤 없이) 한눈에
  var fit = pv ? Math.min(1, (pv.clientWidth - 28) / W) : 1;
  if (p.paper) { p.paper.style.transform = fit < 1 ? 'scale(' + fit.toFixed(3) + ')' : ''; p.paper.style.width = W + 'px'; }
  if (p.wrap) p.wrap.style.width = Math.floor(W * fit) + 'px';
  var html = String(p.html || '').replace('</head>', '<style>' + WM_PV_CSS + '</style></head>');
  var cut = html.indexOf('<body>'), head = cut < 0 ? html : html.slice(0, cut), inner = cut < 0 ? '' : html.slice(cut + 6).replace(/<\/body>\s*<\/html>\s*$/, '');
  function done() {
    try {
      var d = fr.contentDocument;
      var pages = _wmPaginate(d, o, p.title, p.docNo);
      var H = Math.max(1, pages * ((o.landscape ? 794 : 1123) + WM_PV_GAP) - WM_PV_GAP);
      fr.style.height = H + 'px';
      if (p.paper) p.paper.style.height = H + 'px';
      if (p.wrap) p.wrap.style.height = Math.ceil(H * fit) + 'px';
      if (pv) pv.scrollTop = st;
      if (p.onPages) p.onPages(pages);
    } catch (e) { /* 미리 보기만 */ }
  }
  var d0 = fr.contentDocument;
  if (p.live && fr._wmHead === head && d0 && d0.body && d0.readyState === 'complete') { d0.body.innerHTML = inner; done(); return; }
  fr._wmHead = head;
  fr.onload = done;
  fr.srcdoc = html;
}
/** 인쇄처럼 쪽 나누기 — 넘치는 줄은 다음 장으로 밀고(.pv-sp 빈칸), 장마다 흰 종이 · 머리글 · 쪽 번호. 쪽 수 */
function _wmPaginate(d, o, title, docNo) {
  var M = NbPrint.MARGIN[o.margin] || NbPrint.MARGIN.normal;
  var PH = o.landscape ? 794 : 1123, G = WM_PV_GAP, S = PH + G, top = NbPrint.mm(M[0]), side = NbPrint.mm(M[1]), CH = PH - 2 * top;
  var body = d.body, win = d.defaultView;
  var ATOM = 'tr,img,svg,p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,figure,hr,.nb-ink';
  function y(el) { return el.getBoundingClientRect().top + (win.scrollY || 0); }
  function lim(k) { return k * S + top + CH; }
  function beg(k) { return k * S + top; }
  function pageOf(v) { var k = Math.max(0, Math.floor((v - top) / S)); return k; }
  function blockKids(el) { return [].filter.call(el.children, function (c) { var ds = win.getComputedStyle(c).display; return ds !== 'none' && ds.indexOf('inline') !== 0 && !/^pv-/.test(c.className || ''); }); }
  function push(el, to) {
    var tr = el.tagName === 'TR', sp = d.createElement(tr ? 'tr' : 'div');
    sp.className = 'pv-sp';
    if (tr) sp.innerHTML = '<td colspan="60" style="padding:0;border:0;background:transparent"></td>';
    var cell = tr ? sp.firstChild : sp;
    cell.style.height = '0px'; if (!tr) sp.style.cssText = 'height:0;margin:0;padding:0';
    el.parentNode.insertBefore(sp, el);
    var need = to - y(el);
    if (need > 0) { cell.style.height = need + 'px'; var over = y(el) - to; if (over > 0) cell.style.height = Math.max(0, need - over) + 'px'; }
  }
  function walk(box) {
    blockKids(box).forEach(function (el) {
      if (/(^|\s)pg-brk(\s|$)/.test(el.className || '')) { var k0 = pageOf(y(el)); if (y(el) > beg(k0) + 2) push(el, beg(k0 + 1)); return; }
      var t = y(el), h = el.getBoundingClientRect().height, k = pageOf(t);
      if (t >= lim(k)) { push(el, beg(k + 1)); t = y(el); k = pageOf(t); }   // 바닥 여백 · 틈에 걸림
      if (t + h <= lim(k) + 1) return;
      var kids = el.matches(ATOM) ? [] : blockKids(el);
      if (!kids.length || el.tagName === 'TR') {
        if (t > beg(k) + 2 && h <= CH) {
          // 바로 앞 제목(break-after:avoid)은 혼자 바닥에 남기지 않고 같이 넘김 — 인쇄와 같게
          //   표 머리 줄(th 만)도 첫 줄과 같이, 표의 첫 줄이면 표 앞 제목까지
          var mv = el;
          for (var g = 0; g < 3; g++) {
            var pr = mv.previousElementSibling;
            if (!pr && mv.tagName === 'TR') { var tb = mv.closest('table'); pr = tb && tb.rows[0] === mv ? tb.previousElementSibling : null; }
            if (!pr || /^pv-/.test(pr.className || '') || pageOf(y(pr)) !== k || y(pr) <= beg(k) + 2) break;
            var head = pr.tagName === 'TR' ? !pr.querySelector('td') : win.getComputedStyle(pr).breakAfter === 'avoid';
            if (!head) break;
            mv = pr;
          }
          push(mv, beg(k + 1));
        }
        return;
      }
      walk(el.tagName === 'TABLE' && el.tBodies.length === 1 && !el.tHead ? el.tBodies[0] : el);
    });
  }
  walk(body);
  var end = body.scrollHeight - top, n = Math.max(1, pageOf(Math.max(top, end - 1)) + 1);
  var hd = o.header ? [o.company, title].filter(Boolean).join(' · ') : '', h = '';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  for (var i = 0; i < n; i++) {
    var y0 = i * S;
    h += '<div class="pv-sheet" style="top:' + y0 + 'px;height:' + PH + 'px"></div>';
    if (hd) h += '<div class="pv-mb" style="top:' + (y0 + Math.round(top / 2) - 6) + 'px;left:' + side + 'px">' + esc(hd) + '</div>';
    if (o.docNo && docNo) h += '<div class="pv-mb" style="top:' + (y0 + Math.round(top / 2) - 6) + 'px;right:' + side + 'px">' + esc(docNo) + '</div>';
    if (o.pageNo) h += '<div class="pv-mb pv-pn" style="top:' + (y0 + PH - Math.round(top / 2) - 6) + 'px">' + (i + 1) + ' / ' + n + '</div>';
  }
  body.insertAdjacentHTML('beforeend', h);
  return n;
}
function wmPaperHint(pages, o) { return pages + '쪽 · 인쇄되는 모습 그대로' + (o && o.pageNo ? ' (머리글 · 쪽 번호 포함)' : ''); }

/* ═══ 🖨 출력 모양 보기 (v13.321) — 노트를 쓰는 동안 옆에 인쇄될 종이 그대로 ═══ */
function nbPaperPaneHtml() {
  return '<div class="nb-paper" id="nbPaper"><div class="nb-paper-bar"><span id="nbPaperInfo">출력 모양</span><span class="nb-sp"></span>' +
    '<button class="nb-btn sm" data-nb="print" title="모양 · 결재란 · 머리글 바꾸기 · 인쇄 · PDF · Word">🖨 설정 · 인쇄</button></div>' +
    '<div class="nbpr-pv nb-paper-pv" id="nbPaperPv"><div class="nbpr-wrap" id="nbPaperWrap"><div class="nbpr-paper" id="nbPaperPaper"><iframe sandbox="allow-same-origin allow-modals" id="nbPaperFrame" title="출력 모양"></iframe></div></div></div></div>';
}
function nbPaperLive(delay) {
  if (typeof NB === 'undefined' || NB.mode !== 'paper' || !document.getElementById('nbPaperFrame')) return;
  clearTimeout(NBPR.liveT);
  NBPR.liveT = setTimeout(function () {
    var seq = (NBPR.liveSeq = (NBPR.liveSeq || 0) + 1);
    _nbprSettings().then(function (ps) {
      if (!NB.cur && !NB.daily1) return;
      var o = wmPrintPrefs(); o.company = ps.company || ''; o.logo = ps.logo || '';
      var it = _nbprCurItem(), ti = document.getElementById('nbTitle');
      if (ti && !NB.daily1) it.title = ti.value;
      var r = NbPrint.build([it], o);
      return _nbprImgs(r.inner).then(function (inner) {
        var fr = document.getElementById('nbPaperFrame'); if (!fr || seq !== NBPR.liveSeq) return;
        wmPaperPaint({ frame: fr, wrap: document.getElementById('nbPaperWrap'), paper: document.getElementById('nbPaperPaper'), scroller: document.getElementById('nbPaperPv'), o: o, live: true,
          html: NbPrint.page(inner, o, r.title, r.docNo), title: r.title, docNo: r.docNo,
          onPages: function (n) {
            var el = document.getElementById('nbPaperInfo');
            if (el) el.innerHTML = '📄 <b>' + _nbE(NbPrint.FORMS[r.forms[0]] || '') + '</b> 양식 · ' + n + '쪽 · 모양 ' + _nbE({ basic: '기본', formal: '공문', clean: '간결' }[o.theme] || o.theme) + (o.sign ? ' · 결재란' : '');
          } });
      });
    }).catch(function () { /* 미리 보기만 */ });
  }, delay == null ? 200 : delay);
}
window.addEventListener('resize', function () { nbPaperLive(150); if (typeof _pmtLiveResize === 'function') _pmtLiveResize(); });

function _nbprLoadOpts() { return wmPrintPrefs(); }
function _nbprSaveOpts() { wmPrintPrefsSave(NBPR.o); nbPaperLive(); }
function _nbprSettings() {
  if (NBPR.ps) return Promise.resolve(NBPR.ps);
  return apiFetch('/api/notebook/print-settings').then(function (r) { NBPR.ps = r.data || {}; return NBPR.ps; }).catch(function () { NBPR.ps = { company: '', logo: '', canEdit: false }; return NBPR.ps; });
}
/** 지금 열린 노트 → 출력 항목 하나 */
function _nbprCurItem() {
  var src = document.getElementById('nbSrc'), body = src ? src.value : '';
  if (NB.daily1) return { kind: 'daily', date: NB.daily1.date, ref: NB.daily1.ref || '', title: NB.daily1.ref ? NB.daily1.title : '', body: body };
  var n = NB.cur || {};
  var t = n.updatedAt ? new Date(new Date(n.updatedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) : _nbToday();
  return { kind: 'note', id: n.id, title: n.title || '', body: body, date: t, ink: n.ink || null, tags: n.tags || [] };
}

/* ═══ 열기 ═══ */
function nbPrintOpen() {
  if (!NB.cur && !NB.daily1) { _nbToast('출력할 노트를 먼저 여세요', 'warn'); return; }
  NBPR.mode = 'one'; NBPR.items = [_nbprCurItem()]; NBPR.bundle = null;
  return _nbprShow();
}
function nbPrintBundle(src) {
  NBPR.mode = 'bundle'; NBPR.items = [];
  // 기본은 최근 7일 — '이번 주'로 하면 월요일엔 하루뿐
  var t = _nbToday(), from = new Date(new Date(t + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10);
  NBPR.bundle = { src: src === 'notes' ? 'notes' : 'daily', from: from, to: t, folderId: NB.folder || '', tag: NB.tag || '', loading: false, msg: '' };
  return _nbprShow().then(function (ok) { if (ok) _nbprLoadBundle(); return ok; });
}
function _nbprShow() {
  return wmGuardedModal('nbPrint', function () {
    return _nbprSettings().then(function (ps) {
      NBPR.o = _nbprLoadOpts();
      NBPR.o.company = ps.company || ''; NBPR.o.logo = ps.logo || '';
      var md = createModal({ id: 'nbPrintModal', titleText: NBPR.mode === 'bundle' ? '🖨 묶어 출력' : '🖨 출력 미리 보기', width: '1240px', boxStyle: 'max-height:95vh;padding:16px 18px', closeOnEsc: true,
        html: '<div class="nbpr">' +
          '<div class="nbpr-pv" id="nbprPv"><div class="nbpr-wrap" id="nbprWrap"><div class="nbpr-paper" id="nbprPaper"><iframe sandbox="allow-same-origin allow-modals" id="nbprFrame" title="출력 미리 보기"></iframe></div></div></div>' +
          '<div class="nbpr-side" id="nbprSide"></div></div>' });
      NBPR.modal = md;
      _nbprDrawSide();
      md.box.querySelector('#nbprSide').addEventListener('click', _nbprClick);
      md.box.querySelector('#nbprSide').addEventListener('change', _nbprChange);
      md.box.querySelector('#nbprSide').addEventListener('input', function (e) { if (e.target.matches('input[type=text][data-o]')) _nbprChange(e); });
      _nbprRender();
    });
  }, 'nbPrintModal', { timeoutMs: 15000 });
}

/* ═══ 오른쪽 설정 ═══ */
function _nbprSeg(key, map, cur) {
  return '<div class="nbpr-seg">' + Object.keys(map).map(function (k) { return '<button type="button" data-o="' + key + '" data-v="' + _nbE(k) + '" class="' + (String(cur) === k ? 'on' : '') + '">' + _nbE(map[k]) + '</button>'; }).join('') + '</div>';
}
function _nbprChk(key, label, title) { return '<label class="nbpr-ck"' + (title ? ' title="' + _nbE(title) + '"' : '') + '><input type="checkbox" data-o="' + key + '"' + (NBPR.o[key] ? ' checked' : '') + '> ' + label + '</label>'; }
function _nbprDrawSide() {
  var o = NBPR.o, ps = NBPR.ps || {}, b = NBPR.bundle, h = '';
  h += '<div class="nbpr-act"><button class="nb-btn pri" data-pr="print" title="인쇄 창에서 대상을 \'PDF로 저장\'으로 고르면 PDF 파일">🖨 인쇄 · PDF 저장</button>' +
    '<div class="nbpr-act2"><button class="nb-btn" data-pr="doc">📝 Word</button><button class="nb-btn" data-pr="copy" title="메일 · 메신저에 붙이면 표 · 서식이 그대로">📋 서식째 복사</button></div>' +
    '<div class="nbpr-meet" id="nbprMeet"></div><div class="nbpr-pages" id="nbprPages"></div></div>';
  if (b) {
    var folders = (NB.meta && NB.meta.folders) || [], tags = (NB.meta && NB.meta.tags) || [];
    h += '<div class="nbpr-g"><div class="nbpr-gt">📚 무엇을 묶을까요</div>' + _nbprSeg('b-src', { daily: '📅 일일 노트', notes: '📓 내 노트' }, b.src) +
      '<div class="nbpr-row"><input type="date" class="mw-input nbpr-in" data-b="from" value="' + _nbE(b.from) + '"><span>~</span><input type="date" class="mw-input nbpr-in" data-b="to" value="' + _nbE(b.to) + '"></div>' +
      '<div class="nbpr-quick"><button type="button" data-pr="r-7">최근 7일</button><button type="button" data-pr="r-week">이번 주</button><button type="button" data-pr="r-last">지난주</button><button type="button" data-pr="r-month">이번 달</button><button type="button" data-pr="r-lmonth">지난달</button></div>' +
      (b.src === 'notes' ? '<div class="nbpr-row"><select class="mw-input nbpr-in" data-b="folderId"><option value="">📁 모든 폴더</option>' + folders.map(function (f) { return '<option value="' + _nbE(f.id) + '"' + (b.folderId === f.id ? ' selected' : '') + '>' + _nbE(f.name) + '</option>'; }).join('') + '</select>' +
        '<select class="mw-input nbpr-in" data-b="tag"><option value="">🏷 모든 태그</option>' + tags.map(function (t) { return '<option value="' + _nbE(t.tag) + '"' + (b.tag === t.tag ? ' selected' : '') + '>#' + _nbE(t.tag) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="nbpr-msg" id="nbprBMsg">' + _nbE(b.loading ? '불러오는 중…' : b.msg || '') + '</div>' +
      '<div class="nbpr-ckrow">' + _nbprChk('perPage', '한 건씩 새 쪽', '끄면 이어 붙여 종이를 아낍니다') + _nbprChk('toc', '표지 · 목차') + '</div></div>';
  }
  var det = NBPR.last && NBPR.last.forms && NBPR.last.forms[0] && o.form === 'auto' && NBPR.mode === 'one' ? ' <small>→ ' + _nbE(NbPrint.FORMS[NBPR.last.forms[0]]) + '</small>' : '';
  h += '<div class="nbpr-g"><div class="nbpr-gt">📄 양식' + det + '</div>' + _nbprSeg('form', NbPrint.FORMS, o.form) + '</div>';
  h += '<div class="nbpr-g"><div class="nbpr-gt">🎨 모양</div>' + _nbprSeg('theme', { basic: '기본', formal: '공문', clean: '간결' }, o.theme) +
    (o.theme === 'formal' ? '' : '<div class="nbpr-dots">' + Object.keys(NbPrint.ACCENTS).map(function (k) { return '<button type="button" data-o="accent" data-v="' + k + '" class="' + (o.accent === k ? 'on' : '') + '" style="background:' + NbPrint.ACCENTS[k] + '" title="' + k + '" aria-label="색 ' + k + '"></button>'; }).join('') + '</div>') + '</div>';
  h += '<div class="nbpr-g"><div class="nbpr-gt">🏢 머리글 ' + (ps.canEdit ? '<button type="button" class="nbpr-link" data-pr="ps">✎ 회사 머리글 설정</button>' : '') + '</div>' +
    _nbprChk('header', (o.company || o.logo ? _nbE(o.company || '로고') : '회사 이름 없음') + ' 머리글', ps.canEdit ? '' : '회사 이름 · 로고는 관리자가 정합니다') +
    '<div class="nbpr-row"><input type="text" class="mw-input nbpr-in" data-o="writer" placeholder="작성자" value="' + _nbE(o.writer) + '" maxlength="40"><input type="text" class="mw-input nbpr-in" data-o="dept" placeholder="부서" value="' + _nbE(o.dept) + '" maxlength="40"></div></div>';
  var signCustom = o.sign && !NbPrint.SIGNS.hasOwnProperty(o.sign);
  h += '<div class="nbpr-g"><div class="nbpr-gt">✍️ 결재란</div><select class="mw-input nbpr-in" data-o="sign-pick">' +
    Object.keys(NbPrint.SIGNS).map(function (k) { return '<option value="' + _nbE(k) + '"' + (!signCustom && o.sign === k ? ' selected' : '') + '>' + _nbE(NbPrint.SIGNS[k]) + '</option>'; }).join('') +
    '<option value="*"' + (signCustom ? ' selected' : '') + '>직접 적기…</option></select>' +
    (signCustom ? '<input type="text" class="mw-input nbpr-in" data-o="sign" value="' + _nbE(o.sign) + '" placeholder="쉼표로: 담당,과장,부장" maxlength="60">' : '') + '</div>';
  h += '<div class="nbpr-g"><div class="nbpr-gt">📐 종이</div>' + _nbprSeg('landscape', { 'false': '세로', 'true': '가로' }, o.landscape) + _nbprSeg('size', { s: '글자 작게', m: '보통', l: '크게' }, o.size) + _nbprSeg('margin', { narrow: '여백 좁게', normal: '보통', wide: '넓게' }, o.margin) +
    '<div class="nbpr-ckrow">' + _nbprChk('docNo', '문서 번호') + _nbprChk('pageNo', '쪽 번호') + _nbprChk('ink', '손글씨 · 사진') + '</div></div>';
  document.getElementById('nbprSide').innerHTML = h;
  _nbprMeetBtn();
}
function _nbprMeetBtn() {
  var box = document.getElementById('nbprMeet'); if (!box) return;
  var ok = NBPR.mode === 'one' && NB.cur && !NB.cur.readOnly && !NB.cur.deletedAt && NBPR.last && NBPR.last.forms[0] === 'meeting';
  box.innerHTML = ok ? '<button class="nb-btn" data-pr="meet" title="안건 · 결정 · 할 일을 프로젝트 › 회의에 회의록으로 등록 (할 일은 액션 아이템으로)">🤝 프로젝트 회의로 올리기</button>' : '';
}
function _nbprClick(e) {
  var x = e.target.closest('[data-pr],[data-o][data-v]'); if (!x) return;
  if (x.hasAttribute('data-v')) {
    var k = x.getAttribute('data-o'), v = x.getAttribute('data-v');
    if (k === 'b-src') { NBPR.bundle.src = v; _nbprDrawSide(); _nbprLoadBundle(); return; }
    NBPR.o[k] = v === 'true' ? true : v === 'false' ? false : v;
    _nbprSaveOpts(); _nbprDrawSide(); _nbprRender(); return;
  }
  var a = x.getAttribute('data-pr');
  if (a === 'print') _nbprPrint();
  else if (a === 'doc') _nbprWord();
  else if (a === 'copy') _nbprCopy();
  else if (a === 'meet') _nbprToMeeting();
  else if (a === 'ps') _nbprPsEdit();
  else if (/^r-/.test(a)) _nbprRange(a.slice(2));
}
function _nbprChange(e) {
  var t = e.target;
  if (t.hasAttribute('data-b')) { NBPR.bundle[t.getAttribute('data-b')] = t.value; _nbprLoadBundle(); return; }
  var k = t.getAttribute('data-o'); if (!k) return;
  if (k === 'sign-pick') { NBPR.o.sign = t.value === '*' ? '담당,과장,부장' : t.value; _nbprSaveOpts(); _nbprDrawSide(); _nbprRender(); return; }
  NBPR.o[k] = t.type === 'checkbox' ? t.checked : t.value;
  _nbprSaveOpts();
  if (t.type === 'checkbox') _nbprDrawSide();
  _nbprRender(t.type === 'text' ? 250 : 0);
}
function _nbprRange(k) {
  var t = _nbToday(), d = new Date(t + 'T00:00:00Z'), day = 86400000, iso = function (x) { return new Date(x).toISOString().slice(0, 10); };
  var mon = d.getTime() - ((d.getUTCDay() + 6) % 7) * day, b = NBPR.bundle;
  if (k === '7') { b.from = iso(d.getTime() - 6 * day); b.to = t; }
  else if (k === 'week') { b.from = iso(mon); b.to = t; }
  else if (k === 'last') { b.from = iso(mon - 7 * day); b.to = iso(mon - day); }
  else if (k === 'month') { b.from = t.slice(0, 8) + '01'; b.to = t; }
  else if (k === 'lmonth') { var f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); b.from = iso(f); b.to = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)); }
  _nbprDrawSide(); _nbprLoadBundle();
}
function _nbprLoadBundle() {
  var b = NBPR.bundle; if (!b) return;
  b.loading = true; var m = document.getElementById('nbprBMsg'); if (m) m.textContent = '불러오는 중…';
  var seq = (NBPR.bseq = (NBPR.bseq || 0) + 1);
  var q = '?src=' + b.src + '&from=' + b.from + '&to=' + b.to + (b.src === 'notes' && b.folderId ? '&folderId=' + encodeURIComponent(b.folderId) : '') + (b.src === 'notes' && b.tag ? '&tag=' + encodeURIComponent(b.tag) : '');
  apiFetch('/api/notebook/bundle' + q).then(function (r) {
    if (seq !== NBPR.bseq) return;
    NBPR.items = r.data || []; b.loading = false;
    b.msg = NBPR.items.length ? NBPR.items.length + '건' + (NBPR.items.length >= 62 ? ' (62건까지만 — 기간을 줄여 주세요)' : '') : '이 기간에 ' + (b.src === 'daily' ? '일일 노트가' : '노트가') + ' 없습니다';
    var mm = document.getElementById('nbprBMsg'); if (mm) mm.textContent = b.msg;
    _nbprRender();
  }).catch(function (e) { b.loading = false; b.msg = '❌ ' + _nbErr(e); var mm = document.getElementById('nbprBMsg'); if (mm) mm.textContent = b.msg; });
}

/* ═══ 그리기 ═══ */
function _nbprRender(delay) {
  clearTimeout(NBPR.timer);
  NBPR.timer = setTimeout(function () {
    if (!document.getElementById('nbprFrame')) return;
    if (!NBPR.items.length) { NBPR.last = { inner: '', forms: [], title: '' }; _nbprPaint('<div style="color:#94a3b8;text-align:center;padding:80px 0;font:14px sans-serif">출력할 내용이 없습니다</div>'); return; }
    var res = NbPrint.build(NBPR.items, NBPR.o);
    var prevForm = NBPR.last && NBPR.last.forms && NBPR.last.forms[0];
    NBPR.last = res;
    if (NBPR.mode === 'one' && NBPR.o.form === 'auto' && prevForm !== res.forms[0]) _nbprDrawSide(); else _nbprMeetBtn();
    _nbprImgs(res.inner).then(function (inner) { res.innerResolved = inner; _nbprPaint(inner); });
  }, delay || 0);
}
/** 첨부 사진(인증 필요)을 data URL 로 — 인쇄 창 · Word 에서도 보이게 */
function _nbprImgs(inner) {
  var ids = []; inner.replace(/data-nbf="([^"]+)"/g, function (_, id) { if (ids.indexOf(id) < 0) ids.push(id); });
  return Promise.all(ids.map(function (id) {
    if (NBPR.img[id]) return null;
    return _nbBlob(id).then(function (u) { return fetch(u); }).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { NBPR.img[id] = fr.result; res(); }; fr.onerror = function () { res(); }; fr.readAsDataURL(b); });
    }).catch(function () { NBPR.img[id] = ''; });
  })).then(function () {
    return inner.replace(/<img class="nb-img"([^>]*?) data-nbf="([^"]+)"/g, function (m, pre, id) { return NBPR.img[id] ? '<img class="nb-img"' + pre + ' src="' + NBPR.img[id] + '"' : '<span style="color:#94a3b8">[사진]</span><img hidden' + pre; });
  });
}
function _nbprPaint(inner) {
  var o = NBPR.o;
  wmPaperPaint({ frame: document.getElementById('nbprFrame'), wrap: document.getElementById('nbprWrap'), paper: document.getElementById('nbprPaper'), scroller: document.getElementById('nbprPv'), o: o,
    html: NbPrint.page(inner, o, NBPR.last ? NBPR.last.title : '', NBPR.last ? NBPR.last.docNo : ''), title: NBPR.last ? NBPR.last.title : '', docNo: NBPR.last ? NBPR.last.docNo : '',
    onPages: function (n) { NBPR.pages = n; var pg = document.getElementById('nbprPages'); if (pg) pg.textContent = wmPaperHint(n, o); } });
}

/* ═══ 내보내기 ═══ */
function _nbprReady() {
  var r = NBPR.last;
  if (!r || !r.inner) { _nbToast('출력할 내용이 없습니다', 'warn'); return null; }
  return r;
}
function _nbprFile(ext) { var r = NBPR.last; return String(r.title || '노트').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.' + ext; }
function _nbprPrint() {
  var r = _nbprReady(); if (!r) return;
  var fr = document.getElementById('nbprFrame');
  if (fr && fr.contentWindow) { fr.contentWindow.focus(); fr.contentWindow.print(); }
}
function _nbprWord() {
  var r = _nbprReady(); if (!r) return;
  _nbprImgs(r.inner).then(function (inner) {
    _nbSaveBlob(new Blob(['﻿' + NbPrint.word(inner, NBPR.o, r.title)], { type: 'application/msword' }), _nbprFile('doc'));
    _nbToast('📝 Word 파일로 내려받았습니다');
  });
}
function _nbprCopy() {
  var r = _nbprReady(); if (!r) return;
  _nbprImgs(r.inner).then(function (inner) {
    var html = NbPrint.rich(inner, NBPR.o);
    return wmCopyHtml(html, NBPR.items.map(function (it) { return NbPrint.plainMd(it.body); }).join('\n\n────────\n\n')).then(function (ok) {
      _nbToast(ok ? '📋 서식째 복사했습니다 — 메일 · 메신저에 붙여 넣으세요' : '❌ 복사하지 못했습니다', ok ? undefined : 'error');
    });
  });
}
/** 노트 ⋯ › Word 내려받기 — 창 없이 기억한 설정 그대로 */
function nbPrintQuickWord() {
  if (!NB.cur && !NB.daily1) return;
  var o = wmPrintPrefs();
  return _nbprSettings().then(function (ps) {
    o.company = ps.company || ''; o.logo = ps.logo || '';
    var r = NbPrint.build([_nbprCurItem()], o);
    return _nbprImgs(r.inner).then(function (inner) {
      _nbSaveBlob(new Blob(['﻿' + NbPrint.word(inner, o, r.title)], { type: 'application/msword' }), String(r.title || '노트').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.doc');
      _nbToast('📝 Word 파일로 내려받았습니다 (' + NbPrint.FORMS[r.forms[0]] + ' 양식)');
    });
  });
}

/* ═══ 🏢 회사 머리글 (관리자) ═══ */
function _nbprPsEdit() {
  var ps = NBPR.ps || {};
  return wmGuardedModal('nbPrintPs', function () {
    var logo = ps.logo || '';
    var md = createModal({ id: 'nbPrintPsModal', titleText: '🏢 회사 머리글', width: '460px', closeOnEsc: true,
      html: '<div class="nb-hint">모든 사람의 출력물 맨 위에 붙습니다. (관리자만 바꿀 수 있음)</div>' +
        '<label class="nb-fl">회사 이름<input class="mw-input nb-in" id="nbPsC" maxlength="120" value="' + _nbE(ps.company || '') + '" placeholder="예: (주)애니모션"></label>' +
        '<div class="nb-fl">로고 <small>PNG · JPG — 가로로 긴 그림이 잘 어울립니다</small></div>' +
        '<div class="nbpr-logo" id="nbPsL">' + (logo ? '<img src="' + _nbE(logo) + '" alt="로고">' : '<span>로고 없음</span>') + '</div>' +
        '<div class="nbpr-row"><label class="nb-btn" style="cursor:pointer">🖼 그림 고르기<input type="file" id="nbPsF" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><button class="nb-btn" data-x="rm">로고 지우기</button></div>' +
        '<div class="nb-mfoot"><button class="nb-btn" data-x="cancel">취소</button><button class="nb-btn pri" data-x="ok">저장</button></div>' });
    md.box.querySelector('#nbPsF').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { _nbToast('5MB 이하 그림을 골라 주세요', 'warn'); return; }
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        // 높이 120px · 너비 600px 안으로 줄여 PNG — 출력물에는 30px 높이로 들어감
        var k = Math.min(1, 120 / img.height, 600 / img.width), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        logo = c.toDataURL('image/png'); URL.revokeObjectURL(url);
        if (logo.length > 400000) { logo = c.toDataURL('image/jpeg', .85); }
        md.box.querySelector('#nbPsL').innerHTML = '<img src="' + logo + '" alt="로고">';
      };
      img.onerror = function () { _nbToast('그림을 읽지 못했습니다', 'error'); };
      img.src = url;
    });
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      var a = x.getAttribute('data-x');
      if (a === 'cancel') return md.close();
      if (a === 'rm') { logo = ''; md.box.querySelector('#nbPsL').innerHTML = '<span>로고 없음</span>'; return; }
      x.disabled = true;
      apiFetch('/api/notebook/print-settings', { method: 'PUT', body: JSON.stringify({ company: md.box.querySelector('#nbPsC').value, logo: logo }) }).then(function (r) {
        NBPR.ps = r.data; NBPR.o.company = r.data.company || ''; NBPR.o.logo = r.data.logo || ''; NBPR.o.header = true;
        md.close(); _nbprDrawSide(); _nbprRender();
        _nbToast('🏢 회사 머리글을 저장했습니다');
      }).catch(function (e2) { x.disabled = false; _nbToast('❌ ' + _nbErr(e2), 'error'); });
    });
  }, 'nbPrintPsModal', { onOpen: function () { var i = document.getElementById('nbPsC'); if (i) i.focus(); } });
}

/* ═══ 🤝 회의록 노트 → 프로젝트 회의 ═══ */
function _nbprToMeeting() {
  var it = NBPR.items[0]; if (!it || !NB.cur) return;
  var p = NbPrint.parseMeeting(it.body, it.title, it.date);
  var pre = nbpLinkedProjects(it.body);
  return wmGuardedModal('nbPrintMeet', function () {
    var md = createModal({ id: 'nbPrintMeetModal', titleText: '🤝 프로젝트 회의로 올리기', width: '500px', closeOnEsc: true,
      html: '<div class="nb-hint">이 회의록을 프로젝트 › 회의에 등록합니다. 할 일은 <b>액션 아이템</b>으로, 날짜가 있으면 캘린더 일정도 생깁니다.</div>' +
        '<div class="nbpr-sum"><b>' + _nbE(p.title) + '</b><br>' + _nbE([p.when.date || '날짜 없음', p.fields.place, p.att.length ? '참석 ' + p.att.length + '명' : ''].filter(Boolean).join(' · ')) +
          '<br>안건 ' + p.agenda.length + ' · 결정 ' + (p.decide ? '있음' : '없음') + ' · 할 일 ' + p.todos.length + '</div>' +
        nbpProjPickHtml(pre) +
        '<div class="nb-mfoot"><button class="nb-btn" data-x="cancel">취소</button><button class="nb-btn pri" data-x="ok">회의 만들기</button></div>' });
    var pick = nbpProjPick(md.box, pre);
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.getAttribute('data-x') === 'cancel') return md.close();
      var pid = pick.get();
      if (!pid) { _nbToast('프로젝트를 골라 주세요', 'warn'); return; }
      x.disabled = true; x.textContent = '만드는 중…';
      var nextMd = p.next || '', nw = NbPrint.parseWhen(nextMd, p.when.date || it.date);
      var body = { projectId: pid, title: p.title, meetDate: p.when.date || null, attendees: p.att,
        agenda: p.agenda.map(function (a) { return { text: a.text.replace(/[*_`]/g, ''), done: !!a.done, note: '', result: '' }; }),
        minutes: [p.discuss, p.others.map(function (o) { return '■ ' + o.head + '\n' + o.md; }).join('\n\n')].filter(Boolean).join('\n\n') || null,
        form: { timeStart: p.when.start || '', timeEnd: p.when.end || '', place: p.fields.place || '', writer: p.fields.writer || NBPR.o.writer || '', purpose: p.fields.purpose || '',
          decisions: p.decide || '', nextDate: nw.date || '', nextNote: nextMd.replace(/^\s*[-*]\s+/gm, '').trim() } };
      apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
        var mid = r.data.id, fails = 0;
        // 액션 아이템은 차례로 (순서 유지)
        return p.todos.reduce(function (pr, t, i) {
          return pr.then(function () {
            return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions', { method: 'POST', body: JSON.stringify({ title: t.title.replace(/[*_`]/g, '').slice(0, 300), assigneeName: t.who || null, dueDate: NbPrint.parseWhen(t.due, p.when.date || it.date).date, sortOrder: i }) })
              .catch(function () { fails++; });
          });
        }, Promise.resolve()).then(function () { return { mid: mid, fails: fails }; });
      }).then(function (res) {
        md.close();
        var s = document.getElementById('nbSrc');
        if (s && NB.cur && NBPR.items[0] && NB.cur.id === NBPR.items[0].id) {
          s.value = s.value.replace(/\s+$/, '') + '\n\n[🤝 프로젝트 회의록](wm:meeting:' + res.mid + ')\n';
          _nbChanged('body'); _nbRenderPrev(); _nbFoot();
        }
        _nbToast('🤝 프로젝트 회의로 올렸습니다' + (p.todos.length ? ' — 액션 아이템 ' + (p.todos.length - res.fails) + '개' : '') + (res.fails ? ' (' + res.fails + '개 실패)' : ''), res.fails ? 'warn' : undefined);
      }).catch(function (e2) { x.disabled = false; x.textContent = '회의 만들기'; _nbToast('❌ ' + _nbErr(e2), 'error'); });
    });
  }, 'nbPrintMeetModal', { onOpen: function () { var i = document.querySelector('#nbPrintMeetModal [data-pp="q"]'); if (i && !pre.length) i.focus(); } });
}
