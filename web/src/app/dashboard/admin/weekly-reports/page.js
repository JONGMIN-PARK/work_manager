'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

var SECTION_LABEL = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
var STATUS_LABEL = { done: '완료', in_progress: '진행중', none: '미표시' };

var s = {
  page: { color: '#E2E8F0', fontSize: 14 },
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#94A3B8', marginBottom: 20 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid #2A2F45', marginBottom: 16 },
  tab: { padding: '10px 16px', cursor: 'pointer', color: '#94A3B8', fontSize: 13, fontWeight: 500, borderBottom: '2px solid transparent' },
  tabActive: { color: '#3B82F6', borderBottomColor: '#3B82F6' },
  card: { background: '#141824', border: '1px solid #2A2F45', borderRadius: 10, padding: 16, marginBottom: 12 },
  drop: { border: '2px dashed #2A2F45', borderRadius: 10, padding: 28, textAlign: 'center', color: '#94A3B8', cursor: 'pointer', transition: 'all .15s ease' },
  dropActive: { borderColor: '#3B82F6', background: 'rgba(59,130,246,0.05)' },
  btn: { padding: '8px 14px', borderRadius: 6, border: '1px solid #2A2F45', background: 'transparent', color: '#E2E8F0', cursor: 'pointer', fontSize: 13 },
  btnPrimary: { background: '#3B82F6', borderColor: '#3B82F6' },
  btnDanger: { borderColor: '#dc2626', color: '#fca5a5' },
  input: { padding: '8px 10px', borderRadius: 6, border: '1px solid #2A2F45', background: '#0A0D17', color: '#E2E8F0', fontSize: 13, minWidth: 0 },
  select: { padding: '8px 10px', borderRadius: 6, border: '1px solid #2A2F45', background: '#0A0D17', color: '#E2E8F0', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: '#64748B', fontWeight: 600, borderBottom: '1px solid #2A2F45', textTransform: 'uppercase', letterSpacing: 0.5 },
  td: { padding: '8px 10px', borderBottom: '1px solid #1E293B', fontSize: 12.5, verticalAlign: 'top' },
  tag: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 4, background: '#1E293B', color: '#94A3B8' },
  pillDone: { background: 'rgba(26,138,64,0.15)', color: '#4ade80', padding: '1px 6px', borderRadius: 4, fontSize: 11 },
  pillProg: { background: 'rgba(224,48,48,0.15)', color: '#f87171', padding: '1px 6px', borderRadius: 4, fontSize: 11 },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  statRow: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
  statCard: { flex: '1 1 140px', background: '#141824', border: '1px solid #2A2F45', borderRadius: 10, padding: 14 },
  statLabel: { fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  statVal: { fontSize: 22, fontWeight: 700, marginTop: 4 },
  bar: { height: 6, background: '#1E293B', borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', background: 'linear-gradient(90deg, #3B82F6, #60a5fa)' },
  msg: { padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  msgOk: { background: 'rgba(26,138,64,0.15)', color: '#4ade80' },
  msgErr: { background: 'rgba(220,38,38,0.15)', color: '#fca5a5' },
};

function StatusPill({ status }) {
  if (status === 'done') return <span style={s.pillDone}>● 완료</span>;
  if (status === 'in_progress') return <span style={s.pillProg}>● 진행중</span>;
  return null;
}

export default function WeeklyReportsPage() {
  var { user } = useAuth();
  var [tab, setTab] = useState('upload');

  if (!user) return null;
  if (user.role !== 'admin') {
    return (
      <div style={s.page}>
        <h1 style={s.h1}>주간 업무</h1>
        <div style={{ ...s.card, color: '#fca5a5' }}>관리자 권한이 필요합니다.</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📅 주간 업무 보고</h1>
      <div style={s.sub}>주간업무보고 JSON을 업로드하여 검색·통계로 활용합니다.</div>

      <div style={s.tabs}>
        {[
          { k: 'upload', label: '업로드' },
          { k: 'search', label: '검색' },
          { k: 'stats', label: '통계' },
          { k: 'list', label: '목록' },
        ].map(function (t) {
          return (
            <div
              key={t.k}
              style={{ ...s.tab, ...(tab === t.k ? s.tabActive : {}) }}
              onClick={function () { setTab(t.k); }}
            >
              {t.label}
            </div>
          );
        })}
      </div>

      {tab === 'upload' && <UploadTab />}
      {tab === 'search' && <SearchTab />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'list' && <ListTab />}
    </div>
  );
}

// ─── 업로드 탭 ───
function UploadTab() {
  var [drag, setDrag] = useState(false);
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);
  var [results, setResults] = useState([]);
  var inputRef = useRef(null);

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setBusy(true);
    setMsg(null);
    setResults([]);
    var ok = [], fail = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var text = await f.text();
        var json = JSON.parse(text);
        var r = await apiFetch('/api/weekly-reports', {
          method: 'POST',
          body: JSON.stringify(json),
        });
        ok.push({ file: f.name, saved: r.data && r.data[0] });
      } catch (e) {
        fail.push({ file: f.name, error: e.message });
      }
    }
    setBusy(false);
    setResults(ok.concat(fail.map(function (x) { return { file: x.file, error: x.error }; })));
    if (fail.length === 0) setMsg({ ok: true, text: ok.length + '개 업로드 완료' });
    else setMsg({ ok: false, text: '성공 ' + ok.length + ' / 실패 ' + fail.length });
  }

  return (
    <div>
      {msg && <div style={{ ...s.msg, ...(msg.ok ? s.msgOk : s.msgErr) }}>{msg.text}</div>}
      <div
        style={{ ...s.drop, ...(drag ? s.dropActive : {}) }}
        onClick={function () { inputRef.current && inputRef.current.click(); }}
        onDragOver={function (e) { e.preventDefault(); setDrag(true); }}
        onDragLeave={function () { setDrag(false); }}
        onDrop={function (e) { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
        <div style={{ fontWeight: 600, color: '#E2E8F0', marginBottom: 4 }}>JSON 파일을 드롭하거나 클릭하여 선택</div>
        <div style={{ fontSize: 12 }}>{busy ? '업로드 중...' : '여러 개 동시 선택 가능 · 같은 이름이면 덮어씀'}</div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          multiple
          style={{ display: 'none' }}
          onChange={function (e) { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {results.length > 0 && (
        <div style={{ ...s.card, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>처리 결과</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>파일</th>
                <th style={s.th}>주차</th>
                <th style={s.th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {results.map(function (r, i) {
                return (
                  <tr key={i}>
                    <td style={s.td}>{r.file}</td>
                    <td style={s.td}>{r.saved ? (r.saved.week_label || '-') : '-'}</td>
                    <td style={s.td}>
                      {r.error
                        ? <span style={{ color: '#fca5a5' }}>실패: {r.error}</span>
                        : <span style={{ color: '#4ade80' }}>저장됨</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 검색 탭 ───
function SearchTab() {
  var [filters, setFilters] = useState({ q: '', assignee: '', status: '', client: '', section: '', from: '', to: '', pane: 'cur' });
  var [results, setResults] = useState([]);
  var [loading, setLoading] = useState(false);
  var [searched, setSearched] = useState(false);

  function update(k, v) { setFilters(function (f) { return { ...f, [k]: v }; }); }

  async function run() {
    setLoading(true);
    setSearched(true);
    var qs = Object.keys(filters)
      .filter(function (k) { return filters[k]; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(filters[k]); })
      .join('&');
    try {
      var r = await apiFetch('/api/weekly-reports/search?' + qs);
      setResults(r.data || []);
    } catch (e) {
      setResults([]);
      alert('검색 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={s.card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          <input style={s.input} placeholder="키워드 (이름/세부)" value={filters.q} onChange={function (e) { update('q', e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') run(); }} />
          <input style={s.input} placeholder="담당자 (예: 박종민)" value={filters.assignee} onChange={function (e) { update('assignee', e.target.value); }} />
          <input style={s.input} placeholder="사이트 (예: 디케이티)" value={filters.client} onChange={function (e) { update('client', e.target.value); }} />
          <select style={s.select} value={filters.status} onChange={function (e) { update('status', e.target.value); }}>
            <option value="">상태 전체</option>
            <option value="done">완료</option>
            <option value="in_progress">진행중</option>
            <option value="none">미표시</option>
          </select>
          <select style={s.select} value={filters.section} onChange={function (e) { update('section', e.target.value); }}>
            <option value="">섹션 전체</option>
            <option value="dev">개발</option>
            <option value="setup">셋업</option>
            <option value="cs">C/S</option>
            <option value="etc">기타</option>
          </select>
          <select style={s.select} value={filters.pane} onChange={function (e) { update('pane', e.target.value); }}>
            <option value="cur">금주</option>
            <option value="last">지난주</option>
          </select>
          <input style={s.input} type="date" value={filters.from} onChange={function (e) { update('from', e.target.value); }} />
          <input style={s.input} type="date" value={filters.to} onChange={function (e) { update('to', e.target.value); }} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={run} disabled={loading}>{loading ? '검색 중...' : '검색'}</button>
          <button style={s.btn} onClick={function () { setFilters({ q: '', assignee: '', status: '', client: '', section: '', from: '', to: '', pane: 'cur' }); }}>초기화</button>
          {searched && <span style={{ alignSelf: 'center', fontSize: 12, color: '#94A3B8' }}>{results.length}건</span>}
        </div>
      </div>

      {results.length > 0 && (
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>주차</th>
                <th style={s.th}>섹션</th>
                <th style={s.th}>사이트</th>
                <th style={s.th}>업무</th>
                <th style={s.th}>D-day</th>
                <th style={s.th}>%</th>
                <th style={s.th}>담당자</th>
                <th style={s.th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {results.map(function (m, i) {
                var it = m.item;
                return (
                  <tr key={i}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{m.week_label || '-'}</div>
                      <div style={{ fontSize: 10, color: '#64748B' }}>{m.team || ''}</div>
                    </td>
                    <td style={s.td}>{SECTION_LABEL[it.section] || it.section}</td>
                    <td style={s.td}><strong>{it.client}</strong></td>
                    <td style={s.td}>
                      <div>{it.name}</div>
                      {(it.details || []).map(function (d, j) {
                        return <div key={j} style={{ color: '#94A3B8', fontSize: 11.5, marginTop: 2 }}>: {d.text}</div>;
                      })}
                    </td>
                    <td style={s.td}>{it.deadline}</td>
                    <td style={s.td}>{it.pct >= 0 ? it.pct + '%' : ''}</td>
                    <td style={s.td}>{(it.members || []).map(function (m2) { return <span key={m2} style={s.tag}>@{m2}</span>; })}</td>
                    <td style={s.td}><StatusPill status={it.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {searched && !loading && results.length === 0 && (
        <div style={s.card}><div style={{ color: '#94A3B8', textAlign: 'center', padding: 20 }}>결과가 없습니다.</div></div>
      )}
    </div>
  );
}

// ─── 통계 탭 ───
function StatsTab() {
  var [filters, setFilters] = useState({ from: '', to: '', team: '' });
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    var qs = Object.keys(filters).filter(function (k) { return filters[k]; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(filters[k]); }).join('&');
    try {
      var r = await apiFetch('/api/weekly-reports/stats' + (qs ? '?' + qs : ''));
      setData(r.data);
    } catch (e) { alert('통계 조회 실패: ' + e.message); }
    finally { setLoading(false); }
  }
  useEffect(function () { run(); }, []);

  function update(k, v) { setFilters(function (f) { return { ...f, [k]: v }; }); }

  return (
    <div>
      <div style={s.card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={s.input} placeholder="팀 (예: 소프트웨어팀)" value={filters.team} onChange={function (e) { update('team', e.target.value); }} />
          <input style={s.input} type="date" value={filters.from} onChange={function (e) { update('from', e.target.value); }} />
          <input style={s.input} type="date" value={filters.to} onChange={function (e) { update('to', e.target.value); }} />
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={run} disabled={loading}>{loading ? '조회 중...' : '조회'}</button>
        </div>
      </div>

      {data && (
        <>
          <div style={s.statRow}>
            <div style={s.statCard}><div style={s.statLabel}>주차 수</div><div style={s.statVal}>{data.totals.weeks}</div></div>
            <div style={s.statCard}><div style={s.statLabel}>총 항목</div><div style={s.statVal}>{data.totals.items}</div></div>
            <div style={s.statCard}><div style={s.statLabel}>완료</div><div style={{ ...s.statVal, color: '#4ade80' }}>{data.totals.byStatus.done}</div></div>
            <div style={s.statCard}><div style={s.statLabel}>진행중</div><div style={{ ...s.statVal, color: '#f87171' }}>{data.totals.byStatus.in_progress}</div></div>
            <div style={s.statCard}><div style={s.statLabel}>완료율</div><div style={s.statVal}>{data.totals.completion_rate}%</div></div>
          </div>

          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>주차별 진행</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>주차</th>
                  <th style={s.th}>총</th>
                  <th style={s.th}>완료</th>
                  <th style={s.th}>진행중</th>
                  <th style={s.th}>완료율</th>
                  <th style={s.th}>평균%</th>
                </tr>
              </thead>
              <tbody>
                {data.weekly.map(function (w) {
                  return (
                    <tr key={w.report_id}>
                      <td style={s.td}><strong>{w.week_label || '-'}</strong> <span style={{ color: '#64748B' }}>{w.week_start || ''}</span></td>
                      <td style={s.td}>{w.total}</td>
                      <td style={{ ...s.td, color: '#4ade80' }}>{w.done}</td>
                      <td style={{ ...s.td, color: '#f87171' }}>{w.in_progress}</td>
                      <td style={s.td}>
                        <div>{w.completion_rate}%</div>
                        <div style={s.bar}><div style={{ ...s.barFill, width: w.completion_rate + '%' }} /></div>
                      </td>
                      <td style={s.td}>{w.avg_pct == null ? '-' : w.avg_pct + '%'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>담당자별 건수 (상위 15)</div>
              {data.byMember.slice(0, 15).map(function (m) {
                return (
                  <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1E293B', fontSize: 12 }}>
                    <span>@{m.key}</span><span style={{ color: '#94A3B8' }}>{m.count}건</span>
                  </div>
                );
              })}
            </div>
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>사이트별 건수 (상위 15)</div>
              {data.byClient.slice(0, 15).map(function (c) {
                return (
                  <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1E293B', fontSize: 12 }}>
                    <span>{c.key}</span><span style={{ color: '#94A3B8' }}>{c.count}건</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 목록 탭 ───
function ListTab() {
  var [items, setItems] = useState([]);
  var [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch('/api/weekly-reports')
      .then(function (r) { setItems(r.data || []); })
      .catch(function () { setItems([]); })
      .finally(function () { setLoading(false); });
  }
  useEffect(load, []);

  function remove(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    apiFetch('/api/weekly-reports/' + id, { method: 'DELETE' })
      .then(load)
      .catch(function (e) { alert('삭제 실패: ' + e.message); });
  }

  if (loading) return <div style={s.card}>불러오는 중...</div>;
  if (!items.length) return <div style={s.card}><div style={{ color: '#94A3B8', textAlign: 'center', padding: 20 }}>업로드된 보고서가 없습니다.</div></div>;

  return (
    <div style={s.card}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={s.th}>주차</th>
            <th style={s.th}>팀</th>
            <th style={s.th}>이름</th>
            <th style={s.th}>기간</th>
            <th style={s.th}>완료/진행/총</th>
            <th style={s.th}>저장</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(function (it) {
            var st = (it.stats && it.stats.cur) || {};
            var bs = st.byStatus || {};
            return (
              <tr key={it.id}>
                <td style={s.td}><strong>{it.week_label || '-'}</strong></td>
                <td style={s.td}>{it.team || '-'}</td>
                <td style={{ ...s.td, fontSize: 11.5, color: '#94A3B8' }}>{it.name}</td>
                <td style={s.td}>{it.week_start || '-'} ~ {it.week_end || '-'}</td>
                <td style={s.td}>
                  <span style={{ color: '#4ade80' }}>{bs.done || 0}</span> / <span style={{ color: '#f87171' }}>{bs.in_progress || 0}</span> / {st.total || 0}
                </td>
                <td style={{ ...s.td, fontSize: 11, color: '#64748B' }}>{it.saved_at ? new Date(it.saved_at).toLocaleString('ko-KR') : '-'}</td>
                <td style={s.td}>
                  <button style={{ ...s.btn, ...s.btnDanger, padding: '4px 10px', fontSize: 11 }} onClick={function () { remove(it.id); }}>삭제</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
