'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';

var styles = {
  wrapper: { marginTop: 8 },
  btn: {
    background: 'linear-gradient(135deg, #6366F1, #3B82F6)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '10px 22px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    transition: 'opacity 0.15s',
  },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  card: {
    backgroundColor: '#141824',
    border: '1px solid #2A2F45',
    borderRadius: 12,
    padding: '20px 24px',
    marginTop: 16,
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
  },
  error: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    border: '1px solid #EF4444',
    borderRadius: 10,
    padding: '12px 18px',
    marginTop: 16,
    color: '#FCA5A5',
    fontSize: 13,
  },
  spinner: {
    display: 'inline-block',
    width: 16,
    height: 16,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'aispin 0.6s linear infinite',
  },
  regen: {
    background: '#1E293B',
    color: '#94A3B8',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
    marginTop: 12,
    fontWeight: 500,
  },
  label: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
  },
};

export default function AISummary({ data, context, placeholder }) {
  var [result, setResult] = useState('');
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState('');

  async function generate() {
    if (!data) return;
    setLoading(true);
    setError('');
    setResult('');
    try {
      var res = await apiFetch('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({ text: data, context: context || '' }),
      });
      setResult(res.data?.summary || res.summary || JSON.stringify(res));
    } catch (err) {
      setError(err.message || 'AI 요약 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <style>{`@keyframes aispin { to { transform: rotate(360deg); } }`}</style>

      {!result && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>{'🤖'}</div>
          <div style={styles.label}>{placeholder || 'AI가 현재 데이터를 분석하여 요약합니다.'}</div>
          <button
            style={{ ...styles.btn, ...((!data) ? styles.btnDisabled : {}) }}
            onClick={generate}
            disabled={!data}
          >
            {'🤖 AI 요약 생성'}
          </button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={styles.spinner} />
          <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 12 }}>AI가 분석 중입니다...</div>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <>
          <div style={styles.card}>{result}</div>
          <button style={styles.regen} onClick={generate}>{'🔄 다시 생성'}</button>
        </>
      )}
    </div>
  );
}
