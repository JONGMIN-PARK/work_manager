'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var FIELD_TYPES = [
  { value: 'text', label: '텍스트' },
  { value: 'number', label: '숫자' },
  { value: 'date', label: '날짜' },
  { value: 'select', label: '단일 선택' },
  { value: 'multiselect', label: '다중 선택' },
  { value: 'checkbox', label: '체크박스' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: '이메일' },
];

var ENTITY_TYPES = [
  { value: 'project', label: '프로젝트' },
  { value: 'issue', label: '이슈' },
  { value: 'order', label: '수주' },
];

export default function CustomFieldsPage() {
  var [fields, setFields] = useState([]);
  var [loading, setLoading] = useState(true);
  var [editing, setEditing] = useState(null);
  var [entityFilter, setEntityFilter] = useState('');
  var [form, setForm] = useState({ entity_type: 'project', field_name: '', field_key: '', field_type: 'text', options: [], required: false, sort_order: 0 });
  var [optionInput, setOptionInput] = useState('');
  var [msg, setMsg] = useState('');

  useEffect(function () { fetchFields(); }, [entityFilter]);

  function fetchFields() {
    setLoading(true);
    var qs = entityFilter ? '?entityType=' + entityFilter : '';
    apiFetch('/api/custom-fields/definitions' + qs)
      .then(function (r) { setFields(r.data); })
      .catch(function () { })
      .finally(function () { setLoading(false); });
  }

  function handleSave(e) {
    e.preventDefault();
    var method = editing === 'new' ? 'POST' : 'PUT';
    var url = editing === 'new' ? '/api/custom-fields/definitions' : '/api/custom-fields/definitions/' + editing;

    apiFetch(url, { method: method, body: JSON.stringify(form) })
      .then(function () {
        setMsg('저장되었습니다.');
        setEditing(null);
        fetchFields();
      })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function handleDelete(id) {
    if (!confirm('이 커스텀 필드를 삭제하시겠습니까? 관련 데이터도 함께 삭제됩니다.')) return;
    apiFetch('/api/custom-fields/definitions/' + id, { method: 'DELETE' })
      .then(function () { fetchFields(); setMsg('삭제되었습니다.'); })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function addOption() {
    if (!optionInput.trim()) return;
    setForm({ ...form, options: [...form.options, optionInput.trim()] });
    setOptionInput('');
  }

  function removeOption(idx) {
    setForm({ ...form, options: form.options.filter(function (_, i) { return i !== idx; }) });
  }

  function startEdit(f) {
    setForm({
      entity_type: f.entity_type, field_name: f.field_name, field_key: f.field_key,
      field_type: f.field_type, options: f.options || [], required: f.required, sort_order: f.sort_order
    });
    setEditing(f.id);
    setMsg('');
  }

  var showOptions = form.field_type === 'select' || form.field_type === 'multiselect';

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={s.title}>커스텀 필드</h1>
        {!editing && (
          <button style={s.btn} onClick={function () {
            setForm({ entity_type: 'project', field_name: '', field_key: '', field_type: 'text', options: [], required: false, sort_order: 0 });
            setEditing('new'); setMsg('');
          }}>+ 필드 추가</button>
        )}
      </div>

      {msg && <div style={{ ...s.msgBox, color: msg.indexOf('오류') !== -1 ? '#EF4444' : '#10B981' }}>{msg}</div>}

      {/* Form */}
      {editing && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>{editing === 'new' ? '커스텀 필드 추가' : '커스텀 필드 수정'}</h2>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>엔티티 유형</label>
                <select style={s.input} value={form.entity_type} disabled={editing !== 'new'}
                  onChange={function (e) { setForm({ ...form, entity_type: e.target.value }); }}>
                  {ENTITY_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.label}>필드 유형</label>
                <select style={s.input} value={form.field_type}
                  onChange={function (e) { setForm({ ...form, field_type: e.target.value }); }}>
                  {FIELD_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>필드 이름 (표시용)</label>
                <input style={s.input} value={form.field_name} required placeholder="예: 담당 부서"
                  onChange={function (e) { setForm({ ...form, field_name: e.target.value }); }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.label}>필드 키 (영문)</label>
                <input style={s.input} value={form.field_key} required disabled={editing !== 'new'} placeholder="예: dept_name"
                  onChange={function (e) { setForm({ ...form, field_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); }} />
              </div>
            </div>
            {showOptions && (
              <div>
                <label style={s.label}>선택 옵션</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input style={{ ...s.input, flex: 1 }} value={optionInput} placeholder="옵션 추가..."
                    onChange={function (e) { setOptionInput(e.target.value); }}
                    onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }} />
                  <button type="button" style={s.btn} onClick={addOption}>추가</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {form.options.map(function (opt, i) {
                    return <span key={i} style={s.optionTag}>{opt} <span style={{ cursor: 'pointer', marginLeft: 4 }} onClick={function () { removeOption(i); }}>x</span></span>;
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#E2E8F0' }}>
                <input type="checkbox" checked={form.required} onChange={function (e) { setForm({ ...form, required: e.target.checked }); }} />
                필수 항목
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 12, color: '#94A3B8' }}>정렬 순서</label>
                <input style={{ ...s.input, width: 70 }} type="number" value={form.sort_order}
                  onChange={function (e) { setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 }); }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" style={s.btn}>저장</button>
              <button type="button" style={{ ...s.btn, backgroundColor: '#64748B' }} onClick={function () { setEditing(null); }}>취소</button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {!editing && (
        <>
          <div style={{ marginBottom: 16 }}>
            <select style={s.input} value={entityFilter} onChange={function (e) { setEntityFilter(e.target.value); }}>
              <option value="">전체 엔티티</option>
              {ENTITY_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
            </select>
          </div>

          <div style={s.card}>
            {loading ? <p style={{ color: '#64748B' }}>로딩 중...</p> : fields.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: '#64748B', fontSize: 14 }}>커스텀 필드가 없습니다.</p>
              </div>
            ) : fields.map(function (f) {
              var typeLabel = (FIELD_TYPES.find(function (t) { return t.value === f.field_type; }) || {}).label || f.field_type;
              var entityLabel = (ENTITY_TYPES.find(function (t) { return t.value === f.entity_type; }) || {}).label || f.entity_type;

              return (
                <div key={f.id} style={s.fieldItem}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0' }}>{f.field_name}</span>
                      <span style={s.typeBadge}>{entityLabel}</span>
                      <span style={{ ...s.typeBadge, backgroundColor: '#3B82F620', color: '#3B82F6' }}>{typeLabel}</span>
                      {f.required && <span style={{ ...s.typeBadge, backgroundColor: '#EF444420', color: '#EF4444' }}>필수</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'monospace' }}>{f.field_key}</div>
                    {f.options && f.options.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {f.options.map(function (opt, i) { return <span key={i} style={s.optionSmall}>{opt}</span>; })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={s.smallBtn} onClick={function () { startEdit(f); }}>수정</button>
                    <button style={{ ...s.smallBtn, color: '#EF4444' }} onClick={function () { handleDelete(f.id); }}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

var s = {
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  card: { backgroundColor: '#141824', borderRadius: 12, padding: '20px 24px', border: '1px solid #2A2F45' },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '0 0 16px 0' },
  label: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4 },
  input: { display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 6, outline: 'none', boxSizing: 'border-box' },
  btn: { padding: '8px 18px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  smallBtn: { padding: '5px 12px', fontSize: 12, backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 6, cursor: 'pointer' },
  msgBox: { fontSize: 13, padding: '8px 14px', borderRadius: 8, backgroundColor: '#141824', marginBottom: 16 },
  fieldItem: { display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1E2235' },
  typeBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, backgroundColor: '#F59E0B20', color: '#F59E0B' },
  optionTag: { fontSize: 12, padding: '4px 10px', backgroundColor: '#1E2235', color: '#E2E8F0', borderRadius: 6, display: 'inline-flex', alignItems: 'center' },
  optionSmall: { fontSize: 10, padding: '2px 6px', backgroundColor: '#1E2235', color: '#94A3B8', borderRadius: 4 },
};
