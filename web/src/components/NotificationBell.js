'use client';
import { useState, useEffect, useRef } from 'react';

var styles = {
  wrapper: { position: 'relative' },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    color: '#94A3B8',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transition: 'all 0.15s ease',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
  },
  dropdown: {
    position: 'absolute',
    top: 44,
    right: 0,
    width: 320,
    backgroundColor: '#141824',
    border: '1px solid #2A2F45',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: 1000,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid #2A2F45',
  },
  headerTitle: { fontSize: 14, fontWeight: 600, color: '#E2E8F0' },
  readAll: {
    fontSize: 12,
    color: '#3B82F6',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
  },
  list: { maxHeight: 300, overflowY: 'auto' },
  item: {
    display: 'flex',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid #1E2235',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  itemIcon: { fontSize: 20, flexShrink: 0, marginTop: 2 },
  itemBody: { flex: 1, minWidth: 0 },
  itemMsg: { fontSize: 13, color: '#CBD5E1', lineHeight: 1.4 },
  itemTime: { fontSize: 11, color: '#64748B', marginTop: 4 },
  empty: { padding: '32px 16px', textAlign: 'center', color: '#64748B', fontSize: 13 },
  unread: { backgroundColor: 'rgba(59,130,246,0.06)' },
};

var MOCK_NOTIFICATIONS = [
  { id: 1, icon: '📊', message: '이번 주 업무일지 3건이 새로 등록되었습니다.', time: '5분 전', read: false },
  { id: 2, icon: '⚠️', message: '프로젝트 "신규 개발" 마감일이 3일 남았습니다.', time: '1시간 전', read: false },
  { id: 3, icon: '✅', message: '이슈 #42가 완료 처리되었습니다.', time: '3시간 전', read: true },
  { id: 4, icon: '👤', message: '새 팀원 김철수님이 합류했습니다.', time: '어제', read: true },
];

export default function NotificationBell() {
  var [open, setOpen] = useState(false);
  var [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  var ref = useRef(null);

  var unreadCount = notifications.filter(function(n) { return !n.read; }).length;

  // close on outside click
  useEffect(function() {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, []);

  function markAllRead() {
    setNotifications(function(prev) {
      return prev.map(function(n) { return { ...n, read: true }; });
    });
  }

  function toggle() { setOpen(function(v) { return !v; }); }

  return (
    <div style={styles.wrapper} ref={ref}>
      <button
        style={styles.btn}
        onClick={toggle}
        onMouseEnter={function(e) { e.currentTarget.style.backgroundColor = '#141824'; e.currentTarget.style.borderColor = '#2A2F45'; }}
        onMouseLeave={function(e) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
        title="알림"
      >
        {'🔔'}
        {unreadCount > 0 && <span style={styles.badge}>{unreadCount}</span>}
      </button>

      {open && (
        <div style={styles.dropdown}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>{'알림'}</span>
            {unreadCount > 0 && (
              <button style={styles.readAll} onClick={markAllRead}>모두 읽음</button>
            )}
          </div>
          <div style={styles.list}>
            {notifications.length === 0 && (
              <div style={styles.empty}>알림이 없습니다.</div>
            )}
            {notifications.map(function(n) {
              return (
                <div
                  key={n.id}
                  style={{ ...styles.item, ...(n.read ? {} : styles.unread) }}
                  onMouseEnter={function(e) { e.currentTarget.style.backgroundColor = '#1E2235'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.backgroundColor = n.read ? 'transparent' : 'rgba(59,130,246,0.06)'; }}
                >
                  <span style={styles.itemIcon}>{n.icon}</span>
                  <div style={styles.itemBody}>
                    <div style={styles.itemMsg}>{n.message}</div>
                    <div style={styles.itemTime}>{n.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
