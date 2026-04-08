'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

export default function SSOPage() {
  var [configs, setConfigs] = useState([]);
  var [loading, setLoading] = useState(true);
  var [editing, setEditing] = useState(null);
  var [form, setForm] = useState({ provider: 'saml', sso_url: '', entity_id: '', certificate: '', metadata_url: '', enabled: true });
  var [msg, setMsg] = useState('');

  useEffect(function () { fetchConfigs(); }, []);

  function fetchConfigs() {
    setLoading(true);
    apiFetch('/api/sso/config')
      .then(function (r) { setConfigs(r.data); })
      .catch(function (e) { setMsg(e.message); })
      .finally(function () { setLoading(false); });
  }

  function handleSave(e) {
    e.preventDefault();
    apiFetch('/api/sso/config', { method: 'POST', body: JSON.stringify(form) })
      .then(function () {
        setMsg('SSO 설정이 저장되었습니다.');
        setEditing(null);
        fetchConfigs();
      })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function handleDelete(id) {
    if (!confirm('SSO 설정을 삭제하시겠습니까?')) return;
    apiFetch('/api/sso/config/' + id, { method: 'DELETE' })
      .then(function () { fetchConfigs(); setMsg('삭제되었습니다.'); })
      .catch(function (e) { setMsg('오류: ' + e.message); });
  }

  function startEdit(cfg) {
    setForm({
      provider: cfg.provider, sso_url: cfg.sso_url || '', entity_id: cfg.entity_id || '',
      certificate: '', metadata_url: cfg.metadata_url || '', enabled: cfg.enabled
    });
    setEditing(cfg.id);
    setMsg('');
  }

  function startNew() {
    setForm({ provider: 'saml', sso_url: '', entity_id: '', certificate: '', metadata_url: '', enabled: true });
    setEditing('new');
    setMsg('');
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={s.title}>SSO / SAML 설정</h1>
        {!editing && <button style={s.btn} onClick={startNew}>+ 새 SSO 설정</button>}
      </div>

      {msg && <div style={{ ...s.msg, color: msg.indexOf('오류') !== -1 ? '#EF4444' : '#10B981' }}>{msg}</div>}

      {/* Form */}
      {editing && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>{editing === 'new' ? 'SSO 설정 추가' : 'SSO 설정 수정'}</h2>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={s.label}>프로바이더</label>
              <select style={s.input} value={form.provider} onChange={function (e) { setForm({ ...form, provider: e.target.value }); }}>
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OIDC (OpenID Connect)</option>
              </select>
            </div>
            <div>
              <label style={s.label}>SSO URL (IdP 로그인 URL)</label>
              <input style={s.input} type="url" value={form.sso_url} required placeholder="https://login.microsoftonline.com/..."
                onChange={function (e) { setForm({ ...form, sso_url: e.target.value }); }} />
            </div>
            <div>
              <label style={s.label}>Entity ID (Issuer)</label>
              <input style={s.input} type="text" value={form.entity_id} placeholder="urn:workmanager:tenant:..."
                onChange={function (e) { setForm({ ...form, entity_id: e.target.value }); }} />
            </div>
            <div>
              <label style={s.label}>Metadata URL (선택)</label>
              <input style={s.input} type="url" value={form.metadata_url} placeholder="https://..."
                onChange={function (e) { setForm({ ...form, metadata_url: e.target.value }); }} />
            </div>
            <div>
              <label style={s.label}>X.509 인증서 (PEM)</label>
              <textarea style={{ ...s.input, minHeight: 100, fontFamily: 'monospace', fontSize: 12 }} value={form.certificate}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                onChange={function (e) { setForm({ ...form, certificate: e.target.value }); }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="sso_enabled" checked={form.enabled}
                onChange={function (e) { setForm({ ...form, enabled: e.target.checked }); }} />
              <label htmlFor="sso_enabled" style={{ fontSize: 13, color: '#E2E8F0' }}>활성화</label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" style={s.btn}>저장</button>
              <button type="button" style={{ ...s.btn, backgroundColor: '#64748B' }} onClick={function () { setEditing(null); }}>취소</button>
            </div>
          </form>

          {/* SP Info */}
          <div style={{ marginTop: 20, padding: 16, backgroundColor: '#0C0F1A', borderRadius: 8, border: '1px solid #2A2F45' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', margin: '0 0 10px 0' }}>SP (서비스 프로바이더) 정보</h3>
            <div style={s.spRow}>
              <span style={s.spLabel}>ACS URL:</span>
              <code style={s.spValue}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/sso/saml/callback</code>
            </div>
            <div style={s.spRow}>
              <span style={s.spLabel}>Entity ID:</span>
              <code style={s.spValue}>urn:workmanager:tenant:your-tenant-id</code>
            </div>
            <div style={s.spRow}>
              <span style={s.spLabel}>NameID Format:</span>
              <code style={s.spValue}>emailAddress</code>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {!editing && (
        <div style={s.card}>
          {loading ? <p style={{ color: '#64748B' }}>로딩 중...</p> : configs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>SSO</div>
              <p style={{ color: '#64748B', fontSize: 14 }}>SSO 설정이 없습니다.</p>
              <p style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>Azure AD, Okta 등의 IdP를 연동할 수 있습니다.</p>
            </div>
          ) : configs.map(function (cfg) {
            return (
              <div key={cfg.id} style={s.configItem}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#E2E8F0' }}>{cfg.provider.toUpperCase()}</span>
                    <span style={{ ...s.badge, backgroundColor: cfg.enabled ? '#10B98120' : '#EF444420', color: cfg.enabled ? '#10B981' : '#EF4444' }}>
                      {cfg.enabled ? '활성' : '비활성'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{cfg.sso_url || '-'}</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Entity ID: {cfg.entity_id || 'auto'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={s.smallBtn} onClick={function () { startEdit(cfg); }}>수정</button>
                  <button style={{ ...s.smallBtn, color: '#EF4444', borderColor: '#EF444440' }} onClick={function () { handleDelete(cfg.id); }}>삭제</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div style={{ ...s.card, marginTop: 16 }}>
        <h2 style={s.sectionTitle}>SSO 연동 가이드</h2>
        <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.8 }}>
          <p><strong>Azure AD:</strong> Enterprise Applications &gt; New Application &gt; SAML &gt; SP 정보 입력</p>
          <p><strong>Okta:</strong> Applications &gt; Create App Integration &gt; SAML 2.0 &gt; SP 정보 입력</p>
          <p><strong>JIT 프로비저닝:</strong> SSO 로그인 시 사용자 계정이 자동으로 생성됩니다. (관리자 승인 불필요)</p>
        </div>
      </div>
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
  msg: { fontSize: 13, padding: '8px 14px', borderRadius: 8, backgroundColor: '#141824', marginBottom: 16 },
  configItem: { display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1E2235' },
  badge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4 },
  spRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  spLabel: { fontSize: 12, color: '#64748B', minWidth: 90 },
  spValue: { fontSize: 12, color: '#E2E8F0', backgroundColor: '#141824', padding: '2px 8px', borderRadius: 4 },
};
