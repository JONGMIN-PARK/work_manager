'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var STATUSES = [
  { key: 'open', label: '열림', color: '#3B82F6' },
  { key: 'in_progress', label: '진행중', color: '#F59E0B' },
  { key: 'resolved', label: '완료', color: '#10B981' },
  { key: 'hold', label: '보류', color: '#64748B' },
];

var URGENCIES = [
  { key: 'critical', label: '긴급', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  { key: 'high', label: '높음', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  { key: 'normal', label: '보통', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  { key: 'low', label: '낮음', color: '#64748B', bg: 'rgba(100,116,139,0.15)' },
];

function urgencyOf(key) {
  return URGENCIES.find(function(u) { return u.key === key; }) || URGENCIES[2];
}
function statusOf(key) {
  return STATUSES.find(function(s) { return s.key === key; }) || STATUSES[0];
}
function fmtDate(d) {
  if (!d) return '-';
  var dt = new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

var EMPTY_FORM = { title: '', description: '', urgency: 'normal', status: 'open' };

var s = {
  page: { maxWidth: 1200 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center' },
  btn: { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnPrimary: { backgroundColor: '#3B82F6', color: '#fff' },
  btnToggle: function(active) {
    return { backgroundColor: active ? '#2A2F45' : 'transparent', color: active ? '#E2E8F0' : '#64748B', border: '1px solid #2A2F45' };
  },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 28 },
  statCard: { backgroundColor: '#141824', borderRadius: 10, padding: '14px 16px', borderTop: '3px solid', textAlign: 'center' },
  statValue: { fontSize: 26, fontWeight: 700, color: '#E2E8F0' },
  statLabel: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  boardWrap: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 },
  colHeader: { fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 },
  colCount: { fontSize: 12, color: '#64748B', fontWeight: 400 },
  column: { backgroundColor: '#0F1219', borderRadius: 10, padding: 12, minHeight: 200 },
  card: { backgroundColor: '#141824', borderRadius: 8, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', border: '1px solid #2A2F45', transition: 'border-color .15s' },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#E2E8F0', marginBottom: 6, wordBreak: 'break-word' },
  badge: function(u) { return { fontSize: 11, padding: '2px 8px', borderRadius: 10, color: u.color, backgroundColor: u.bg, fontWeight: 600, display: 'inline-block' }; },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: '#64748B' },
  table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#141824', borderRadius: 12, overflow: 'hidden' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 12, color: '#64748B', borderBottom: '1px solid #2A2F45', fontWeight: 600 },
  td: { padding: '12px 16px', fontSize: 13, color: '#CBD5E1', borderBottom: '1px solid #1E2235' },
  trHover: { cursor: 'pointer' },
  statusDot: function(c) { return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: c, marginRight: 6 }; },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: '#1A1F2E', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, border: '1px solid #2A2F45' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #2A2F45', backgroundColor: '#0F1219', color: '#E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #2A2F45', backgroundColor: '#0F1219', color: '#E2E8F0', fontSize: 13, outline: 'none', minHeight: 90, resize: 'vertical', boxSizing: 'border-box' },
  select: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #2A2F45', backgroundColor: '#0F1219', color: '#E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  fieldGroup: { marginBottom: 14 },
  detailRow: { display: 'flex', gap: 8, marginTop: 10 },
  detailBtn: { fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #2A2F45', backgroundColor: 'transparent', color: '#94A3B8', cursor: 'pointer' },
  empty: { textAlign: 'center', color: '#64748B', padding: 40, fontSize: 14 },
};

export default function IssuesPage() {
  var [issues, setIssues] = useState([]);
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState('board');
  var [modal, setModal] = useState(null); // null | 'create' | issue obj
  var [form, setForm] = useState(EMPTY_FORM);
  var [expandedId, setExpandedId] = useState(null);

  function loadIssues() {
    setLoading(true);
    apiFetch('/api/issues')
      .then(function(res) { setIssues(res.data || []); })
      .catch(function() { setIssues([]); })
      .finally(function() { setLoading(false); });
  }

  useEffect(function() { loadIssues(); }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setModal('create');
  }
  function openEdit(issue) {
    setForm({ title: issue.title || '', description: issue.description || '', urgency: issue.urgency || 'normal', status: issue.status || 'open' });
    setModal(issue);
  }
  function closeModal() { setModal(null); }

  function handleChange(field, val) {
    setForm(function(prev) { var n = { ...prev }; n[field] = val; return n; });
  }

  function handleSubmit() {
    if (!form.title.trim()) return;
    if (modal === 'create') {
      apiFetch('/api/issues', { method: 'POST', body: JSON.stringify(form) })
        .then(function() { closeModal(); loadIssues(); })
        .catch(function() {});
    } else {
      apiFetch('/api/issues/' + modal.id, { method: 'PUT', body: JSON.stringify(form) })
        .then(function() { closeModal(); loadIssues(); })
        .catch(function() {});
    }
  }

  function handleDelete(id) {
    if (!confirm('이 이슈를 삭제하시겠습니까?')) return;
    apiFetch('/api/issues/' + id, { method: 'DELETE' })
      .then(function() { closeModal(); loadIssues(); })
      .catch(function() {});
  }

  function changeStatus(issue, newStatus) {
    apiFetch('/api/issues/' + issue.id, { method: 'PUT', body: JSON.stringify({ status: newStatus }) })
      .then(function() { loadIssues(); })
      .catch(function() {});
  }

  // Stats
  var stats = [
    { label: '전체', value: issues.length, color: '#8B5CF6' },
    { label: '열림', value: issues.filter(function(x) { return x.status === 'open'; }).length, color: '#3B82F6' },
    { label: '진행중', value: issues.filter(function(x) { return x.status === 'in_progress'; }).length, color: '#F59E0B' },
    { label: '완료', value: issues.filter(function(x) { return x.status === 'resolved'; }).length, color: '#10B981' },
    { label: '긴급', value: issues.filter(function(x) { return x.urgency === 'critical'; }).length, color: '#EF4444' },
  ];

  // Board
  function renderBoard() {
    return (
      <div style={s.boardWrap}>
        {STATUSES.map(function(st) {
          var col = issues.filter(function(x) { return x.status === st.key; });
          return (
            <div key={st.key} style={s.column}>
              <div style={s.colHeader}>
                <span style={s.statusDot(st.color)} />
                <span style={{ color: st.color }}>{st.label}</span>
                <span style={s.colCount}>({col.length})</span>
              </div>
              {col.length === 0 && <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: 20 }}>이슈 없음</div>}
              {col.map(function(issue) {
                var u = urgencyOf(issue.urgency);
                return (
                  <div key={issue.id} style={s.card} onClick={function() { openEdit(issue); }}>
                    <div style={s.cardTitle}>{issue.title}</div>
                    <span style={s.badge(u)}>{u.label}</span>
                    <div style={s.cardFooter}>
                      <span>{issue.assignees || '-'}</span>
                      <span>{fmtDate(issue.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // List
  function renderList() {
    return (
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2F45' }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>제목</th>
              <th style={s.th}>상태</th>
              <th style={s.th}>긴급도</th>
              <th style={s.th}>담당자</th>
              <th style={s.th}>생성일</th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 && (
              <tr><td colSpan={5} style={s.empty}>등록된 이슈가 없습니다.</td></tr>
            )}
            {issues.map(function(issue) {
              var st = statusOf(issue.status);
              var u = urgencyOf(issue.urgency);
              var expanded = expandedId === issue.id;
              return (
                <tr key={issue.id} style={s.trHover}>
                  <td style={s.td}>
                    <div onClick={function() { setExpandedId(expanded ? null : issue.id); }} style={{ cursor: 'pointer' }}>
                      <span style={{ fontWeight: 600, color: '#E2E8F0' }}>{issue.title}</span>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8', lineHeight: 1.6 }}>
                        <div>{issue.description || '설명 없음'}</div>
                        <div style={s.detailRow}>
                          <button style={{ ...s.detailBtn, color: '#3B82F6', borderColor: '#3B82F6' }} onClick={function() { openEdit(issue); }}>수정</button>
                          <button style={{ ...s.detailBtn, color: '#EF4444', borderColor: '#EF4444' }} onClick={function() { handleDelete(issue.id); }}>삭제</button>
                          {STATUSES.filter(function(x) { return x.key !== issue.status; }).map(function(ns) {
                            return (
                              <button key={ns.key} style={{ ...s.detailBtn, color: ns.color, borderColor: ns.color }} onClick={function() { changeStatus(issue, ns.key); }}>
                                {ns.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={s.td}>
                    <span style={s.statusDot(st.color)} />
                    {st.label}
                  </td>
                  <td style={s.td}><span style={s.badge(u)}>{u.label}</span></td>
                  <td style={s.td}>{issue.assignees || '-'}</td>
                  <td style={s.td}>{fmtDate(issue.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Modal
  function renderModal() {
    if (!modal) return null;
    var isCreate = modal === 'create';
    return (
      <div style={s.overlay} onClick={closeModal}>
        <div style={s.modal} onClick={function(e) { e.stopPropagation(); }}>
          <div style={s.modalTitle}>{isCreate ? '새 이슈 만들기' : '이슈 수정'}</div>

          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>제목</label>
            <input style={s.input} value={form.title} placeholder="이슈 제목을 입력하세요"
              onChange={function(e) { handleChange('title', e.target.value); }} />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>설명</label>
            <textarea style={s.textarea} value={form.description} placeholder="이슈에 대한 상세 설명"
              onChange={function(e) { handleChange('description', e.target.value); }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={s.fieldGroup}>
              <label style={s.fieldLabel}>긴급도</label>
              <select style={s.select} value={form.urgency} onChange={function(e) { handleChange('urgency', e.target.value); }}>
                {URGENCIES.map(function(u) { return <option key={u.key} value={u.key}>{u.label}</option>; })}
              </select>
            </div>
            <div style={s.fieldGroup}>
              <label style={s.fieldLabel}>상태</label>
              <select style={s.select} value={form.status} onChange={function(e) { handleChange('status', e.target.value); }}>
                {STATUSES.map(function(st) { return <option key={st.key} value={st.key}>{st.label}</option>; })}
              </select>
            </div>
          </div>

          <div style={s.modalActions}>
            {!isCreate && (
              <button style={{ ...s.btn, backgroundColor: '#EF4444', color: '#fff', marginRight: 'auto' }}
                onClick={function() { handleDelete(modal.id); }}>삭제</button>
            )}
            <button style={{ ...s.btn, backgroundColor: '#2A2F45', color: '#94A3B8' }} onClick={closeModal}>취소</button>
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleSubmit}>
              {isCreate ? '생성' : '저장'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>{'\uD83C\uDFAB 이슈 트래커'}</h1>
        <div style={s.headerRight}>
          <button style={{ ...s.btn, ...s.btnToggle(view === 'board') }} onClick={function() { setView('board'); }}>보드</button>
          <button style={{ ...s.btn, ...s.btnToggle(view === 'list') }} onClick={function() { setView('list'); }}>목록</button>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={openCreate}>{'\u2795 새 이슈'}</button>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statsGrid}>
        {stats.map(function(st, i) {
          return (
            <div key={i} style={{ ...s.statCard, borderTopColor: st.color }}>
              <div style={s.statValue}>{st.value}</div>
              <div style={s.statLabel}>{st.label}</div>
            </div>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div style={s.empty}>로딩 중...</div>
      ) : view === 'board' ? renderBoard() : renderList()}

      {/* Modal */}
      {renderModal()}
    </div>
  );
}
