'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
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
  success: {
    background: 'rgba(80,200,120,0.1)',
    border: '1px solid rgba(80,200,120,0.3)',
    borderRadius: '12px',
    padding: '24px',
    textAlign: 'center',
  },
  successIcon: {
    fontSize: '40px',
    marginBottom: '12px',
  },
  successTitle: {
    color: '#50c878',
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '8px',
  },
  successText: {
    color: '#aaa',
    fontSize: '14px',
    lineHeight: '1.6',
    marginBottom: '20px',
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

export default function RegisterPage() {
  var [name, setName] = useState('');
  var [email, setEmail] = useState('');
  var [password, setPassword] = useState('');
  var [passwordConfirm, setPasswordConfirm] = useState('');
  var [error, setError] = useState('');
  var [loading, setLoading] = useState(false);
  var [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err.data?.message || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function inputProps(value, setter) {
    return {
      value: value,
      onChange: function(e) { setter(e.target.value); },
      style: styles.input,
      onFocus: function(e) { e.target.style.borderColor = '#4f8ff7'; },
      onBlur: function(e) { e.target.style.borderColor = '#333'; },
    };
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.diamond}>&#9670;</span> Work Manager
        </div>
        <div style={styles.subtitle}>새 계정을 만드세요</div>

        {done ? (
          <div style={styles.success}>
            <div style={styles.successIcon}>&#10003;</div>
            <div style={styles.successTitle}>가입 신청 완료</div>
            <div style={styles.successText}>
              관리자 승인을 기다려주세요.<br />
              승인이 완료되면 로그인할 수 있습니다.
            </div>
            <Link href="/login" style={styles.link}>로그인 페이지로 돌아가기</Link>
          </div>
        ) : (
          <>
            {error && <div style={styles.error}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <label style={styles.label}>이름</label>
              <input
                type="text"
                placeholder="홍길동"
                required
                {...inputProps(name, setName)}
              />

              <label style={styles.label}>이메일</label>
              <input
                type="email"
                placeholder="you@example.com"
                required
                {...inputProps(email, setEmail)}
              />

              <label style={styles.label}>비밀번호</label>
              <input
                type="password"
                placeholder="8자 이상 입력하세요"
                required
                {...inputProps(password, setPassword)}
              />

              <label style={styles.label}>비밀번호 확인</label>
              <input
                type="password"
                placeholder="비밀번호를 다시 입력하세요"
                required
                {...inputProps(passwordConfirm, setPasswordConfirm)}
              />

              <button
                type="submit"
                disabled={loading}
                style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
              >
                {loading ? '가입 중...' : '회원가입'}
              </button>
            </form>

            <div style={styles.footer}>
              이미 계정이 있으신가요?{' '}
              <Link href="/login" style={styles.link}>로그인</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
