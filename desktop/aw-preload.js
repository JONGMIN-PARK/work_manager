/**
 * 애니웍스 숨은 창 전용 (v13.512) — 사이트의 alert / confirm 을 화면에 띄우지 않고 문구만 모은다.
 * 모든 프레임 · 팝업에서 페이지 스크립트보다 먼저 실행된다. 노드 기능은 넘기지 않는다.
 */
(function () {
  try {
    var top_ = window;
    try { while (top_.parent && top_.parent !== top_ && top_.parent.document) top_ = top_.parent; } catch (_) {}
    if (!top_.__awDlg) top_.__awDlg = [];
    window.alert = function (m) { top_.__awDlg.push({ t: 'alert', m: String(m) }); };
    window.confirm = function (m) { top_.__awDlg.push({ t: 'confirm', m: String(m) }); return true; };
    window.print = function () {};
  } catch (_) {}
})();
