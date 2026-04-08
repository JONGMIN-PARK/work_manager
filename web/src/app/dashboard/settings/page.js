'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

var ROLE_MAP = {
  admin: { label: '관리자', color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  manager: { label: '매니저', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  member: { label: '멤버', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
};
var PLAN_MAP = {
  free: { label: 'Free', color: '#64748B' },
  starter: { label: 'Starter', color: '#3B82F6' },
  pro: { label: 'Pro', color: '#8B5CF6' },
  enterprise: { label: 'Enterprise', color: '#F59E0B' },
};

export default function SettingsPage() {
  var auth = useAuth();
  var user = auth.user || {};
  var tenant = user.tenant || {};

  var [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  var [pwMsg, setPwMsg] = useState('');
  var [pwLoading, setPwLoading] = useState(false);
  var [theme, setTheme] = useState('dark');

  var role = ROLE_MAP[user.role] || ROLE_MAP.member;
  var plan = PLAN_MAP[tenant.plan] || PLAN_MAP.free;

  function onPwField(key, val) {
    setPwForm(function (prev) { var n = { ...prev }; n[key] = val; return n; });
    setPwMsg('');
  }

  function handlePasswordChange(e) {
    e.preventDefault();
    if (pwForm.newPw !== pwForm.confirm) {
      setPwMsg('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (pwForm.newPw.length < 6) {
      setPwMsg('비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }
    setPwLoading(true);
    apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw }),
    })
      .then(function () {
        setPwMsg('비밀번호가 변경되었습니다.');
        setPwForm({ current: '', newPw: '', confirm: '' });
      })
      .catch(function (err) { setPwMsg('변경 실패: ' + err.message); })
      .finally(function () { setPwLoading(false); });
  }

  function handleUpgrade() {
    window.location.href = '/api/billing/checkout';
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={s.pageTitle}>{'\u2699\uFE0F 설정'}</h1>

      {/* Profile */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>프로필</h2>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>이름</div>
          <div style={s.fieldValue}>{user.name || '-'}</div>
        </div>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>이메일</div>
          <div style={s.fieldValue}>{user.email || '-'}</div>
        </div>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>역할</div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 20, color: role.color, backgroundColor: role.bg }}>{role.label}</span>
          </div>
        </div>
      </div>

      {/* Organization */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>조직 정보</h2>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>조직명</div>
          <div style={s.fieldValue}>{tenant.name || '-'}</div>
        </div>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>슬러그</div>
          <div style={{ ...s.fieldValue, fontFamily: 'monospace', fontSize: 13 }}>{tenant.slug || '-'}</div>
        </div>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>플랜</div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 20, color: '#fff', backgroundColor: plan.color }}>{plan.label}</span>
          </div>
        </div>
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>멤버 수</div>
          <div style={s.fieldValue}>{tenant.member_count != null ? tenant.member_count + '명' : '-'}</div>
        </div>
      </div>

      {/* Subscription */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>구독 관리</h2>
        <div style={s.planCard}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: plan.color }}>{plan.label}</span>
            <span style={{ fontSize: 13, color: '#64748B' }}>현재 플랜</span>
          </div>
          <p style={{ fontSize: 13, color: '#94A3B8', margin: '0 0 16px 0', lineHeight: 1.6 }}>
            더 많은 기능과 용량이 필요하시면 업그레이드하세요.
          </p>
          <button style={s.upgradeBtn} onClick={handleUpgrade}>업그레이드</button>
        </div>
      </div>

      {/* Password */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>비밀번호 변경</h2>
        <form onSubmit={handlePasswordChange}>
          <label style={s.inputLabel}>현재 비밀번호</label>
          <input style={s.input} type="password" value={pwForm.current}
            onChange={function (e) { onPwField('current', e.target.value); }} required />

          <label style={s.inputLabel}>새 비밀번호</label>
          <input style={s.input} type="password" value={pwForm.newPw}
            onChange={function (e) { onPwField('newPw', e.target.value); }} required />

          <label style={s.inputLabel}>비밀번호 확인</label>
          <input style={s.input} type="password" value={pwForm.confirm}
            onChange={function (e) { onPwField('confirm', e.target.value); }} required />

          {pwMsg && <div style={{ fontSize: 13, marginTop: 10, color: pwMsg.indexOf('변경되었') !== -1 ? '#10B981' : '#EF4444' }}>{pwMsg}</div>}

          <button type="submit" style={{ ...s.submitBtn, marginTop: 14, opacity: pwLoading ? 0.6 : 1 }} disabled={pwLoading}>
            {pwLoading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>
      </div>

      {/* Theme */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>테마</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ ...s.themeBtn, borderColor: theme === 'dark' ? '#3B82F6' : '#2A2F45', backgroundColor: theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#141824' }}
            onClick={function () { setTheme('dark'); }}>
            <span style={{ fontSize: 18 }}>{'\uD83C\uDF19'}</span>
            <span style={{ fontSize: 13, color: '#E2E8F0' }}>다크 모드</span>
          </button>
          <button style={{ ...s.themeBtn, borderColor: theme === 'light' ? '#3B82F6' : '#2A2F45', backgroundColor: theme === 'light' ? 'rgba(59,130,246,0.1)' : '#141824' }}
            onClick={function () { setTheme('light'); }}>
            <span style={{ fontSize: 18 }}>{'\u2600\uFE0F'}</span>
            <span style={{ fontSize: 13, color: '#E2E8F0' }}>라이트 모드</span>
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>테마 기능은 준비 중입니다.</p>
      </div>
    </div>
  );
}

var s = {
  pageTitle: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: '0 0 28px 0' },
  section: { backgroundColor: '#141824', borderRadius: 12, padding: '20px 24px', border: '1px solid #2A2F45', marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '0 0 16px 0' },
  fieldRow: { display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1E2235' },
  fieldLabel: { fontSize: 13, color: '#64748B', width: 100, flexShrink: 0 },
  fieldValue: { fontSize: 14, color: '#E2E8F0' },
  planCard: { backgroundColor: '#0C0F1A', borderRadius: 10, padding: '18px 20px', border: '1px solid #2A2F45' },
  upgradeBtn: { padding: '10px 24px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
  inputLabel: { display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 4, marginTop: 12 },
  input: { display: 'block', width: '100%', maxWidth: 360, padding: '8px 12px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  submitBtn: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
  themeBtn: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, border: '2px solid', cursor: 'pointer', backgroundColor: '#141824' },
};
