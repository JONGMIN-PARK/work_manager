'use client';
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';

var styles = {
  wrapper: { position: 'relative' },
  btn: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: 'transparent',
    border: '1px solid transparent', color: '#94A3B8', fontSize: 18, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
    transition: 'all 0.15s ease',
  },
  badge: {
    position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
  },
  dropdown: {
    position: 'absolute', top: 44, right: 0, width: 340, backgroundColor: '#141824',
    border: '1px solid #2A2F45', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: 1000, overflow: 'hidden',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #2A2F45' },
  headerTitle: { fontSize: 14, fontWeight: 600, color: '#E2E8F0' },
  readAll: { fontSize: 12, color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 },
  list: { maxHeight: 360, overflowY: 'auto' },
  item: { display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1E2235', cursor: 'pointer', transition: 'background 0.1s' },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 13, color: '#E2E8F0', lineHeight: 1.4 },
  itemDesc: { fontSize: 12, color: '#64748B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemTime: { fontSize: 11, color: '#475569', marginTop: 4 },
  empty: { padding: '32px 16px', textAlign: 'center', color: '#64748B', fontSize: 13 },
  unread: { backgroundColor: 'rgba(59,130,246,0.06)' },
  dot: { width: 7, height: 7, borderRadius: '50%', backgroundColor: '#3B82F6', flexShrink: 0, marginTop: 6 },
  footer: { padding: '10px 16px', textAlign: 'center', borderTop: '1px solid #2A2F45' },
  footerLink: { fontSize: 12, color: '#3B82F6', textDecoration: 'none', fontWeight: 500 },
};

var EVENT_ICONS = {
  issue_assigned: '🎫', issue_status_changed: '🔵', project_delayed: '⚠️',
  deadline_d3: '⏰', deadline_d1: '🔔', deadline_today: '🏁',
  user_pending: '👤', milestone_complete: '✅',
  order_delivery_d7: '📦', order_delivery_d3: '📦',
  weekly_digest: '📊', progress_warning: '📉',
};

function timeAgo(dateStr) {
  var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
  if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
  return new Date(dateStr).toLocaleDateString('ko-KR');
}

export default function NotificationBell() {
  var [open, setOpen] = useState(false);
  var [notifications, setNotifications] = useState([]);
  var [unreadCount, setUnreadCount] = useState(0);
  var ref = useRef(null);

  function fetchNotifs() {
    apiFetch('/api/notifications?limit=10')
      .then(function (r) { setNotifications(r.data); setUnreadCount(r.unread); })
      .catch(function () { });
  }

  // 초기 로드 + 30초마다 갱신
  useEffect(function () {
    fetchNotifs();
    var interval = setInterval(fetchNotifs, 30000);
    return function () { clearInterval(interval); };
  }, []);

  useEffect(function () {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return function () { document.removeEventListener('mousedown', handleClick); };
  }, []);

  function markAllRead() {
    apiFetch('/api/notifications/read-all', { method: 'PUT' })
      .then(function () {
        setNotifications(function (prev) { return prev.map(function (n) { return { ...n, is_read: true }; }); });
        setUnreadCount(0);
      });
  }

  function markRead(id) {
    apiFetch('/api/notifications/' + id + '/read', { method: 'PUT' });
    setNotifications(function (prev) { return prev.map(function (n) { return n.id === id ? { ...n, is_read: true } : n; }); });
    setUnreadCount(function (c) { return Math.max(0, c - 1); });
  }

  return (
    <div style={styles.wrapper} ref={ref}>
      <button style={styles.btn} onClick={function () { setOpen(!open); if (!open) fetchNotifs(); }}
        onMouseEnter={function (e) { e.currentTarget.style.backgroundColor = '#141824'; }}
        onMouseLeave={function (e) { e.currentTarget.style.backgroundColor = 'transparent'; }}
        title="알림">
        {'🔔'}
        {unreadCount > 0 && <span style={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div style={styles.dropdown}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>알림</span>
            {unreadCount > 0 && <button style={styles.readAll} onClick={markAllRead}>모두 읽음</button>}
          </div>
          <div style={styles.list}>
            {notifications.length === 0 ? (
              <div style={styles.empty}>알림이 없습니다.</div>
            ) : notifications.map(function (n) {
              var icon = EVENT_ICONS[n.event_type] || '📌';
              return (
                <div key={n.id} style={{ ...styles.item, ...(n.is_read ? {} : styles.unread) }}
                  onClick={function () { if (!n.is_read) markRead(n.id); }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                  <div style={styles.itemBody}>
                    <div style={{ ...styles.itemTitle, fontWeight: n.is_read ? 400 : 600 }}>{n.title}</div>
                    {n.body && <div style={styles.itemDesc}>{n.body}</div>}
                    <div style={styles.itemTime}>{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.is_read && <div style={styles.dot} />}
                </div>
              );
            })}
          </div>
          <div style={styles.footer}>
            <Link href="/dashboard/notifications" style={styles.footerLink} onClick={function () { setOpen(false); }}>전체 보기</Link>
          </div>
        </div>
      )}
    </div>
  );
}
