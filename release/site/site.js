/* 업무 관리자 소개 · 매뉴얼 공용 — 최신 PC 앱 주소(GitHub 릴리스) · 그림 크게 보기 */
(function () {
  var REL = 'https://api.github.com/repos/JONGMIN-PARK/work_manager/releases/latest';
  function mb(n) { return (n / 1048576).toFixed(0) + 'MB'; }
  fetch(REL, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.assets) return;
    var exe = j.assets.filter(function (a) { return /\.exe$/i.test(a.name); })[0];
    if (!exe) return;
    var ver = (exe.name.match(/(\d+\.\d+\.\d+)/) || [])[1] || j.tag_name;
    document.querySelectorAll('.dl-pc').forEach(function (a) { a.href = exe.browser_download_url; });
    document.querySelectorAll('.dl-sub').forEach(function (s) { s.textContent = 'v' + ver + ' · Windows · ' + mb(exe.size); });
    var v = document.getElementById('verLine');
    if (v) v.innerHTML = 'PC 앱 최신 v' + ver + ' (' + (j.published_at || '').slice(0, 10) + ') · <a href="' + j.html_url + '">릴리스 노트</a>';
  }).catch(function () {});
  var z = document.getElementById('zoom'); if (!z) return;
  var zi = z.querySelector('img');
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.tagName === 'IMG' && t.closest('.shot')) { zi.src = t.src; zi.alt = t.alt; z.classList.add('on'); }
    else if (z.classList.contains('on')) z.classList.remove('on');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') z.classList.remove('on'); });
})();
