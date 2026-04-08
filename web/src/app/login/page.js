'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
    maxWidth: '400px',
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
    marginBottom: '32px',
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
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '24px 0',
    color: '#555',
    fontSize: '13px',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: '#2a2a3a',
  },
  googleBtn: {
    width: '100%',
    padding: '12px',
    background: '#1e1e2a',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#ccc',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'border-color 0.2s',
  },
  footer: {
    textAlign: 'center',
    marginTop: '24px',
    color: '#888',
    fontSize: '14px',
  },
  link: {
    color: '#4f8ff7',
    textDecoration: 'none',
    fontWeight: '500',
  },
};

export default function LoginPage() {
  var { login } = useAuth();
  var router = useRouter();
  var [email, setEmail] = useState('');
  var [password, setPassword] = useState('');
  var [error, setError] = useState('');
  var [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err.data?.message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  var API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.diamond}>&#9670;</span> Work Manager
        </div>
        <div style={styles.subtitle}>업무 관리 시스템에 로그인하세요</div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>이메일</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={styles.input}
            onFocus={e => { e.target.style.borderColor = '#4f8ff7'; }}
            onBlur={e => { e.target.style.borderColor = '#333'; }}
          />

          <label style={styles.label}>비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호를 입력하세요"
            required
            style={styles.input}
            onFocus={e => { e.target.style.borderColor = '#4f8ff7'; }}
            onBlur={e => { e.target.style.borderColor = '#333'; }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span>또는</span>
          <div style={styles.dividerLine} />
        </div>

        <button
          type="button"
          style={styles.googleBtn}
          onClick={() => { window.location.href = API_BASE + '/api/auth/google'; }}
          onMouseOver={e => { e.currentTarget.style.borderColor = '#4f8ff7'; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = '#333'; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google 로그인
        </button>

        <div style={styles.footer}>
          계정이 없으신가요?{' '}
          <Link href="/register" style={styles.link}>회원가입</Link>
        </div>
      </div>
    </div>
  );
}
