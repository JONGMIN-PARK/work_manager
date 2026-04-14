'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
var TYPES = [
  { key: 'meeting', label: '회의' },
  { key: 'deadline', label: '마감' },
  { key: 'milestone', label: '마일스톤' },
  { key: 'review', label: '리뷰' },
  { key: 'other', label: '기타' },
];
var COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

var EMPTY_FORM = { title: '', type: 'meeting', start_date: '', end_date: '', color: '#3B82F6', memo: '' };

function pad(n) { return String(n).padStart(2, '0'); }
function toKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
function parseDate(s) { if (!s) return null; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

export default function CalendarPage() {
  var [events, setEvents] = useState([]);
  var [loading, setLoading] = useState(true);
  var [year, setYear] = useState(new Date().getFullYear());
  var [month, setMonth] = useState(new Date().getMonth());
  var [selectedDay, setSelectedDay] = useState(null);
  var [modalOpen, setModalOpen] = useState(false);
  var [editId, setEditId] = useState(null);
  var [form, setForm] = useState(EMPTY_FORM);

  useEffect(function () { loadEvents(); }, []);

  function loadEvents() {
    setLoading(true);
    apiFetch('/api/events')
      .then(function (res) { setEvents(res.data || []); })
      .catch(function () { setEvents([]); })
      .finally(function () { setLoading(false); });
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else { setMonth(month - 1); }
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else { setMonth(month + 1); }
    setSelectedDay(null);
  }

  // Calendar grid
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var cells = [];
  for (var i = 0; i < firstDay; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Events by day
  function eventsForDay(day) {
    if (!day) return [];
    var dateStr = toKey(year, month, day);
    return events.filter(function (ev) {
      var start = ev.start_date || '';
      var end = ev.end_date || start;
      return start <= dateStr && dateStr <= end;
    });
  }

  var selectedEvents = selectedDay ? eventsForDay(selectedDay) : [];
  var todayStr = new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1) + '-' + pad(new Date().getDate());

  function openCreate(day) {
    var dateStr = day ? toKey(year, month, day) : '';
    setEditId(null);
    setForm({ ...EMPTY_FORM, start_date: dateStr, end_date: dateStr });
    setModalOpen(true);
  }
  function openEdit(ev) {
    setEditId(ev.id);
    setForm({
      title: ev.title || '', type: ev.type || 'meeting',
      start_date: ev.start_date || '', end_date: ev.end_date || '',
      color: ev.color || '#3B82F6', memo: ev.memo || '',
    });
    setModalOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    var url = editId ? '/api/events/' + editId : '/api/events';
    var method = editId ? 'PUT' : 'POST';
    apiFetch(url, { method: method, body: JSON.stringify(form) })
      .then(function (res) {
        setModalOpen(false);
        if (editId && res.data) {
          setEvents(function (prev) {
            return prev.map(function (ev) { return ev.id === editId ? { ...ev, ...res.data } : ev; });
          });
        } else {
          loadEvents();
        }
      })
      .catch(function (err) { alert('저장 실패: ' + err.message); });
  }

  function handleDelete(id) {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    apiFetch('/api/events/' + id, { method: 'DELETE' })
      .then(function () { setModalOpen(false); loadEvents(); })
      .catch(function (err) { alert('삭제 실패: ' + err.message); });
  }

  function onField(key, val) {
    setForm(function (prev) { var n = { ...prev }; n[key] = val; return n; });
  }

  var typeLabel = function (key) {
    var t = TYPES.find(function (x) { return x.key === key; });
    return t ? t.label : key;
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>{'\uD83D\uDCC5 일정 관리'}</h1>
        <button style={s.addBtn} onClick={function () { openCreate(null); }}>{'\u2795 새 일정'}</button>
      </div>

      {/* Month nav */}
      <div style={s.monthNav}>
        <button style={s.navBtn} onClick={prevMonth}>{'\u25C0'}</button>
        <span style={s.monthLabel}>{year + '년 ' + (month + 1) + '월'}</span>
        <button style={s.navBtn} onClick={nextMonth}>{'\u25B6'}</button>
      </div>

      <div style={s.bodyWrap}>
        {/* Calendar */}
        <div style={s.calendarWrap}>
          {/* Day headers */}
          <div style={s.dayHeaders}>
            {DAYS.map(function (d, i) {
              return <div key={i} style={{ ...s.dayHeader, color: i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : '#94A3B8' }}>{d}</div>;
            })}
          </div>
          {/* Cells */}
          <div style={s.grid}>
            {cells.map(function (day, i) {
              var dayEvents = eventsForDay(day);
              var isToday = day && toKey(year, month, day) === todayStr;
              var isSelected = day && day === selectedDay;
              return (
                <div key={i} style={{
                  ...s.cell,
                  backgroundColor: isSelected ? '#1E293B' : '#141824',
                  borderColor: isToday ? '#3B82F6' : '#2A2F45',
                  cursor: day ? 'pointer' : 'default',
                  opacity: day ? 1 : 0.3,
                }} onClick={function () { if (day) setSelectedDay(day); }}>
                  {day && (
                    <>
                      <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#3B82F6' : i % 7 === 0 ? '#EF4444' : i % 7 === 6 ? '#3B82F6' : '#CBD5E1' }}>{day}</span>
                      <div style={s.dotRow}>
                        {dayEvents.slice(0, 3).map(function (ev, j) {
                          return <div key={j} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: ev.color || '#3B82F6' }} />;
                        })}
                        {dayEvents.length > 3 && <span style={{ fontSize: 9, color: '#64748B' }}>+{dayEvents.length - 3}</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <div style={s.sidePanel}>
          <div style={s.sidePanelHeader}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#E2E8F0' }}>
              {selectedDay ? (month + 1) + '월 ' + selectedDay + '일 일정' : '날짜를 선택하세요'}
            </span>
            {selectedDay && (
              <button style={s.smallAddBtn} onClick={function () { openCreate(selectedDay); }}>{'\u2795'}</button>
            )}
          </div>
          {selectedDay && selectedEvents.length === 0 && (
            <div style={{ color: '#64748B', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>일정이 없습니다</div>
          )}
          {selectedEvents.map(function (ev) {
            return (
              <div key={ev.id} style={s.eventCard} onClick={function () { openEdit(ev); }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: ev.color || '#3B82F6', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{ev.title}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748B', marginLeft: 18 }}>
                  <span>{typeLabel(ev.type)}</span>
                  {ev.memo && <span>{' \u00B7 ' + ev.memo.slice(0, 30)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div style={s.overlay} onClick={function () { setModalOpen(false); }}>
          <div style={s.modal} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={s.modalTitle}>{editId ? '일정 수정' : '새 일정'}</h2>
            <form onSubmit={handleSubmit}>
              <label style={s.label}>제목</label>
              <input style={s.input} value={form.title} required
                onChange={function (e) { onField('title', e.target.value); }} />

              <label style={s.label}>유형</label>
              <select style={s.input} value={form.type}
                onChange={function (e) { onField('type', e.target.value); }}>
                {TYPES.map(function (t) { return <option key={t.key} value={t.key}>{t.label}</option>; })}
              </select>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>시작일</label>
                  <input style={s.input} type="date" value={form.start_date}
                    onChange={function (e) { onField('start_date', e.target.value); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>종료일</label>
                  <input style={s.input} type="date" value={form.end_date}
                    onChange={function (e) { onField('end_date', e.target.value); }} />
                </div>
              </div>

              <label style={s.label}>색상</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 8 }}>
                {COLORS.map(function (c) {
                  return (
                    <div key={c} onClick={function () { onField('color', c); }}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', backgroundColor: c, cursor: 'pointer',
                        border: form.color === c ? '3px solid #E2E8F0' : '3px solid transparent',
                      }} />
                  );
                })}
              </div>

              <label style={s.label}>메모</label>
              <textarea style={{ ...s.input, minHeight: 64, resize: 'vertical' }} value={form.memo}
                onChange={function (e) { onField('memo', e.target.value); }} />

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                {editId && (
                  <button type="button" style={s.deleteBtn}
                    onClick={function () { handleDelete(editId); }}>삭제</button>
                )}
                <div style={{ flex: 1 }} />
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
  monthNav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 },
  navBtn: { padding: '6px 14px', fontSize: 14, backgroundColor: '#141824', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, cursor: 'pointer' },
  monthLabel: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', minWidth: 140, textAlign: 'center' },
  bodyWrap: { display: 'flex', gap: 20 },
  calendarWrap: { flex: 1, minWidth: 0 },
  dayHeaders: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 },
  dayHeader: { textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '6px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  cell: { minHeight: 72, borderRadius: 8, padding: '6px 8px', border: '1px solid #2A2F45', display: 'flex', flexDirection: 'column', gap: 4 },
  dotRow: { display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' },
  sidePanel: { width: 280, flexShrink: 0, backgroundColor: '#141824', borderRadius: 12, padding: 16, border: '1px solid #2A2F45', alignSelf: 'flex-start' },
  sidePanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #2A2F45' },
  smallAddBtn: { width: 28, height: 28, borderRadius: 6, border: '1px solid #2A2F45', backgroundColor: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 13 },
  eventCard: { padding: '10px 12px', backgroundColor: '#0C0F1A', borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: '1px solid #2A2F45' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: '#141824', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', border: '1px solid #2A2F45' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginTop: 0, marginBottom: 20 },
  label: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4, marginTop: 12 },
  input: { display: 'block', width: '100%', padding: '8px 12px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  cancelBtn: { padding: '8px 18px', fontSize: 13, backgroundColor: 'transparent', color: '#94A3B8', border: '1px solid #2A2F45', borderRadius: 8, cursor: 'pointer' },
  submitBtn: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
  deleteBtn: { padding: '8px 16px', fontSize: 13, backgroundColor: '#EF4444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
};
