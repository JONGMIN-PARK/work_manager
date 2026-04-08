'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var DEFAULT_STATES = [
  { id: 'open', name: '열림', color: '#3B82F6' },
  { id: 'in_progress', name: '진행 중', color: '#F59E0B' },
  { id: 'review', name: '검토', color: '#8B5CF6' },
  { id: 'done', name: '완료', color: '#10B981' },
  { id: 'closed', name: '닫힘', color: '#64748B' },
];

export default function WorkflowsPage() {
  var [workflows, setWorkflows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [editing, setEditing] = useState(null);
  var [form, setForm] = useState({ name: '', entity_type: 'issue', is_default: false, states: DEFAULT_STATES, transitions: [] });
  var [newState, setNewState] = useState({ id: '', name: '', color: '#3B82F6' });
  var [newTransition, setNewTransition] = useState({ from: '', to: '' });
  var [msg, setMsg] = useState('');
  var [viewDetail, setViewDetail] = useState(null);

  useEffect(function () { fetchWorkflows(); }, []);

  function fetchWorkflows() {
    setLoading(true);
    apiFetch('/api/workflows')
      .then(function (r) { setWorkflows(r.data); })
      .catch(function () { })
      .finally(function () { setLoading(false); });
  }

  function handleSave(e) {
    e.preventDefault();
    var method = editing === 'new' ? 'POST' : 'PUT';
    var url = editing === 'new' ? '/api/workflows' : '/api/workflows/' + editing;
    apiFetch(url, { method: method, body: JSON.stringify(form) })
      .then(function () { setMsg('저장되었습니다.'); setEditing(null); fetchWorkflows(); })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function handleDelete(id) {
    if (!confirm('이 워크플로우를 삭제하시겠습니까?')) return;
    apiFetch('/api/workflows/' + id, { method: 'DELETE' })
      .then(function () { fetchWorkflows(); setMsg('삭제되었습니다.'); })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function addState() {
    if (!newState.id || !newState.name) return;
    if (form.states.find(function (s) { return s.id === newState.id; })) return;
    setForm({ ...form, states: [...form.states, { ...newState }] });
    setNewState({ id: '', name: '', color: '#3B82F6' });
  }

  function removeState(id) {
    setForm({
      ...form,
      states: form.states.filter(function (s) { return s.id !== id; }),
      transitions: form.transitions.filter(function (t) { return t.from !== id && t.to !== id; })
    });
  }

  function addTransition() {
    if (!newTransition.from || !newTransition.to) return;
    var exists = form.transitions.some(function (t) { return t.from === newTransition.from && t.to === newTransition.to; });
    if (exists) return;
    setForm({ ...form, transitions: [...form.transitions, { ...newTransition }] });
    setNewTransition({ from: '', to: '' });
  }

  function removeTransition(idx) {
    setForm({ ...form, transitions: form.transitions.filter(function (_, i) { return i !== idx; }) });
  }

  function startEdit(wf) {
    setForm({ name: wf.name, entity_type: wf.entity_type, is_default: wf.is_default, states: wf.states || [], transitions: wf.transitions || [] });
    setEditing(wf.id);
    setMsg('');
  }

  var stateOptions = [{ id: '*', name: '모든 상태' }, ...form.states];

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={s.title}>워크플로우 빌더</h1>
        {!editing && (
          <button style={s.btn} onClick={function () {
            setForm({ name: '', entity_type: 'issue', is_default: false, states: DEFAULT_STATES, transitions: [] });
            setEditing('new'); setMsg('');
          }}>+ 새 워크플로우</button>
        )}
      </div>

      {msg && <div style={{ ...s.msgBox, color: msg.indexOf('오류') !== -1 ? '#EF4444' : '#10B981' }}>{msg}</div>}

      {/* Editor */}
      {editing && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>{editing === 'new' ? '워크플로우 추가' : '워크플로우 수정'}</h2>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>이름</label>
                <input style={s.input} value={form.name} required placeholder="기본 이슈 워크플로우"
                  onChange={function (e) { setForm({ ...form, name: e.target.value }); }} />
              </div>
              <div style={{ width: 160 }}>
                <label style={s.label}>엔티티</label>
                <select style={s.input} value={form.entity_type} disabled={editing !== 'new'}
                  onChange={function (e) { setForm({ ...form, entity_type: e.target.value }); }}>
                  <option value="issue">이슈</option>
                  <option value="project">프로젝트</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#E2E8F0' }}>
                  <input type="checkbox" checked={form.is_default} onChange={function (e) { setForm({ ...form, is_default: e.target.checked }); }} />
                  기본
                </label>
              </div>
            </div>

            {/* States */}
            <div style={s.subSection}>
              <h3 style={s.subTitle}>상태 목록</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {form.states.map(function (st) {
                  return (
                    <span key={st.id} style={{ ...s.stateTag, backgroundColor: st.color + '20', color: st.color, borderColor: st.color + '40' }}>
                      {st.name} <span style={{ fontSize: 10, opacity: 0.6 }}>({st.id})</span>
                      <span style={{ cursor: 'pointer', marginLeft: 6, opacity: 0.6 }} onClick={function () { removeState(st.id); }}>x</span>
                    </span>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div>
                  <label style={s.label}>ID</label>
                  <input style={{ ...s.input, width: 120 }} value={newState.id} placeholder="waiting"
                    onChange={function (e) { setNewState({ ...newState, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); }} />
                </div>
                <div>
                  <label style={s.label}>이름</label>
                  <input style={{ ...s.input, width: 120 }} value={newState.name} placeholder="대기"
                    onChange={function (e) { setNewState({ ...newState, name: e.target.value }); }} />
                </div>
                <div>
                  <label style={s.label}>색상</label>
                  <input type="color" value={newState.color} style={{ width: 40, height: 34, border: 'none', cursor: 'pointer' }}
                    onChange={function (e) { setNewState({ ...newState, color: e.target.value }); }} />
                </div>
                <button type="button" style={s.smallBtn} onClick={addState}>추가</button>
              </div>
            </div>

            {/* Transitions */}
            <div style={s.subSection}>
              <h3 style={s.subTitle}>전이 규칙</h3>
              <div style={{ marginBottom: 12 }}>
                {form.transitions.map(function (t, i) {
                  var fromName = t.from === '*' ? '모든 상태' : (form.states.find(function (s) { return s.id === t.from; }) || {}).name || t.from;
                  var toName = (form.states.find(function (s) { return s.id === t.to; }) || {}).name || t.to;
                  return (
                    <div key={i} style={s.transitionRow}>
                      <span style={{ fontSize: 13, color: '#E2E8F0' }}>{fromName}</span>
                      <span style={{ fontSize: 13, color: '#64748B' }}>&rarr;</span>
                      <span style={{ fontSize: 13, color: '#E2E8F0' }}>{toName}</span>
                      <span style={{ cursor: 'pointer', fontSize: 12, color: '#EF4444', marginLeft: 'auto' }} onClick={function () { removeTransition(i); }}>삭제</span>
                    </div>
                  );
                })}
                {form.transitions.length === 0 && <p style={{ fontSize: 12, color: '#64748B' }}>전이 규칙을 추가하세요.</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div>
                  <label style={s.label}>From</label>
                  <select style={{ ...s.input, width: 140 }} value={newTransition.from}
                    onChange={function (e) { setNewTransition({ ...newTransition, from: e.target.value }); }}>
                    <option value="">선택...</option>
                    {stateOptions.map(function (st) { return <option key={st.id} value={st.id}>{st.name}</option>; })}
                  </select>
                </div>
                <span style={{ color: '#64748B', fontSize: 18, paddingBottom: 6 }}>&rarr;</span>
                <div>
                  <label style={s.label}>To</label>
                  <select style={{ ...s.input, width: 140 }} value={newTransition.to}
                    onChange={function (e) { setNewTransition({ ...newTransition, to: e.target.value }); }}>
                    <option value="">선택...</option>
                    {form.states.map(function (st) { return <option key={st.id} value={st.id}>{st.name}</option>; })}
                  </select>
                </div>
                <button type="button" style={s.smallBtn} onClick={addTransition}>추가</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="submit" style={s.btn}>저장</button>
              <button type="button" style={{ ...s.btn, backgroundColor: '#64748B' }} onClick={function () { setEditing(null); }}>취소</button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {!editing && (
        <div style={s.card}>
          {loading ? <p style={{ color: '#64748B' }}>로딩 중...</p> : workflows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ color: '#64748B', fontSize: 14 }}>워크플로우가 없습니다.</p>
            </div>
          ) : workflows.map(function (wf) {
            var states = wf.states || [];
            return (
              <div key={wf.id} style={s.wfItem}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#E2E8F0' }}>{wf.name}</span>
                    <span style={{ ...s.badge, backgroundColor: wf.entity_type === 'issue' ? '#3B82F620' : '#F59E0B20', color: wf.entity_type === 'issue' ? '#3B82F6' : '#F59E0B' }}>
                      {wf.entity_type === 'issue' ? '이슈' : '프로젝트'}
                    </span>
                    {wf.is_default && <span style={{ ...s.badge, backgroundColor: '#10B98120', color: '#10B981' }}>기본</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {states.map(function (st, i) {
                      return (
                        <span key={st.id}>
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: st.color + '20', color: st.color }}>{st.name}</span>
                          {i < states.length - 1 && <span style={{ color: '#475569', margin: '0 2px' }}>&rarr;</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={s.smallBtn} onClick={function () { startEdit(wf); }}>수정</button>
                  {!wf.is_default && <button style={{ ...s.smallBtn, color: '#EF4444' }} onClick={function () { handleDelete(wf.id); }}>삭제</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

var s = {
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  card: { backgroundColor: '#141824', borderRadius: 12, padding: '20px 24px', border: '1px solid #2A2F45', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '0 0 16px 0' },
  subSection: { marginBottom: 20, padding: 16, backgroundColor: '#0C0F1A', borderRadius: 8, border: '1px solid #2A2F45' },
  subTitle: { fontSize: 14, fontWeight: 600, color: '#E2E8F0', margin: '0 0 12px 0' },
  label: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4 },
  input: { display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, backgroundColor: '#141824', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 6, outline: 'none', boxSizing: 'border-box' },
  btn: { padding: '8px 18px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  smallBtn: { padding: '5px 12px', fontSize: 12, backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 6, cursor: 'pointer' },
  msgBox: { fontSize: 13, padding: '8px 14px', borderRadius: 8, backgroundColor: '#141824', marginBottom: 16 },
  wfItem: { display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #1E2235' },
  badge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4 },
  stateTag: { fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid', display: 'inline-flex', alignItems: 'center' },
  transitionRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', backgroundColor: '#141824', borderRadius: 6, marginBottom: 4 },
};
