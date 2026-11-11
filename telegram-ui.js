/* telegram-ui.js — 텔레그램 연결 화면 (v13.304 · v13.305)
 *   pdTgGroupModal(projectId)  프로젝트 ⋯ → 💬 텔레그램 그룹방: 연결된 방 목록 · 해제 · 새로 연결 링크(봇을 그룹에 추가)
 *   wmDeepGo('issue:iss-1')    텔레그램 알림의 [🌐 웹에서 열기] → 로그인 뒤 그 항목 열기 (app-init.js 가 ?go= 를 넘김)
 */

function pdTgGroupModal(projectId) {
  return wmGuardedModal('tgGroup', function () {
    var m = createModal({ id: 'tgGroupModal', width: '520px', closeOnEsc: true, title: '💬 텔레그램 그룹방' });
    m.box.insertAdjacentHTML('beforeend',
      '<div class="tgg-intro">프로젝트 팀 단톡방에 봇을 넣으면 이 프로젝트 알림이 그 방으로 오고, 방에서 <code>/project</code> · <code>/issues</code> 로 보고, 사진 + 설명으로 이슈를 올릴 수 있습니다.</div>' +
      '<div id="tggList" class="tgg-list"><span class="mm-spin"></span> 불러오는 중…</div>' +
      '<div id="tggNew" class="tgg-new"></div>');
    _tggLoad(projectId);
  }, 'tgGroupModal');
}

function _tggLoad(projectId) {
  apiFetch('/api/telegram/groups?projectId=' + encodeURIComponent(projectId)).then(function (r) {
    var list = document.getElementById('tggList'), nw = document.getElementById('tggNew');
    if (!list) return;
    var rows = (r && r.data) || [];
    if (r && r.configured === false) {
      list.innerHTML = '<div class="tgg-empty">서버에 텔레그램 봇이 설정되어 있지 않습니다 (TELEGRAM_BOT_TOKEN).</div>';
      if (nw) nw.innerHTML = '';
      return;
    }
    list.innerHTML = rows.length
      ? '<div class="tgg-h">연결된 방 ' + rows.length + '</div>' + rows.map(function (g) {
          return '<div class="tgg-row"><span class="tgg-t">👥 ' + eH(g.title || '(이름 없는 그룹)') + '</span>' +
            '<span class="tgg-s">' + eH(g.linked_by_name || '') + (g.linked_at ? ' · ' + eH(String(g.linked_at).slice(0, 10)) : '') + '</span>' +
            (r.canEdit ? '<button class="btn btn-g btn-s" onclick="_tggUnlink(\'' + eA(projectId) + '\',' + (+g.id) + ')">해제</button>' : '') + '</div>';
        }).join('')
      : '<div class="tgg-empty">아직 연결된 그룹방이 없습니다.</div>';
    if (nw) nw.innerHTML = r.canEdit
      ? '<button class="btn btn-p" id="tggMake" onclick="_tggMake(\'' + eA(projectId) + '\')">🔗 그룹방 연결 링크 만들기</button>'
      : '<div class="tgg-empty">연결 · 해제는 프로젝트 참여자 · 관리자만 할 수 있습니다.</div>';
  }).catch(function (e) {
    var list = document.getElementById('tggList');
    if (list) list.innerHTML = '<div class="tgg-empty">⚠️ ' + eH((e && e.data && e.data.message) || (e && e.message) || '불러오지 못했습니다') + '</div>';
  });
}

function _tggMake(projectId) {
  var b = document.getElementById('tggMake'); if (b) b.disabled = true;
  apiFetch('/api/telegram/group-code', { method: 'POST', body: JSON.stringify({ projectId: projectId }) }).then(function (r) {
    var d = (r && r.data) || {};
    var nw = document.getElementById('tggNew'); if (!nw) return;
    nw.innerHTML =
      '<div class="tgg-h">새 그룹방 연결 <span class="tgg-s">30분 안에</span></div>' +
      '<ol class="tgg-steps">' +
        (d.link ? '<li><a class="btn btn-p btn-s" href="' + eA(d.link) + '" target="_blank" rel="noopener">텔레그램에서 그룹 고르기 ↗</a> — 봇이 고른 그룹에 들어가며 바로 연결됩니다.</li>'
                : '<li>봇을 그룹에 초대한 뒤 그룹에서 아래 명령을 보내세요.</li>') +
        '<li>링크가 안 되면 그룹에서: <code class="tgg-code">/linkgroup ' + eH(d.code || '') + '</code> <button class="btn btn-g btn-s" onclick="_tggCopy(\'/linkgroup ' + eA(d.code || '') + '\')">복사</button></li>' +
        '<li>사진으로 이슈를 올리려면 봇을 그 그룹의 <b>관리자</b>로 지정하세요 (텔레그램은 관리자가 아닌 봇에게 일반 사진을 보내지 않습니다).</li>' +
      '</ol>' +
      '<div class="tgg-s">명령은 봇과 계정을 연동한 사람만 쓸 수 있습니다. 연결 뒤 <button class="btn btn-g btn-s" onclick="_tggLoad(\'' + eA(projectId) + '\')">↻ 목록 새로고침</button></div>';
  }).catch(function (e) {
    if (b) b.disabled = false;
    if (typeof showToast === 'function') showToast('⚠️ ' + ((e && e.data && e.data.message) || (e && e.message) || '연결 코드를 만들지 못했습니다'), 'error');
  });
}

function _tggCopy(t) {
  try { navigator.clipboard.writeText(t); if (typeof showToast === 'function') showToast('복사했습니다', 'success'); }
  catch (_) { if (typeof showToast === 'function') showToast(t, 'info'); }
}

async function _tggUnlink(projectId, id) {
  if (!(await wmConfirm('이 그룹방의 프로젝트 연결을 해제할까요?'))) return;
  apiFetch('/api/telegram/groups/' + id, { method: 'DELETE' }).then(function () {
    if (typeof showToast === 'function') showToast('해제했습니다', 'success');
    _tggLoad(projectId);
  }).catch(function (e) {
    if (typeof showToast === 'function') showToast('⚠️ ' + ((e && e.data && e.data.message) || '해제하지 못했습니다'), 'error');
  });
}

/* ── 텔레그램 [🌐 웹에서 열기] ?go=종류:id ── */
var WM_GO_NAV = {
  issue: function (id) { return { nav: { issueId: id } }; },
  project: function (id) { return { nav: { projectId: id } }; },
  as: function (id) { return { nav: { asId: id } }; },
  message: function (id) { return { nav: { peerId: id } }; },
  todo: function (id) { return { nav: { todoId: id } }; }
};
function wmDeepGo(go) {
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {}
  var m = /^([a-z]+)(?::(.+))?$/.exec(String(go || ''));
  if (!m) return false;
  var type = m[1], id = m[2] || '';
  if (type === 'mywork') { if (typeof setPage === 'function') setPage('mywork'); return true; }
  if (type === 'messages') { if (typeof setPage === 'function') setPage('messages'); return true; }   // v13.355 앱 바로 가기 · PC 앱 트레이
  if (type === 'chat' && id && typeof wmChatWinFocus === 'function' && wmChatWinFocus(id)) return true;   // v13.447 그 방이 새 창으로 떠 있으면 그 창을 앞으로
  if (type === 'chat' && id && typeof chatOpenRoom === 'function') { chatOpenRoom(id); return true; }
  if (type === 'notice' && typeof wmNoticeOpen === 'function') { wmNoticeOpen(id); return true; }   // v13.444 📢 공지 알림을 눌렀을 때   // v13.315 메신저 대화방
  if (!WM_GO_NAV[type] || !id || typeof globalSearchNav !== 'function') return false;
  var it = WM_GO_NAV[type](id);
  it.title = ''; it.sub = '';
  globalSearchNav(type, it, '');
  return true;
}
