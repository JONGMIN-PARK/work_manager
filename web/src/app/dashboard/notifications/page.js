'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

var EVENT_LABELS = {
  issue_assigned: '이슈 배정',
  issue_status_changed: '이슈 상태 변경',
  project_delayed: '프로젝트 지연',
  deadline_d3: '납기 D-3',
  deadline_d1: '납기 D-1',
  deadline_today: '납기 D-Day',
  user_pending: '가입 승인 요청',
  milestone_complete: '마일스톤 완료',
  milestone_progress: '마일스톤 진척 보고',
  weekly_report_uploaded: '주간업무보고 등록',
  order_delivery_d7: '납품 D-7',
  order_delivery_d3: '납품 D-3',
  weekly_digest: '주간 다이제스트',
  progress_warning: '진행률 경고',
};

var EVENT_ICONS = {
  issue_assigned: '🎫', issue_status_changed: '🔵', project_delayed: '⚠️',
  deadline_d3: '⏰', deadline_d1: '🔔', deadline_today: '🏁',
  user_pending: '👤', milestone_complete: '✅',
  milestone_progress: '📈', weekly_report_uploaded: '📋',
  order_delivery_d7: '📦', order_delivery_d3: '📦',
  weekly_digest: '📊', progress_warning: '📉',
};

export default function NotificationsPage() {
  var [notifications, setNotifications] = useState([]);
  var [total, setTotal] = useState(0);
  var [unread, setUnread] = useState(0);
  var [loading, setLoading] = useState(true);
  var [tab, setTab] = useState('all'); // all | unread | preferences
  var [prefs, setPrefs] = useState([]);
  var [prefsLoading, setPrefsLoading] = useState(false);

  useEffect(function () { fetchNotifications(); }, [tab]);

  function fetchNotifications() {
    setLoading(true);
    var qs = tab === 'unread' ? '?unread=true' : '';
    apiFetch('/api/notifications' + qs)
      .then(function (r) { setNotifications(r.data); setTotal(r.total); setUnread(r.unread); })
      .catch(function () { })
      .finally(function () { setLoading(false); });
  }

  function markRead(id) {
    apiFetch('/api/notifications/' + id + '/read', { method: 'PUT' })
      .then(function () {
        setNotifications(function (prev) { return prev.map(function (n) { return n.id === id ? { ...n, is_read: true } : n; }); });
        setUnread(function (u) { return Math.max(0, u - 1); });
      });
  }

  function markAllRead() {
    apiFetch('/api/notifications/read-all', { method: 'PUT' })
      .then(function () {
        setNotifications(function (prev) { return prev.map(function (n) { return { ...n, is_read: true }; }); });
        setUnread(0);
      });
  }

  function deleteNotif(id) {
    apiFetch('/api/notifications/' + id, { method: 'DELETE' })
      .then(function () {
        setNotifications(function (prev) { return prev.filter(function (n) { return n.id !== id; }); });
        setTotal(function (t) { return t - 1; });
      });
  }

  function fetchPrefs() {
    setPrefsLoading(true);
    apiFetch('/api/notifications/preferences')
      .then(function (r) { setPrefs(r.data); })
      .catch(function () { })
      .finally(function () { setPrefsLoading(false); });
  }

  function togglePref(eventType, channel, currentValue) {
    var updated = prefs.map(function (p) {
      if (p.event_type === eventType && p.channel === channel) return { ...p, is_enabled: !currentValue };
      return p;
    });
    // 설정이 없으면 새로 추가
    var exists = updated.some(function (p) { return p.event_type === eventType && p.channel === channel; });
    if (!exists) updated.push({ event_type: eventType, channel: channel, is_enabled: !currentValue });
    setPrefs(updated);

    apiFetch('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ preferences: [{ event_type: eventType, channel: channel, is_enabled: !currentValue }] })
    });
  }

  useEffect(function () { if (tab === 'preferences') fetchPrefs(); }, [tab]);

  function getPref(eventType, channel) {
    var found = prefs.find(function (p) { return p.event_type === eventType && p.channel === channel; });
    return found ? found.is_enabled : true; // 기본 활성
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={s.title}>알림 센터</h1>
        {tab !== 'preferences' && unread > 0 && (
          <button style={s.btn} onClick={markAllRead}>전체 읽음</button>
        )}
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {[['all', '전체 (' + total + ')'], ['unread', '읽지 않음 (' + unread + ')'], ['preferences', '알림 설정']].map(function (t) {
          return <button key={t[0]} style={{ ...s.tab, ...(tab === t[0] ? s.tabActive : {}) }} onClick={function () { setTab(t[0]); }}>{t[1]}</button>;
        })}
      </div>

      {/* Notifications List */}
      {tab !== 'preferences' && (
        <div style={s.card}>
          {loading ? <p style={{ color: '#64748B', padding: 20 }}>로딩 중...</p> : notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>🔔</div>
              <p>{tab === 'unread' ? '읽지 않은 알림이 없습니다.' : '알림이 없습니다.'}</p>
            </div>
          ) : notifications.map(function (n) {
            var icon = EVENT_ICONS[n.event_type] || '📌';
            return (
              <div key={n.id} style={{ ...s.notifItem, backgroundColor: n.is_read ? 'transparent' : 'rgba(59,130,246,0.05)' }}
                onClick={function () { if (!n.is_read) markRead(n.id); }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: n.is_read ? 400 : 600, color: '#E2E8F0', marginBottom: 2 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{new Date(n.created_at).toLocaleString('ko-KR')}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3B82F6', marginTop: 6 }} />}
                  <button style={s.deleteBtn} onClick={function (e) { e.stopPropagation(); deleteNotif(n.id); }}>x</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preferences */}
      {tab === 'preferences' && (
        <div style={s.card}>
          <p style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>이벤트별 알림 채널을 설정합니다. 비활성화하면 해당 채널로 알림이 발송되지 않습니다.</p>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>이벤트</th>
                <th style={{ ...s.th, textAlign: 'center' }}>인앱</th>
                <th style={{ ...s.th, textAlign: 'center' }}>텔레그램</th>
                <th style={{ ...s.th, textAlign: 'center' }}>이메일</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(EVENT_LABELS).map(function (evt) {
                return (
                  <tr key={evt}>
                    <td style={s.td}>
                      <span style={{ marginRight: 8 }}>{EVENT_ICONS[evt]}</span>
                      {EVENT_LABELS[evt]}
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <input type="checkbox" checked={true} disabled title="인앱 알림은 항상 활성" />
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <input type="checkbox" checked={getPref(evt, 'telegram')}
                        onChange={function () { togglePref(evt, 'telegram', getPref(evt, 'telegram')); }} />
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <input type="checkbox" checked={getPref(evt, 'email')}
                        onChange={function () { togglePref(evt, 'email', getPref(evt, 'email')); }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

var s = {
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #2A2F45' },
  tab: { padding: '10px 18px', fontSize: 13, fontWeight: 500, color: '#94A3B8', backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', marginBottom: -1 },
  tabActive: { color: '#3B82F6', borderBottomColor: '#3B82F6' },
  btn: { padding: '7px 16px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  card: { backgroundColor: '#141824', borderRadius: 12, border: '1px solid #2A2F45' },
  notifItem: { display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid #1E2235', cursor: 'pointer', alignItems: 'flex-start' },
  deleteBtn: { width: 20, height: 20, borderRadius: '50%', border: 'none', backgroundColor: 'transparent', color: '#64748B', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 16px', fontSize: 12, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #2A2F45' },
  td: { padding: '10px 16px', fontSize: 13, color: '#E2E8F0', borderBottom: '1px solid #1E2235' },
};
