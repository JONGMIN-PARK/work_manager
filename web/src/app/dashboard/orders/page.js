'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var STATUS_MAP = {
  active: { label: '진행 중', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  delivered: { label: '납품 완료', color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
  delayed: { label: '지연', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
};

var EMPTY_FORM = { order_no: '', name: '', date: '', client: '', amount: '', manager: '', delivery: '', status: 'active' };

function fmtAmount(n) {
  if (!n && n !== 0) return '-';
  return Number(n).toLocaleString() + '원';
}

export default function OrdersPage() {
  var [orders, setOrders] = useState([]);
  var [loading, setLoading] = useState(true);
  var [modalOpen, setModalOpen] = useState(false);
  var [editId, setEditId] = useState(null);
  var [form, setForm] = useState(EMPTY_FORM);
  var [search, setSearch] = useState('');

  useEffect(function () { loadOrders(); }, []);

  function loadOrders() {
    setLoading(true);
    apiFetch('/api/orders')
      .then(function (res) { setOrders(res.data || []); })
      .catch(function () { setOrders([]); })
      .finally(function () { setLoading(false); });
  }

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }
  function openEdit(o) {
    setEditId(o.id);
    setForm({
      order_no: o.order_no || '', name: o.name || '', date: o.date || '',
      client: o.client || '', amount: o.amount || '', manager: o.manager || '',
      delivery: o.delivery || '', status: o.status || 'active',
    });
    setModalOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    var url = editId ? '/api/orders/' + editId : '/api/orders';
    var method = editId ? 'PUT' : 'POST';
    var body = { ...form, amount: form.amount ? Number(form.amount) : 0 };
    apiFetch(url, { method: method, body: JSON.stringify(body) })
      .then(function (res) {
        setModalOpen(false);
        if (editId && res.data) {
          setOrders(function (prev) {
            return prev.map(function (o) { return o.id === editId ? { ...o, ...res.data } : o; });
          });
        } else {
          loadOrders();
        }
      })
      .catch(function (err) { alert('저장 실패: ' + err.message); });
  }

  function handleDelete(id) {
    if (!confirm('이 수주를 삭제하시겠습니까?')) return;
    apiFetch('/api/orders/' + id, { method: 'DELETE' })
      .then(function () { setModalOpen(false); loadOrders(); })
      .catch(function (err) { alert('삭제 실패: ' + err.message); });
  }

  function onField(key, val) {
    setForm(function (prev) { var n = { ...prev }; n[key] = val; return n; });
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
  var activeCount = orders.filter(function (o) { return o.status === 'active'; }).length;
  var deliveredCount = orders.filter(function (o) { return o.status === 'delivered'; }).length;
  var totalAmount = orders.reduce(function (sum, o) { return sum + (Number(o.amount) || 0); }, 0);

  var STATS = [
    { label: '전체 수주', value: totalCount, color: '#8B5CF6' },
    { label: '진행 중', value: activeCount, color: '#3B82F6' },
    { label: '납품 완료', value: deliveredCount, color: '#10B981' },
    { label: '총 수주액', value: fmtAmount(totalAmount), color: '#F59E0B' },
  ];

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>{'\uD83D\uDCE6 수주 관리'}</h1>
        <button style={s.addBtn} onClick={openCreate}>{'\u2795 새 수주'}</button>
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
                <th style={s.th}>상태</th>
                <th style={s.th}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (o) {
                var st = STATUS_MAP[o.status] || STATUS_MAP.active;
                return (
                  <tr key={o.id}>
                    <td style={s.td}><span style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 12 }}>{o.order_no || '-'}</span></td>
                    <td style={s.td}><span style={{ fontWeight: 600, color: '#E2E8F0' }}>{o.name || '-'}</span></td>
                    <td style={s.td}>{o.client || '-'}</td>
                    <td style={s.td}><span style={{ color: '#F59E0B', fontWeight: 600 }}>{fmtAmount(o.amount)}</span></td>
                    <td style={s.td}>{o.manager || '-'}</td>
                    <td style={s.td}>{o.delivery || '-'}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={s.editBtn} onClick={function () { openEdit(o); }}>수정</button>
                        <button style={s.delBtn} onClick={function () { handleDelete(o.id); }}>삭제</button>
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
            <h2 style={s.modalTitle}>{editId ? '수주 수정' : '새 수주'}</h2>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>수주번호</label>
                  <input style={s.input} value={form.order_no}
                    onChange={function (e) { onField('order_no', e.target.value); }} />
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
                  <label style={s.label}>상태</label>
                  <select style={s.input} value={form.status}
                    onChange={function (e) { onField('status', e.target.value); }}>
                    <option value="active">진행 중</option>
                    <option value="delivered">납품 완료</option>
                    <option value="delayed">지연</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" style={s.cancelBtn}
                  onClick={function () { setModalOpen(false); }}>취소</button>
                <button type="submit" style={s.submitBtn}>{editId ? '저장' : '생성'}</button>
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
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: '#141824', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', border: '1px solid #2A2F45' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginTop: 0, marginBottom: 20 },
  label: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4, marginTop: 12 },
  input: { display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  cancelBtn: { padding: '8px 18px', fontSize: 13, backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 8, cursor: 'pointer' },
  submitBtn: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
};
