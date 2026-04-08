'use client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useState } from 'react';

var PAGE_TITLES = {
  '/dashboard': '\uB300\uC2DC\uBCF4\uB4DC',
  '/records': '\uC5C5\uBB34\uC77C\uC9C0',
  '/projects': '\uD504\uB85C\uC81D\uD2B8',
  '/issues': '\uC774\uC288',
  '/calendar': '\uC77C\uC815',
  '/orders': '\uC218\uC8FC',
  '/settings': '\uC124\uC815',
};

var styles = {
  header: {
    height: 60,
    minHeight: 60,
    backgroundColor: '#0C0F1A',
    borderBottom: '1px solid #2A2F45',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  breadcrumb: {
    fontSize: 13,
    color: '#64748B',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#E2E8F0',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#141824',
    border: '1px solid #2A2F45',
    borderRadius: 8,
    padding: '6px 12px',
    minWidth: 200,
  },
  searchInput: {
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#E2E8F0',
    fontSize: 13,
    width: '100%',
  },
  searchIcon: {
    color: '#64748B',
    fontSize: 14,
    flexShrink: 0,
  },
  iconBtn: {
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
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: '#EF4444',
  },
  userBtn: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    backgroundColor: '#3B82F6',
    border: 'none',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default function Header() {
  var pathname = usePathname();
  var { user } = useAuth();
  var [searchFocused, setSearchFocused] = useState(false);

  var basePath = '/' + (pathname.split('/')[1] || 'dashboard');
  var pageTitle = PAGE_TITLES[basePath] || '\uB300\uC2DC\uBCF4\uB4DC';
  var userInitial = user?.name ? user.name.charAt(0).toUpperCase() : '?';

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        <span style={styles.breadcrumb}>WorkManager</span>
        <span style={{ color: '#2A2F45', fontSize: 13 }}>/</span>
        <span style={styles.title}>{pageTitle}</span>
      </div>

      <div style={styles.right}>
        {/* Search */}
        <div
          style={{
            ...styles.searchBox,
            borderColor: searchFocused ? '#3B82F6' : '#2A2F45',
          }}
        >
          <span style={styles.searchIcon}>{'\uD83D\uDD0D'}</span>
          <input
            type="text"
            placeholder="\uAC80\uC0C9..."
            style={styles.searchInput}
            onFocus={function() { setSearchFocused(true); }}
            onBlur={function() { setSearchFocused(false); }}
          />
        </div>

        {/* Notification bell */}
        <button
          style={styles.iconBtn}
          onMouseEnter={function(e) { e.currentTarget.style.backgroundColor = '#141824'; e.currentTarget.style.borderColor = '#2A2F45'; }}
          onMouseLeave={function(e) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
          title="\uC54C\uB9BC"
        >
          {'\uD83D\uDD14'}
          <div style={styles.notifBadge} />
        </button>

        {/* User avatar */}
        <button style={styles.userBtn} title={user?.name || '\uC0AC\uC6A9\uC790'}>
          {userInitial}
        </button>
      </div>
    </header>
  );
}
