'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

var styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: '#16161e',
    border: '1px solid #2a2a3a',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  logo: {
    textAlign: 'center',
    fontSize: '24px',
    fontWeight: '700',
    color: '#e0e0e0',
    marginBottom: '8px',
  },
  diamond: {
    color: '#4f8ff7',
  },
  subtitle: {
    textAlign: 'center',
    color: '#888',
    fontSize: '14px',
    marginBottom: '12px',
  },
  description: {
    textAlign: 'center',
    color: '#666',
    fontSize: '13px',
    marginBottom: '32px',
    lineHeight: '1.5',
  },
  label: {
    display: 'block',
    color: '#aaa',
    fontSize: '13px',
    marginBottom: '6px',
    fontWeight: '500',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    background: '#1e1e2a',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '15px',
    outline: 'none',
    marginBottom: '16px',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  slugPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    marginBottom: '16px',
  },
  slugPrefix: {
    padding: '12px 14px',
    background: '#12121a',
    border: '1px solid #333',
    borderRight: 'none',
    borderRadius: '8px 0 0 8px',
    color: '#666',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  slugInput: {
    flex: 1,
    padding: '12px 14px',
    background: '#1e1e2a',
    border: '1px solid #333',
    borderRadius: '0 8px 8px 0',
    color: '#e0e0e0',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  hint: {
    color: '#555',
    fontSize: '12px',
    marginTop: '-12px',
    marginBottom: '16px',
  },
  button: {
    width: '100%',
    padding: '12px',
    background: 'linear-gradient(135deg, #4f8ff7, #3b6fd4)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '8px',
    transition: 'opacity 0.2s',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  error: {
    background: 'rgba(255,80,80,0.1)',
    border: '1px solid rgba(255,80,80,0.3)',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#ff6b6b',
    fontSize: '13px',
    marginBottom: '16px',
  },
  stepBadge: {
    textAlign: 'center',
    marginBottom: '20px',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 12px',
    background: 'rgba(79,143,247,0.15)',
    border: '1px solid rgba(79,143,247,0.3)',
    borderRadius: '20px',
    color: '#4f8ff7',
    fontSize: '12px',
    fontWeight: '500',
  },
};

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

export default function SetupPage() {
  var { user, setUser } = useAuth();
  var router = useRouter();
  var [orgName, setOrgName] = useState('');
  var [slug, setSlug] = useState('');
  var [slugEdited, setSlugEdited] = useState(false);
  var [error, setError] = useState('');
  var [loading, setLoading] = useState(false);

  function handleNameChange(e) {
    var val = e.target.value;
    setOrgName(val);
    if (!slugEdited) {
      setSlug(toSlug(val));
    }
  }

  function handleSlugChange(e) {
    setSlugEdited(true);
    setSlug(toSlug(e.target.value));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!orgName.trim()) {
      setError('조직 이름을 입력해주세요.');
      return;
    }
    if (!slug.trim()) {
      setError('슬러그를 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      var result = await apiFetch('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({ name: orgName.trim(), slug: slug.trim() }),
      });
      // Update user context with tenant info
      if (user) {
        setUser({ ...user, tenantId: result.data?.id || result.data?.tenantId });
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err.data?.message || '조직 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.diamond}>&#9670;</span> Work Manager
        </div>
        <div style={styles.stepBadge}>
          <span style={styles.badge}>초기 설정</span>
        </div>
        <div style={styles.subtitle}>조직을 생성하세요</div>
        <div style={styles.description}>
          Work Manager를 시작하려면 조직(팀/회사)을 먼저 만들어야 합니다.<br />
          나중에 설정에서 변경할 수 있습니다.
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>조직 이름</label>
          <input
            type="text"
            value={orgName}
            onChange={handleNameChange}
            placeholder="예: 개발팀, ABC 주식회사"
            required
            style={styles.input}
            onFocus={function(e) { e.target.style.borderColor = '#4f8ff7'; }}
            onBlur={function(e) { e.target.style.borderColor = '#333'; }}
          />

          <label style={styles.label}>슬러그 (URL 식별자)</label>
          <div style={styles.slugPreview}>
            <span style={styles.slugPrefix}>app/</span>
            <input
              type="text"
              value={slug}
              onChange={handleSlugChange}
              placeholder="my-team"
              required
              style={styles.slugInput}
              onFocus={function(e) { e.target.style.borderColor = '#4f8ff7'; }}
              onBlur={function(e) { e.target.style.borderColor = '#333'; }}
            />
          </div>
          <div style={styles.hint}>영문 소문자, 숫자, 하이픈만 사용 가능</div>

          <button
            type="submit"
            disabled={loading}
            style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
          >
            {loading ? '생성 중...' : '조직 생성 및 시작'}
          </button>
        </form>
      </div>
    </div>
  );
}
