'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useState } from 'react';

var NAV_ITEMS = [
  { icon: '📊', label: '대시보드', href: '/dashboard' },
  { icon: '📋', label: '업무일지', href: '/dashboard/records' },
  { icon: '📁', label: '프로젝트', href: '/dashboard/projects' },
  { icon: '🎫', label: '이슈', href: '/dashboard/issues' },
  { icon: '📅', label: '일정', href: '/dashboard/calendar' },
  { icon: '📦', label: '수주', href: '/dashboard/orders' },
  { icon: '🔔', label: '알림', href: '/dashboard/notifications' },
  { icon: '📜', label: '감사 로그', href: '/dashboard/audit', admin: true },
  { icon: '⚙️', label: '설정', href: '/dashboard/settings' },
];

var ADMIN_ITEMS = [
  { icon: '🔐', label: 'SSO/SAML', href: '/dashboard/admin/sso' },
  { icon: '📝', label: '커스텀 필드', href: '/dashboard/admin/custom-fields' },
  { icon: '🔄', label: '워크플로우', href: '/dashboard/admin/workflows' },
  { icon: '📅', label: '주간 업무', href: '/dashboard/admin/weekly-reports' },
];

var styles = {
  sidebar: {
    width: 240,
    minWidth: 240,
    backgroundColor: '#0A0D17',
    borderRight: '1px solid #2A2F45',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    position: 'sticky',
    top: 0,
    transition: 'transform 0.3s ease',
  },
  logo: {
    padding: '20px 16px',
    borderBottom: '1px solid #2A2F45',
    fontSize: 18,
    fontWeight: 700,
    color: '#E2E8F0',
    letterSpacing: '-0.5px',
  },
  nav: {
    flex: 1,
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    color: '#94A3B8',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  linkActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    color: '#3B82F6',
  },
  linkHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#E2E8F0',
  },
  bottom: {
    borderTop: '1px solid #2A2F45',
    padding: '16px',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#3B82F6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#E2E8F0',
    lineHeight: 1.3,
  },
  userRole: {
    fontSize: 11,
    color: '#64748B',
    backgroundColor: '#1E293B',
    padding: '2px 6px',
    borderRadius: 4,
    display: 'inline-block',
    marginTop: 2,
  },
  logoutBtn: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: '1px solid #2A2F45',
    borderRadius: 6,
    color: '#94A3B8',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  mobileToggle: {
    display: 'none',
    position: 'fixed',
    top: 12,
    left: 12,
    zIndex: 1100,
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#141824',
    border: '1px solid #2A2F45',
    color: '#E2E8F0',
    fontSize: 20,
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 999,
  },
};

export default function Sidebar() {
  var pathname = usePathname();
  var { user, logout } = useAuth();
  var [hoveredPath, setHoveredPath] = useState(null);
  var [mobileOpen, setMobileOpen] = useState(false);

  var userInitial = user?.name ? user.name.charAt(0).toUpperCase() : '?';
  var roleBadge = user?.role === 'admin' ? '\uAD00\uB9AC\uC790' : '\uD300\uC6D0';

  function isActive(href) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  var navContent = (
    <>
      <div style={styles.logo}>WorkManager</div>
      <nav style={styles.nav}>
        {NAV_ITEMS.filter(function(item) { return !item.admin || (user && user.role === 'admin'); }).map(function(item) {
          var active = isActive(item.href);
          var hovered = hoveredPath === item.href && !active;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...styles.link,
                ...(active ? styles.linkActive : {}),
                ...(hovered ? styles.linkHover : {}),
              }}
              onMouseEnter={function() { setHoveredPath(item.href); }}
              onMouseLeave={function() { setHoveredPath(null); }}
              onClick={function() { setMobileOpen(false); }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        {user && user.role === 'admin' && (
          <>
            <div style={{ fontSize: 10, color: '#475569', padding: '12px 12px 4px', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>관리자</div>
            {ADMIN_ITEMS.map(function(item) {
              var active = isActive(item.href);
              var hovered = hoveredPath === item.href && !active;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    ...styles.link,
                    ...(active ? styles.linkActive : {}),
                    ...(hovered ? styles.linkHover : {}),
                  }}
                  onMouseEnter={function() { setHoveredPath(item.href); }}
                  onMouseLeave={function() { setHoveredPath(null); }}
                  onClick={function() { setMobileOpen(false); }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>
      <div style={styles.bottom}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>{userInitial}</div>
          <div>
            <div style={styles.userName}>{user?.name || '\uC0AC\uC6A9\uC790'}</div>
            <span style={styles.userRole}>{roleBadge}</span>
          </div>
        </div>
        <button
          style={styles.logoutBtn}
          onClick={logout}
          onMouseEnter={function(e) { e.target.style.borderColor = '#3B82F6'; e.target.style.color = '#E2E8F0'; }}
          onMouseLeave={function(e) { e.target.style.borderColor = '#2A2F45'; e.target.style.color = '#94A3B8'; }}
        >
          \uB85C\uADF8\uC544\uC6C3
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        style={styles.mobileToggle}
        className="sidebar-mobile-toggle"
        onClick={function() { setMobileOpen(!mobileOpen); }}
      >
        {mobileOpen ? '\u2715' : '\u2630'}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div style={styles.overlay} onClick={function() { setMobileOpen(false); }} />
      )}

      {/* Sidebar */}
      <aside
        style={{
          ...styles.sidebar,
          ...(mobileOpen ? {} : {}),
        }}
        className={mobileOpen ? 'sidebar-open' : 'sidebar-default'}
      >
        {navContent}
      </aside>

      <style jsx global>{`
        @media (max-width: 768px) {
          .sidebar-mobile-toggle {
            display: flex !important;
          }
          .sidebar-default {
            position: fixed !important;
            z-index: 1000;
            transform: translateX(-100%);
          }
          .sidebar-open {
            position: fixed !important;
            z-index: 1000;
            transform: translateX(0) !important;
          }
        }
      `}</style>
    </>
  );
}
