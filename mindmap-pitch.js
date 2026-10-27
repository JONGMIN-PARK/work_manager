/* mindmap-pitch.js — 발표(피치) 모드 (v13.242)
 * 전체 화면에서 장면을 차례로: 1) 전체 개요 2) 주요 주제마다 그 가지를 화면 가득 확대. 지금 장면 밖 주제는 흐리게.
 * 키: → · Space · PageDown 다음 / ← · PageUp 이전 / Home · End / Esc 끝내기. 화면 아래 막대로도 넘김.
 * 맵 문서는 바꾸지 않는다(보기 전용 사용자도 발표 가능). 끝내면 원래 확대 · 위치로.
 */

/** 장면 목록 — [{ id(중심 = 전체), title }] (순수에 가까움 — 테스트용으로 따로) */
function mmPitchSlides(root) {
  var out = [{ id: root.id, title: String(root.text || '').split('\n')[0] || '개요', all: true }];
  (root.collapsed ? [] : (root.children || [])).forEach(function (c) {
    out.push({ id: c.id, title: String(c.text || '').split('\n')[0] || '(빈 주제)' });
  });
  return out;
}

function mmPitchStart() {
  if (!_mm.doc || _mm.pitch) return;
  if (_mm.outline || _mm.gantt) _mmSetView('map');
  var ed = _mmEl('mmEd');
  if (!ed) return;
  _mm.pitch = { idx: 0, slides: mmPitchSlides(_mmRoot()), saved: { zoom: _mm.zoom, panX: _mm.panX, panY: _mm.panY, zen: _mm.zen } };
  ed.classList.add('mm-pitch');
  document.body.classList.add('mm-zen-body');
  var hud = document.createElement('div');
  hud.className = 'mm-pitch-hud';
  hud.id = 'mmPitchHud';
  hud.innerHTML = '<button data-pitch="prev" title="이전 (←)">◀</button><span id="mmPitchInfo"></span><button data-pitch="next" title="다음 (→ · Space)">▶</button>' +
    '<button data-pitch="exit" class="mm-pitch-x" title="끝내기 (Esc)">✕</button>';
  _mmEl('mmCanvas').appendChild(hud);
  hud.onclick = function (e) {
    var b = e.target.closest('[data-pitch]');
    if (!b) return;
    var a = b.getAttribute('data-pitch');
    if (a === 'exit') mmPitchEnd(); else mmPitchGo(_mm.pitch.idx + (a === 'next' ? 1 : -1));
  };
  document.addEventListener('keydown', _mmPitchKey, true);
  if (ed.requestFullscreen && !document.fullscreenElement) ed.requestFullscreen().catch(function () { /* 막히면 창 안에서 */ });
  document.addEventListener('fullscreenchange', _mmPitchFsChange);
  // 도구 · 패널이 사라진 뒤 캔버스 크기로 맞춤
  setTimeout(function () { mmPitchGo(0); }, 60);
}

function _mmPitchFsChange() {
  // 전체 화면을 Esc 로 빠져나오면 발표도 끝냄
  if (_mm.pitch && !document.fullscreenElement && _mm.pitch.wasFs) mmPitchEnd();
  if (_mm.pitch && document.fullscreenElement) { _mm.pitch.wasFs = true; setTimeout(function () { if (_mm.pitch) mmPitchGo(_mm.pitch.idx); }, 60); }
}

function _mmPitchKey(e) {
  if (!_mm.pitch) return;
  var k = e.key, step = 0;
  if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') step = 1;
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') step = -1;
  else if (k === 'Home') { mmPitchGo(0); }
  else if (k === 'End') { mmPitchGo(_mm.pitch.slides.length - 1); }
  else if (k === 'Escape') { mmPitchEnd(); }
  else return;
  e.preventDefault();
  e.stopPropagation();
  if (step) mmPitchGo(_mm.pitch.idx + step);
}

function mmPitchGo(i) {
  var pt = _mm.pitch;
  if (!pt) return;
  pt.idx = Math.max(0, Math.min(pt.slides.length - 1, i));
  var sl = pt.slides[pt.idx];
  var lay = _mm.layout, cv = _mmEl('mmCanvas'), stage = _mmEl('mmStage');
  if (!lay || !cv || !stage) return;
  var root = _mmRoot();
  var f = mmFind(root, sl.id);
  var box = sl.all || !f ? lay.bounds : mmSubtreeBox(f.node, lay.pos, true);
  if (!box) box = lay.bounds;
  var pad = 60, cw = cv.clientWidth, ch = cv.clientHeight - 56;   // 아래 막대 자리
  var bw = box.maxX - box.minX + pad * 2, bh = box.maxY - box.minY + pad * 2;
  var z = Math.max(0.25, Math.min(2.2, Math.min(cw / bw, ch / bh)));
  _mm.zoom = z;
  _mm.panX = cw / 2 - ((box.minX + box.maxX) / 2) * z;
  _mm.panY = ch / 2 - ((box.minY + box.maxY) / 2) * z;
  stage.classList.add('mm-pitch-anim');
  _mmApplyTransform();
  // 장면 밖 주제는 흐리게 (DOM class 만 — 문서는 그대로)
  var keep = {};
  if (f && !sl.all) { mmWalk(f.node, function (n) { keep[n.id] = true; }); keep[root.id] = true; }
  stage.querySelectorAll('.mm-node').forEach(function (el) {
    el.classList.toggle('mm-pitch-off', !sl.all && !keep[el.getAttribute('data-id')]);
  });
  stage.querySelectorAll('#mmEdges [data-e]').forEach(function (el) {   // 그 주제로 들어가는 선 · 밑줄도
    el.classList.toggle('mm-pitch-off', !sl.all && !keep[el.getAttribute('data-e')]);
  });
  var info = _mmEl('mmPitchInfo');
  if (info) info.innerHTML = '<b>' + (pt.idx + 1) + ' / ' + pt.slides.length + '</b> ' + _mmEsc(sl.title);
}

function mmPitchEnd() {
  var pt = _mm.pitch;
  if (!pt) return;
  _mm.pitch = null;
  document.removeEventListener('keydown', _mmPitchKey, true);
  document.removeEventListener('fullscreenchange', _mmPitchFsChange);
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  var ed = _mmEl('mmEd');
  if (ed) ed.classList.remove('mm-pitch');
  if (!pt.saved.zen) document.body.classList.remove('mm-zen-body');
  var hud = _mmEl('mmPitchHud');
  if (hud) hud.remove();
  var stage = _mmEl('mmStage');
  if (stage) {
    stage.classList.remove('mm-pitch-anim');
    stage.querySelectorAll('.mm-pitch-off').forEach(function (el) { el.classList.remove('mm-pitch-off'); });
  }
  _mm.zoom = pt.saved.zoom; _mm.panX = pt.saved.panX; _mm.panY = pt.saved.panY;
  _mmApplyTransform();
  _mmFocusCanvas();
}
