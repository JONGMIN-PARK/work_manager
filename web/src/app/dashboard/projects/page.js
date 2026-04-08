'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var STATUS_MAP = {
  active: { label: '진행 중', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  completed: { label: '완료', color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
  delayed: { label: '지연', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  hold: { label: '보류', color: '#6B7280', bg: 'rgba(107,114,128,0.15)' },
};

var PHASES = [
  { key: 'order', label: '수주', icon: '📋' },
  { key: 'design', label: '설계', icon: '📐' },
  { key: 'manufacture', label: '제작', icon: '🔧' },
  { key: 'inspect', label: '검수', icon: '🔍' },
  { key: 'deliver', label: '납품', icon: '🚚' },
  { key: 'as', label: 'A/S', icon: '🛠️' },
];

var INITIAL_FORM = {
  name: '', order_no: '', start_date: '', end_date: '',
  status: 'active', current_phase: 'order', memo: '',
};

export default function ProjectsPage() {
  var [projects, setProjects] = useState([]);
  var [loading, setLoading] = useState(true);
  var [modalOpen, setModalOpen] = useState(false);
  var [editId, setEditId] = useState(null);
  var [form, setForm] = useState(INITIAL_FORM);
  var [expandedId, setExpandedId] = useState(null);

  useEffect(function () { loadProjects(); }, []);

  function loadProjects() {
    setLoading(true);
    apiFetch('/api/projects')
      .then(function (res) { setProjects(res.data || []); })
      .catch(function () { setProjects([]); })
      .finally(function () { setLoading(false); });
  }

  function openCreate() {
    setEditId(null);
    setForm(INITIAL_FORM);
    setModalOpen(true);
  }

  function openEdit(p) {
    setEditId(p.id);
    setForm({
      name: p.name || '',
      order_no: p.order_no || '',
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      status: p.status || 'active',
      current_phase: p.current_phase || 'order',
      memo: p.memo || '',
    });
    setModalOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    var url = editId ? '/api/projects/' + editId : '/api/projects';
    var method = editId ? 'PUT' : 'POST';
    apiFetch(url, { method: method, body: JSON.stringify(form) })
      .then(function () {
        setModalOpen(false);
        loadProjects();
      })
      .catch(function (err) { alert('저장 실패: ' + err.message); });
  }

  function handleDelete(id) {
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
    apiFetch('/api/projects/' + id, { method: 'DELETE' })
      .then(function () { loadProjects(); })
      .catch(function (err) { alert('삭제 실패: ' + err.message); });
  }

  function onField(key, val) {
    setForm(function (prev) {
      var next = { ...prev };
      next[key] = val;
      return next;
    });
  }

  // --- stats ---
  var totalCount = projects.length;
  var activeCount = projects.filter(function (p) { return p.status === 'active'; }).length;
  var completedCount = projects.filter(function (p) { return p.status === 'completed'; }).length;

  var STATS = [
    { label: '전체 프로젝트', value: totalCount, color: '#3B82F6' },
    { label: '진행 중', value: activeCount, color: '#F59E0B' },
    { label: '완료', value: completedCount, color: '#10B981' },
  ];

  // --- render ---
  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>{'📁 프로젝트 관리'}</h1>
        <button style={s.addBtn} onClick={openCreate}>{'➕ 새 프로젝트'}</button>
      </div>

      {/* Summary */}
      <div style={s.statGrid}>
        {STATS.map(function (st, i) {
          return (
            <div key={i} style={{ ...s.statCard, borderTop: '3px solid ' + st.color }}>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 4 }}>{st.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#E2E8F0' }}>{st.value}</div>
            </div>
          );
        })}
      </div>

      {/* Loading */}
      {loading && <div style={{ color: '#94A3B8', textAlign: 'center', padding: 40 }}>{'로딩 중...'}</div>}

      {/* Empty */}
      {!loading && projects.length === 0 && (
        <div style={{ color: '#64748B', textAlign: 'center', padding: 60, fontSize: 14 }}>
          {'등록된 프로젝트가 없습니다. 새 프로젝트를 추가하세요.'}
        </div>
      )}

      {/* Project cards */}
      {!loading && projects.length > 0 && (
        <div style={s.cardGrid}>
          {projects.map(function (p) {
            var st = STATUS_MAP[p.status] || STATUS_MAP.active;
            var progress = p.progress || 0;
            var expanded = expandedId === p.id;
            return (
              <div key={p.id} style={s.projectCard}>
                {/* Card header - clickable */}
                <div style={s.cardHeader} onClick={function () { setExpandedId(expanded ? null : p.id); }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.projectName}>{p.name}</div>
                    {p.order_no && <div style={s.orderNo}>{'수주번호: ' + p.order_no}</div>}
                  </div>
                  <span style={{ ...s.badge, color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                </div>

                {/* Progress bar */}
                <div style={s.progressWrap}>
                  <div style={s.progressBar}>
                    <div style={{ ...s.progressFill, width: progress + '%', backgroundColor: st.color }} />
                  </div>
                  <span style={s.progressText}>{progress + '%'}</span>
                </div>

                {/* Phase indicators */}
                <div style={s.phaseRow}>
                  {PHASES.map(function (ph) {
                    var active = p.current_phase === ph.key;
                    return (
                      <div key={ph.key} style={{ ...s.phaseItem, opacity: active ? 1 : 0.35 }}>
                        <span style={{ fontSize: 14 }}>{ph.icon}</span>
                        <span style={{ fontSize: 10, color: active ? '#E2E8F0' : '#64748B' }}>{ph.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Date range */}
                <div style={s.dateRow}>
                  <span style={s.dateText}>
                    {(p.start_date || '-') + ' ~ ' + (p.end_date || '-')}
                  </span>
                </div>

                {/* Expanded detail */}
                {expanded && (
                  <div style={s.detail}>
                    {p.memo && <div style={s.memo}>{p.memo}</div>}
                    {p.assignees && p.assignees.length > 0 && (
                      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>
                        {'담당: ' + p.assignees.join(', ')}
                      </div>
                    )}
                    <div style={s.actions}>
                      <button style={s.editBtn} onClick={function () { openEdit(p); }}>{'수정'}</button>
                      <button style={s.deleteBtn} onClick={function () { handleDelete(p.id); }}>{'삭제'}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={s.overlay} onClick={function () { setModalOpen(false); }}>
          <div style={s.modal} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={s.modalTitle}>{editId ? '프로젝트 수정' : '새 프로젝트'}</h2>
            <form onSubmit={handleSubmit}>
              <label style={s.label}>{'프로젝트명'}</label>
              <input style={s.input} value={form.name} required
                onChange={function (e) { onField('name', e.target.value); }} />

              <label style={s.label}>{'수주번호'}</label>
              <input style={s.input} value={form.order_no}
                onChange={function (e) { onField('order_no', e.target.value); }} />

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>{'시작일'}</label>
                  <input style={s.input} type="date" value={form.start_date}
                    onChange={function (e) { onField('start_date', e.target.value); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>{'종료일'}</label>
                  <input style={s.input} type="date" value={form.end_date}
                    onChange={function (e) { onField('end_date', e.target.value); }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>{'상태'}</label>
                  <select style={s.input} value={form.status}
                    onChange={function (e) { onField('status', e.target.value); }}>
                    <option value="active">{'진행 중'}</option>
                    <option value="completed">{'완료'}</option>
                    <option value="delayed">{'지연'}</option>
                    <option value="hold">{'보류'}</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>{'현재 단계'}</label>
                  <select style={s.input} value={form.current_phase}
                    onChange={function (e) { onField('current_phase', e.target.value); }}>
                    {PHASES.map(function (ph) {
                      return <option key={ph.key} value={ph.key}>{ph.icon + ' ' + ph.label}</option>;
                    })}
                  </select>
                </div>
              </div>

              <label style={s.label}>{'메모'}</label>
              <textarea style={{ ...s.input, minHeight: 72, resize: 'vertical' }} value={form.memo}
                onChange={function (e) { onField('memo', e.target.value); }} />

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" style={s.cancelBtn}
                  onClick={function () { setModalOpen(false); }}>{'취소'}</button>
                <button type="submit" style={s.submitBtn}>{editId ? '저장' : '생성'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──
var s = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  addBtn: {
    padding: '8px 18px', fontSize: 13, fontWeight: 600,
    backgroundColor: '#3B82F6', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  },
  statGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 14, marginBottom: 28,
  },
  statCard: {
    backgroundColor: '#141824', borderRadius: 12, padding: '18px 20px',
  },
  cardGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 16,
  },
  projectCard: {
    backgroundColor: '#141824', borderRadius: 12, padding: 18,
    border: '1px solid #2A2F45', transition: 'border-color 0.2s',
  },
  cardHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 10, cursor: 'pointer', marginBottom: 12,
  },
  projectName: { fontSize: 15, fontWeight: 600, color: '#E2E8F0', marginBottom: 2 },
  orderNo: { fontSize: 12, color: '#64748B' },
  badge: {
    fontSize: 11, fontWeight: 600, padding: '3px 10px',
    borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
  },
  progressWrap: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  progressBar: {
    flex: 1, height: 6, backgroundColor: '#1E2235', borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  progressText: { fontSize: 11, color: '#94A3B8', minWidth: 32, textAlign: 'right' },
  phaseRow: {
    display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap',
  },
  phaseItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    minWidth: 40,
  },
  dateRow: { marginBottom: 4 },
  dateText: { fontSize: 12, color: '#64748B' },
  detail: {
    marginTop: 12, paddingTop: 12, borderTop: '1px solid #2A2F45',
  },
  memo: { fontSize: 13, color: '#CBD5E1', marginBottom: 10, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 8 },
  editBtn: {
    padding: '6px 14px', fontSize: 12, backgroundColor: '#1E293B',
    color: '#93C5FD', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer',
  },
  deleteBtn: {
    padding: '6px 14px', fontSize: 12, backgroundColor: '#1E293B',
    color: '#FCA5A5', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer',
  },
  // Modal
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    backgroundColor: '#141824', borderRadius: 14, padding: 28,
    width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
    border: '1px solid #2A2F45',
  },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginTop: 0, marginBottom: 20 },
  label: {
    display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4, marginTop: 12,
  },
  input: {
    display: 'block', width: '100%', padding: '8px 12px', fontSize: 13,
    backgroundColor: '#0C0F1A', color: '#E2E8F0',
    border: '1px solid #2A2F45', borderRadius: 8, outline: 'none',
    boxSizing: 'border-box',
  },
  cancelBtn: {
    padding: '8px 18px', fontSize: 13, backgroundColor: 'transparent',
    color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 8, cursor: 'pointer',
  },
  submitBtn: {
    padding: '8px 22px', fontSize: 13, fontWeight: 600,
    backgroundColor: '#3B82F6', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  },
};
