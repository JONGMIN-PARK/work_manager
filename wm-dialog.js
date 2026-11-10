/* wm-dialog.js — 테마를 따르는 확인 · 알림 · 입력 창 (v13.432)
 * 브라우저 기본 confirm() · alert() · prompt() 는 윈도우 기본 모양(win32)이라 화면 테마와 따로 놀았다.
 *
 *   wmConfirm(메시지, 옵션?) → Promise<true|false>
 *   wmPrompt(메시지, 기본값?, 옵션?) → Promise<문자열|null>   (취소 = null — 기본 prompt 와 같음)
 *   wmAlert(메시지, 옵션?) → Promise<void>
 *   옵션: { title, ok: '확인 글자', cancel: '취소 글자', danger: true|false(기본: 메시지로 추측), placeholder }
 *
 * 메시지는 기본 창처럼 \n 줄바꿈을 그대로 쓴다. 빈 줄(\n\n) 앞부분은 제목처럼 굵게.
 * 창이 열려 있을 때 또 부르면 차례로 띄운다. Enter = 확인 · Esc = 취소. 닫으면 원래 자리로 포커스를 돌려준다.
 * window.alert 는 이 창으로 바꿔 둔다(돌려받는 값이 없어 그대로 바꿔도 됨). confirm · prompt 는 값을 기다려야 해서
 * 부르는 곳을 `await wmConfirm(…)` 으로 바꿨다 — 새 코드도 기본 confirm 대신 이것을 쓴다.
 */
(function () {
  if (window.wmConfirm) return;
  var NATIVE = { alert: window.alert && window.alert.bind(window), confirm: window.confirm && window.confirm.bind(window), prompt: window.prompt && window.prompt.bind(window) };
  window.wmDialogNative = NATIVE;

  var CSS = '' +
    '.wmd-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(6,10,18,.46);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:wmdFade .14s ease-out}' +
    '.wmd{width:min(440px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:var(--bg-ps,var(--bg-p,#fff));color:var(--t1,#1a1e30);border:1px solid var(--bd2,var(--bd,#d0d4e0));border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.34),0 2px 8px rgba(0,0,0,.12);animation:wmdPop .16s cubic-bezier(.2,.9,.3,1.2);font-family:inherit}' +
    '.wmd-b{display:flex;gap:14px;padding:20px 20px 6px;overflow:auto;min-height:0}' +
    '.wmd-i{flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;background:var(--ac-bg,#e6ecff);color:var(--ac-t,var(--ac,#3b5bdb))}' +
    '.wmd.danger .wmd-i{background:var(--d-bg,rgba(217,59,59,.14));color:var(--d-t,#c92a2a)}' +
    '.wmd-c{flex:1;min-width:0;padding-top:2px}' +
    '.wmd-t{font-size:15px;font-weight:700;line-height:1.45;margin:0 0 4px;color:var(--t1,#1a1e30);white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}' +
    '.wmd-m{font-size:13.5px;line-height:1.6;color:var(--t2,#2a3048);white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}' +
    '.wmd-t+.wmd-m{color:var(--t3,#424862);font-size:13px}' +
    '.wmd-in{width:100%;margin-top:12px;padding:9px 11px;border-radius:8px;border:1px solid var(--bd2,var(--bd,#c8cde0));background:var(--bg-i,#f4f5fa);color:var(--t1,#1a1e30);font:inherit;font-size:14px;outline:none}' +
    '.wmd-in:focus{border-color:var(--ac,#3b5bdb);box-shadow:0 0 0 3px var(--ac-g,rgba(59,91,219,.18))}' +
    '.wmd-f{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px 18px}' +
    '.wmd-btn{min-width:76px;padding:8px 16px;border-radius:8px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid var(--bd2,var(--bd,#c8cde0));background:var(--bg-i,#f4f5fa);color:var(--t2,#2a3048);transition:filter .12s,background .12s}' +
    '.wmd-btn:hover{background:var(--bg-hv,#e8ebf5)}' +
    '.wmd-btn.ok{background:var(--ac,#3b5bdb);border-color:var(--ac,#3b5bdb);color:#fff}' +
    '.wmd-btn.ok:hover{filter:brightness(1.08);background:var(--ac,#3b5bdb)}' +
    '.wmd.danger .wmd-btn.ok{background:#D2343A;border-color:#D2343A;color:#fff}' +   // 테마마다 --d-bd 가 연분홍~짙은 빨강이라 흰 글자가 흐려져 고정
    '.wmd-btn:focus-visible{outline:2px solid var(--ac,#3b5bdb);outline-offset:2px}' +
    '@keyframes wmdFade{from{opacity:0}}@keyframes wmdPop{from{opacity:0;transform:translateY(6px) scale(.97)}}' +
    '@media (prefers-reduced-motion:reduce){.wmd-ov,.wmd{animation:none}}' +
    '@media (max-width:480px){.wmd-ov{align-items:flex-end;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}.wmd-f{flex-direction:column-reverse}.wmd-btn{width:100%;padding:11px 16px;font-size:15px}}';

  var DANGER_RE = /삭제|지울|지우|지웁|제거|해제|나가|내보낼|비울|초기화|되돌릴 수 없|완전히|폐기|끌까요|취소할까요/;
  var _queue = Promise.resolve();

  function ensureCss() {
    if (document.getElementById('wmdCss')) return;
    var st = document.createElement('style');
    st.id = 'wmdCss';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function split(msg) {
    var s = String(msg == null ? '' : msg).replace(/\r\n/g, '\n');
    var i = s.indexOf('\n\n');
    if (i > 0 && i < 140) return { title: s.slice(0, i).trim(), body: s.slice(i + 2).trim() };
    if (s.length <= 60 && s.indexOf('\n') < 0) return { title: s, body: '' };
    return { title: '', body: s };
  }

  function open(kind, msg, def, opts) {
    opts = opts || {};
    var run = function () {
      return new Promise(function (resolve) {
        // 아주 이른 시점 · 자동 시험(puppeteer 등 — 기존 시험이 기본 창을 눌러 진행)은 기본 창으로.
        // 시험에서 이 창을 보려면 window.__wmDialogUi = true
        if (!document.body || (navigator.webdriver && !window.__wmDialogUi)) {
          resolve(kind === 'confirm' ? NATIVE.confirm(msg) : kind === 'prompt' ? NATIVE.prompt(msg, def) : (NATIVE.alert(msg), undefined));
          return;
        }
        ensureCss();
        var parts = split(msg);
        if (opts.title) parts = { title: opts.title, body: String(msg == null ? '' : msg) };
        var danger = opts.danger != null ? !!opts.danger : (kind === 'confirm' && DANGER_RE.test(String(msg)));
        var prevFocus = document.activeElement;
        var ov = document.createElement('div');
        ov.className = 'wmd-ov';
        var box = document.createElement('div');
        box.className = 'wmd' + (danger ? ' danger' : '');
        box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
        box.setAttribute('aria-modal', 'true');
        var icon = kind === 'prompt' ? '✎' : danger ? '!' : kind === 'alert' ? 'i' : '?';
        var b = document.createElement('div'); b.className = 'wmd-b';
        var ic = document.createElement('div'); ic.className = 'wmd-i'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = icon;
        var c = document.createElement('div'); c.className = 'wmd-c';
        if (parts.title) { var t = document.createElement('div'); t.className = 'wmd-t'; t.id = 'wmdT' + Date.now(); t.textContent = parts.title; c.appendChild(t); box.setAttribute('aria-labelledby', t.id); }
        if (parts.body) { var m = document.createElement('div'); m.className = 'wmd-m'; m.textContent = parts.body; c.appendChild(m); }
        var inp = null;
        if (kind === 'prompt') {
          inp = document.createElement('input');
          inp.className = 'wmd-in'; inp.type = 'text';
          inp.value = def == null ? '' : String(def);
          if (opts.placeholder) inp.placeholder = opts.placeholder;
          inp.setAttribute('aria-label', parts.title || parts.body || '입력');
          c.appendChild(inp);
        }
        b.appendChild(ic); b.appendChild(c);
        var f = document.createElement('div'); f.className = 'wmd-f';
        var cancel = null;
        if (kind !== 'alert') { cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'wmd-btn'; cancel.textContent = opts.cancel || '취소'; f.appendChild(cancel); }
        var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'wmd-btn ok'; ok.textContent = opts.ok || '확인';
        f.appendChild(ok);
        box.appendChild(b); box.appendChild(f); ov.appendChild(box);

        var done = false;
        function close(val) {
          if (done) return; done = true;
          document.removeEventListener('keydown', onKey, true);
          ov.remove();
          try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) {}
          resolve(val);
        }
        function yes() { close(kind === 'confirm' ? true : kind === 'prompt' ? inp.value : undefined); }
        function no() { close(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined); }
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); no(); return; }
          if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
            // 버튼에 포커스가 있으면 그 버튼, 아니면 확인
            if (document.activeElement === cancel) { e.preventDefault(); e.stopPropagation(); no(); return; }
            e.preventDefault(); e.stopPropagation(); yes(); return;
          }
          if (e.key === 'Tab') {   // 창 안에서만 돌기
            var els = [inp, cancel, ok].filter(Boolean), i = els.indexOf(document.activeElement);
            e.preventDefault();
            els[(i + (e.shiftKey ? els.length - 1 : 1)) % els.length].focus();
            return;
          }
          e.stopPropagation();   // 뒤 화면 단축키가 먹지 않게
        }
        ok.onclick = yes;
        if (cancel) cancel.onclick = no;
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) { e.preventDefault(); (inp || ok).focus(); } });   // 바깥 클릭으로는 닫지 않음(기본 창과 같음)
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        if (inp) { inp.focus(); inp.select(); } else ok.focus();
      });
    };
    var p = _queue.then(run, run);
    _queue = p.then(function () {}, function () {});
    return p;
  }

  window.wmConfirm = function (msg, opts) { return open('confirm', msg, null, opts); };
  window.wmPrompt = function (msg, def, opts) { return open('prompt', msg, def, opts); };
  window.wmAlert = function (msg, opts) { return open('alert', msg, null, opts); };
  // alert 는 돌려받는 값이 없으니 그대로 바꾼다 (기다리지 않음 — 뒤 코드는 바로 이어서 돈다)
  window.alert = function (msg) { if (navigator.webdriver && !window.__wmDialogUi) return NATIVE.alert(msg); window.wmAlert(msg); };
})();
