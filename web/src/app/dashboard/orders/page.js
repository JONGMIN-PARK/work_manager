'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

// 프로젝트 단계 — config.js 의 PROJ_PHASE 와 동일하게 유지 (수주대장의 "현재 단계"와 같은 표기)
var PHASE_MAP = {
  order: { label: '수주', icon: '📋', color: '#6366F1' },
  design: { label: '설계', icon: '📐', color: '#8B5CF6' },
  manufacture: { label: '제작', icon: '🏭', color: '#3B82F6' },
  inspect: { label: '검수', icon: '🔍', color: '#06B6D4' },
  deliver: { label: '납품', icon: '🚚', color: '#10B981' },
  as: { label: 'A/S', icon: '🛠️', color: '#F59E0B' },
};

// orders 테이블에는 status 컬럼이 없다. 예전에는 없는 필드를 폼에서 받아
// 저장되지 않은 채 항상 '진행 중'으로 표시했다 → 연결된 프로젝트의 단계로 대체.
var EMPTY_FORM = { order_no: '', name: '', date: '', client: '', amount: '', manager: '', delivery: '', memo: '' };

function fmtAmount(n) {
  if (!n && n !== 0) return '-';
  return Number(n).toLocaleString() + '원';
}

export default function OrdersPage() {
  var [orders, setOrders] = useState([]);
  var [projects, setProjects] = useState([]);
  var [loading, setLoading] = useState(true);
  var [modalOpen, setModalOpen] = useState(false);
  // 수주의 PK 는 order_no 다 (id 컬럼은 존재하지 않는다).
  // 예전에는 o.id(=undefined)를 편집 키로 써서 수정이 항상 신규 생성으로 흘렀고,
  // 삭제는 /api/orders/undefined 로 404 가 났다.
  var [editNo, setEditNo] = useState(null);
  var [editVersion, setEditVersion] = useState(null);
  var [form, setForm] = useState(EMPTY_FORM);
  var [search, setSearch] = useState('');
  var [saving, setSaving] = useState(false);

  // 수주번호 변경 모달
  var [renumberFor, setRenumberFor] = useState(null);   // { order_no, version }
  var [renumberTo, setRenumberTo] = useState('');
  var [renumberReason, setRenumberReason] = useState('');
  var [renumberRefs, setRenumberRefs] = useState(null);
  var [renumberHistory, setRenumberHistory] = useState(null);
  var [renumbering, setRenumbering] = useState(false);

  useEffect(function () { loadOrders(); }, []);

  function loadOrders() {
    setLoading(true);
    // 기본 limit 은 100 — 수주대장 전체를 받는다
    Promise.all([
      apiFetch('/api/orders?all=true&limit=2000').catch(function () { return { data: [] }; }),
      apiFetch('/api/projects?all=true&limit=2000').catch(function () { return { data: [] }; }),
    ])
      .then(function (res) {
        setOrders(res[0].data || []);
        setProjects(res[1].data || []);
      })
      .finally(function () { setLoading(false); });
  }

  // 수주번호 → 연결된 프로젝트
  var projByOrder = {};
  projects.forEach(function (p) {
    if (p.order_no && !projByOrder[p.order_no]) projByOrder[p.order_no] = p;
  });

  function openCreate() {
    setEditNo(null);
    setEditVersion(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }
  function openEdit(o) {
    setEditNo(o.order_no);
    setEditVersion(o.version);
    setForm({
      order_no: o.order_no || '', name: o.name || '', date: o.date || '',
      client: o.client || '', amount: o.amount || '', manager: o.manager || '',
      delivery: o.delivery || '', memo: o.memo || '',
    });
    setModalOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    var orderNo = (form.order_no || '').trim();
    if (!orderNo) { alert('수주번호를 입력하세요.'); return; }

    var url = editNo ? '/api/orders/' + encodeURIComponent(editNo) : '/api/orders';
    var method = editNo ? 'PUT' : 'POST';
    var body = { ...form, order_no: orderNo, amount: form.amount ? Number(form.amount) : 0 };
    // 번호 변경은 renumber 전용 API 로만 가능하다 (서버가 PUT 의 order_no 변경을 400 으로 거절한다)
    if (editNo) { body.order_no = editNo; body.version = editVersion; }

    setSaving(true);
    apiFetch(url, { method: method, body: JSON.stringify(body) })
      .then(function () {
        setModalOpen(false);
        loadOrders();
      })
      .catch(function (err) {
        if (err.status === 409) alert('다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.');
        else if (err.status === 403) alert('수주 편집 권한이 없습니다. 관리자에게 문의하세요.');
        else alert('저장 실패: ' + err.message);
      })
      .finally(function () { setSaving(false); });
  }

  function handleDelete(orderNo) {
    if (!orderNo) return;
    if (!confirm('수주 "' + orderNo + '" 를 삭제하시겠습니까?\n(연결된 프로젝트는 삭제되지 않습니다)')) return;
    apiFetch('/api/orders/' + encodeURIComponent(orderNo), { method: 'DELETE' })
      .then(function () { setModalOpen(false); loadOrders(); })
      .catch(function (err) { alert('삭제 실패: ' + err.message); });
  }

  function onField(key, val) {
    setForm(function (prev) { var n = { ...prev }; n[key] = val; return n; });
  }

  // ── 수주번호 변경 ──
  function openRenumber(o) {
    setRenumberFor({ order_no: o.order_no, version: o.version });
    setRenumberTo('');
    setRenumberReason('');
    setRenumberRefs(null);
    setRenumberHistory(null);
    var no = encodeURIComponent(o.order_no);
    apiFetch('/api/orders/' + no + '/references')
      .then(function (r) { setRenumberRefs(r.data); })
      .catch(function () { setRenumberRefs({ error: true }); });
    apiFetch('/api/orders/' + no + '/history')
      .then(function (r) { setRenumberHistory(r.data || []); })
      .catch(function () { setRenumberHistory([]); });
  }

  function submitRenumber(e) {
    e.preventDefault();
    if (renumbering || !renumberFor) return;
    var newNo = (renumberTo || '').trim();
    var reason = (renumberReason || '').trim();
    if (!newNo) { alert('새 수주번호를 입력하세요.'); return; }
    if (newNo === renumberFor.order_no) { alert('기존 수주번호와 동일합니다.'); return; }
    if (!/^[\w.\-\/가-힣]+$/.test(newNo)) { alert('수주번호에 공백·특수문자는 쓸 수 없습니다.'); return; }
    if (reason.length < 2) { alert('변경 사유를 2자 이상 입력하세요.'); return; }
    if (!confirm('수주번호를 "' + renumberFor.order_no + '" → "' + newNo + '" 로 변경합니다.\n연결된 프로젝트·이슈·업무일지·A/S·사전검토가 모두 새 번호로 갱신됩니다.\n\n계속하시겠습니까?')) return;

    setRenumbering(true);
    apiFetch('/api/orders/' + encodeURIComponent(renumberFor.order_no) + '/renumber', {
      method: 'POST',
      body: JSON.stringify({ newOrderNo: newNo, reason: reason, version: renumberFor.version }),
    })
      .then(function (r) {
        setRenumberFor(null);
        setModalOpen(false);
        loadOrders();
        alert(r.message || '수주번호를 변경했습니다.');
      })
      .catch(function (err) {
        if (err.status === 403) alert('수주 편집 권한이 없습니다. 관리자에게 문의하세요.');
        else alert('번호 변경 실패: ' + err.message);
      })
      .finally(function () { setRenumbering(false); });
  }

  // Filtering
  var filtered = orders.filter(function (o) {
    if (!search) return true;
    var q = search.toLowerCase();
    return (o.name || '').toLowerCase().indexOf(q) !== -1
      || (o.order_no || '').toLowerCase().indexOf(q) !== -1
      || (o.client || '').toLowerCase().indexOf(q) !== -1
      || (o.manager || '').toLowerCase().indexOf(q) !== -1;
  });

  // Stats
  var totalCount = orders.length;
  var linkedCount = orders.filter(function (o) { return !!projByOrder[o.order_no]; }).length;
  var totalAmount = orders.reduce(function (sum, o) { return sum + (Number(o.amount) || 0); }, 0);

  var STATS = [
    { label: '전체 수주', value: totalCount, color: '#8B5CF6' },
    { label: '프로젝트 연결', value: linkedCount, color: '#3B82F6' },
    { label: '미연결', value: totalCount - linkedCount, color: '#64748B' },
    { label: '총 수주액', value: fmtAmount(totalAmount), color: '#F59E0B' },
  ];

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>{'📦 수주 관리'}</h1>
        <button style={s.addBtn} onClick={openCreate}>{'➕ 새 수주'}</button>
      </div>

      {/* Stats */}
      <div style={s.statGrid}>
        {STATS.map(function (st, i) {
          return (
            <div key={i} style={{ ...s.statCard, borderTop: '3px solid ' + st.color }}>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 4 }}>{st.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#E2E8F0' }}>{st.value}</div>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input style={s.searchInput} placeholder="수주명, 수주번호, 거래처, 담당자 검색..."
          value={search} onChange={function (e) { setSearch(e.target.value); }} />
      </div>

      {/* Loading */}
      {loading && <div style={s.empty}>로딩 중...</div>}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div style={s.empty}>{search ? '검색 결과가 없습니다.' : '등록된 수주가 없습니다. 새 수주를 추가하세요.'}</div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2F45' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>수주번호</th>
                <th style={s.th}>수주명</th>
                <th style={s.th}>거래처</th>
                <th style={s.th}>수주액</th>
                <th style={s.th}>담당자</th>
                <th style={s.th}>납품예정</th>
                <th style={s.th}>현재 단계</th>
                <th style={s.th}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (o) {
                var proj = projByOrder[o.order_no];
                var ph = proj ? (PHASE_MAP[proj.current_phase] || null) : null;
                return (
                  <tr key={o.order_no}>
                    <td style={s.td}><span style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 12 }}>{o.order_no || '-'}</span></td>
                    <td style={s.td}><span style={{ fontWeight: 600, color: '#E2E8F0' }}>{o.name || '-'}</span></td>
                    <td style={s.td}>{o.client || '-'}</td>
                    <td style={s.td}><span style={{ color: '#F59E0B', fontWeight: 600 }}>{fmtAmount(o.amount)}</span></td>
                    <td style={s.td}>{o.manager || '-'}</td>
                    <td style={s.td}>{o.delivery || '-'}</td>
                    <td style={s.td}>
                      {ph ? (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, color: ph.color, backgroundColor: ph.color + '22' }}>{ph.icon + ' ' + ph.label}</span>
                      ) : proj ? (
                        <span style={{ fontSize: 11, color: '#94A3B8' }}>{proj.current_phase || '-'}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#64748B' }}>미연결</span>
                      )}
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={s.editBtn} onClick={function () { openEdit(o); }}>수정</button>
                        <button style={s.delBtn} onClick={function () { handleDelete(o.order_no); }}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={s.overlay} onClick={function () { setModalOpen(false); }}>
          <div style={s.modal} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={s.modalTitle}>{editNo ? '수주 수정' : '새 수주'}</h2>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>수주번호</label>
                  {editNo ? (
                    // 번호를 직접 타이핑해 바꾸면 옛 수주가 남은 채 새 수주가 하나 더 생긴다.
                    // 연결 레코드까지 함께 옮기는 전용 흐름으로 유도한다.
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input style={{ ...s.input, backgroundColor: '#161B2B', color: '#94A3B8' }} value={form.order_no} readOnly />
                      <button type="button" style={s.renumberBtn}
                        title="연결된 프로젝트·이슈·업무일지·A/S·사전검토까지 함께 바꿉니다"
                        onClick={function () { openRenumber({ order_no: editNo, version: editVersion }); }}>{'🔢 번호 변경'}</button>
                    </div>
                  ) : (
                    <input style={s.input} value={form.order_no} required
                      onChange={function (e) { onField('order_no', e.target.value); }} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>수주일</label>
                  <input style={s.input} type="date" value={form.date}
                    onChange={function (e) { onField('date', e.target.value); }} />
                </div>
              </div>

              <label style={s.label}>수주명</label>
              <input style={s.input} value={form.name} required
                onChange={function (e) { onField('name', e.target.value); }} />

              <label style={s.label}>거래처</label>
              <input style={s.input} value={form.client}
                onChange={function (e) { onField('client', e.target.value); }} />

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>수주액</label>
                  <input style={s.input} type="number" value={form.amount}
                    onChange={function (e) { onField('amount', e.target.value); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>담당자</label>
                  <input style={s.input} value={form.manager}
                    onChange={function (e) { onField('manager', e.target.value); }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>납품예정일</label>
                  <input style={s.input} type="date" value={form.delivery}
                    onChange={function (e) { onField('delivery', e.target.value); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>메모</label>
                  <input style={s.input} value={form.memo}
                    onChange={function (e) { onField('memo', e.target.value); }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" style={s.cancelBtn}
                  onClick={function () { setModalOpen(false); }}>취소</button>
                <button type="submit" style={s.submitBtn} disabled={saving}>{saving ? '저장 중...' : (editNo ? '저장' : '생성')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 수주번호 변경 모달 */}
      {renumberFor && (
        <div style={{ ...s.overlay, zIndex: 1100 }} onClick={function () { if (!renumbering) setRenumberFor(null); }}>
          <div style={s.modal} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={s.modalTitle}>{'🔢 수주번호 변경'}</h2>
            <form onSubmit={submitRenumber}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>현재 번호</label>
                  <input style={{ ...s.input, backgroundColor: '#161B2B', color: '#94A3B8' }} value={renumberFor.order_no} readOnly />
                </div>
                <div style={{ paddingBottom: 9, color: '#64748B' }}>{'→'}</div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>새 번호 *</label>
                  <input style={s.input} value={renumberTo} autoFocus placeholder="예: A25030"
                    onChange={function (e) { setRenumberTo(e.target.value); }} />
                </div>
              </div>

              <label style={s.label}>변경 사유 * <span style={{ color: '#64748B' }}>(감사 로그에 기록됩니다)</span></label>
              <textarea style={{ ...s.input, minHeight: 56, resize: 'vertical' }} value={renumberReason}
                placeholder="예: 고객사 발주번호 정정 요청"
                onChange={function (e) { setRenumberReason(e.target.value); }} />

              <div style={s.infoBox}>
                <div style={s.infoTitle}>함께 갱신되는 항목</div>
                {!renumberRefs && <div style={s.infoMuted}>확인 중...</div>}
                {renumberRefs && renumberRefs.error && <div style={s.infoMuted}>영향 범위를 불러오지 못했습니다.</div>}
                {renumberRefs && !renumberRefs.error && (
                  <div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                      {Object.keys(renumberRefs.counts || {}).map(function (k) {
                        var c = renumberRefs.counts[k];
                        var on = c.count > 0;
                        return (
                          <span key={k} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, border: '1px solid ' + (on ? '#3B82F6' : '#2A2F45'), color: on ? '#93C5FD' : '#64748B' }}>
                            {c.label + ' ' + c.count + '건'}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ ...s.infoMuted, marginTop: 6 }}>
                      총 <b style={{ color: '#93C5FD' }}>{renumberRefs.total + '건'}</b>이 새 번호로 함께 갱신됩니다.
                    </div>
                  </div>
                )}
              </div>

              <div style={s.infoBox}>
                <div style={s.infoTitle}>{'📜 번호 변경 이력'}</div>
                {!renumberHistory && <div style={s.infoMuted}>불러오는 중...</div>}
                {renumberHistory && renumberHistory.length === 0 && <div style={s.infoMuted}>변경 이력이 없습니다.</div>}
                {renumberHistory && renumberHistory.length > 0 && (
                  <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                    {renumberHistory.map(function (lg) {
                      var d = lg.detail || {};
                      return (
                        <div key={lg.id} style={{ display: 'flex', gap: 6, padding: '4px 0', borderBottom: '1px solid #1E2235', fontSize: 11 }}>
                          <span style={{ color: '#64748B', whiteSpace: 'nowrap' }}>{(lg.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                          <span style={{ color: '#CBD5E1', whiteSpace: 'nowrap' }}>{lg.user_name || lg.user_email || '알 수 없음'}</span>
                          <span style={{ color: '#94A3B8', whiteSpace: 'nowrap' }}>{(d.from || '?') + ' → ' + (d.to || '?')}</span>
                          <span style={{ color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.reason || ''}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" style={s.cancelBtn} disabled={renumbering}
                  onClick={function () { setRenumberFor(null); }}>취소</button>
                <button type="submit" style={s.submitBtn} disabled={renumbering}>{renumbering ? '변경 중...' : '번호 변경 적용'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

var s = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  addBtn: { padding: '8px 18px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 20 },
  statCard: { backgroundColor: '#141824', borderRadius: 12, padding: '18px 20px' },
  searchInput: { width: '100%', maxWidth: 400, padding: '10px 14px', fontSize: 13, backgroundColor: '#141824', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  empty: { textAlign: 'center', color: '#64748B', padding: 60, fontSize: 14 },
  table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#141824' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 12, color: '#64748B', borderBottom: '1px solid #2A2F45', fontWeight: 600 },
  td: { padding: '12px 16px', fontSize: 13, color: '#CBD5E1', borderBottom: '1px solid #1E2235' },
  editBtn: { padding: '4px 10px', fontSize: 11, backgroundColor: '#1E293B', color: '#93C5FD', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' },
  delBtn: { padding: '4px 10px', fontSize: 11, backgroundColor: '#1E293B', color: '#FCA5A5', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' },
  renumberBtn: { padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap', backgroundColor: '#1E293B', color: '#93C5FD', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: '#141824', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', border: '1px solid #2A2F45' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginTop: 0, marginBottom: 20 },
  label: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4, marginTop: 12 },
  input: { display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  infoBox: { backgroundColor: '#0C0F1A', border: '1px solid #2A2F45', borderRadius: 8, padding: 10, marginTop: 12 },
  infoTitle: { fontSize: 12, fontWeight: 600, color: '#CBD5E1' },
  infoMuted: { fontSize: 11, color: '#64748B', marginTop: 4 },
  cancelBtn: { padding: '8px 18px', fontSize: 13, backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 8, cursor: 'pointer' },
  submitBtn: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
};
