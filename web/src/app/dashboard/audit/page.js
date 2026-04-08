'use client';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

export default function AuditPage() {
  var [logs, setLogs] = useState([]);
  var [total, setTotal] = useState(0);
  var [loading, setLoading] = useState(true);
  var [actions, setActions] = useState([]);
  var [filter, setFilter] = useState({ action: '', from: '', to: '', search: '' });
  var [page, setPage] = useState(0);
  var [retention, setRetention] = useState(null);
  var [retentionEdit, setRetentionEdit] = useState(false);
  var [retForm, setRetForm] = useState({ audit_logs_days: 365, archives_days: 0, deleted_data_days: 30, auto_purge: false });
  var [accessReport, setAccessReport] = useState(null);
  var [tab, setTab] = useState('logs'); // logs | access | retention | export
  var limit = 50;

  useEffect(function () { fetchLogs(); fetchActions(); }, []);

  function fetchLogs() {
    setLoading(true);
    var qs = '?limit=' + limit + '&offset=' + (page * limit);
    if (filter.action) qs += '&action=' + encodeURIComponent(filter.action);
    if (filter.from) qs += '&from=' + filter.from;
    if (filter.to) qs += '&to=' + filter.to;
    if (filter.search) qs += '&search=' + encodeURIComponent(filter.search);

    apiFetch('/api/audit' + qs)
      .then(function (r) { setLogs(r.data); setTotal(r.total); })
      .catch(function () { })
      .finally(function () { setLoading(false); });
  }

  function fetchActions() {
    apiFetch('/api/audit/actions').then(function (r) { setActions(r.data); }).catch(function () { });
  }

  function fetchAccessReport() {
    apiFetch('/api/data-export/access-report?days=30')
      .then(function (r) { setAccessReport(r.data); })
      .catch(function () { });
  }

  function fetchRetention() {
    apiFetch('/api/data-export/retention')
      .then(function (r) {
        setRetention(r.data);
        setRetForm({ audit_logs_days: r.data.audit_logs_days || 365, archives_days: r.data.archives_days || 0, deleted_data_days: r.data.deleted_data_days || 30, auto_purge: r.data.auto_purge || false });
      })
      .catch(function () { });
  }

  function saveRetention() {
    apiFetch('/api/data-export/retention', { method: 'PUT', body: JSON.stringify(retForm) })
      .then(function (r) { setRetention(r.data); setRetentionEdit(false); })
      .catch(function () { });
  }

  function handleFilter() { setPage(0); fetchLogs(); }

  function exportCSV() {
    var qs = '?format=csv';
    if (filter.from) qs += '&from=' + filter.from;
    if (filter.to) qs += '&to=' + filter.to;
    if (filter.action) qs += '&action=' + encodeURIComponent(filter.action);
    window.open('/api/data-export/audit' + qs, '_blank');
  }

  function exportFull() {
    window.open('/api/data-export/full', '_blank');
  }

  useEffect(function () { fetchLogs(); }, [page]);
  useEffect(function () {
    if (tab === 'access') fetchAccessReport();
    if (tab === 'retention') fetchRetention();
  }, [tab]);

  var totalPages = Math.ceil(total / limit);

  var ACTION_COLORS = {
    login: '#10B981', login_google: '#10B981', login_sso: '#10B981',
    logout: '#64748B',
    register: '#3B82F6', register_google: '#3B82F6', sso_jit_provision: '#3B82F6',
    change_password: '#F59E0B',
    sso_config_update: '#8B5CF6'
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={s.title}>감사 로그</h1>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {[['logs', '감사 로그'], ['access', '접근 기록'], ['retention', '보관 정책'], ['export', '데이터 내보내기']].map(function (t) {
          return <button key={t[0]} style={{ ...s.tab, ...(tab === t[0] ? s.tabActive : {}) }} onClick={function () { setTab(t[0]); }}>{t[1]}</button>;
        })}
      </div>

      {/* Logs Tab */}
      {tab === 'logs' && (
        <div>
          {/* Filters */}
          <div style={s.filterRow}>
            <input style={s.input} type="text" placeholder="검색..." value={filter.search}
              onChange={function (e) { setFilter({ ...filter, search: e.target.value }); }} />
            <select style={s.select} value={filter.action}
              onChange={function (e) { setFilter({ ...filter, action: e.target.value }); }}>
              <option value="">전체 액션</option>
              {actions.map(function (a) { return <option key={a} value={a}>{a}</option>; })}
            </select>
            <input style={s.input} type="date" value={filter.from}
              onChange={function (e) { setFilter({ ...filter, from: e.target.value }); }} />
            <input style={s.input} type="date" value={filter.to}
              onChange={function (e) { setFilter({ ...filter, to: e.target.value }); }} />
            <button style={s.btn} onClick={handleFilter}>검색</button>
            <button style={{ ...s.btn, backgroundColor: '#059669' }} onClick={exportCSV}>CSV 내보내기</button>
          </div>

          {/* Table */}
          <div style={s.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>일시</th>
                    <th style={s.th}>사용자</th>
                    <th style={s.th}>액션</th>
                    <th style={s.th}>대상</th>
                    <th style={s.th}>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#64748B' }}>로딩 중...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#64748B' }}>로그가 없습니다.</td></tr>
                  ) : logs.map(function (log) {
                    var color = ACTION_COLORS[log.action] || '#94A3B8';
                    return (
                      <tr key={log.id} style={s.tr}>
                        <td style={s.td}>{new Date(log.created_at).toLocaleString('ko-KR')}</td>
                        <td style={s.td}>
                          <div style={{ fontSize: 13, color: '#E2E8F0' }}>{log.user_name || '-'}</div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>{log.user_email || ''}</div>
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, backgroundColor: color + '20', color: color }}>{log.action}</span>
                        </td>
                        <td style={s.td}>
                          <span style={{ fontSize: 12, color: '#94A3B8' }}>{log.target_type || ''}</span>
                          {log.target_id && <span style={{ fontSize: 11, color: '#64748B', marginLeft: 4 }}>#{log.target_id.slice(0, 8)}</span>}
                        </td>
                        <td style={{ ...s.td, fontSize: 12, fontFamily: 'monospace', color: '#64748B' }}>{log.ip_address || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={s.pagination}>
                <button style={s.pageBtn} disabled={page === 0} onClick={function () { setPage(page - 1); }}>이전</button>
                <span style={{ fontSize: 13, color: '#94A3B8' }}>{page + 1} / {totalPages} (총 {total}건)</span>
                <button style={s.pageBtn} disabled={page >= totalPages - 1} onClick={function () { setPage(page + 1); }}>다음</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Access Report Tab */}
      {tab === 'access' && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>최근 30일 접근 기록 리포트</h2>
          {!accessReport ? <p style={{ color: '#64748B' }}>로딩 중...</p> : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>사용자</th>
                  <th style={s.th}>이메일</th>
                  <th style={s.th}>로그인</th>
                  <th style={s.th}>SSO</th>
                  <th style={s.th}>총 활동</th>
                  <th style={s.th}>고유 IP</th>
                  <th style={s.th}>마지막 활동</th>
                </tr>
              </thead>
              <tbody>
                {accessReport.map(function (u) {
                  return (
                    <tr key={u.id} style={s.tr}>
                      <td style={s.td}>{u.name}</td>
                      <td style={{ ...s.td, fontSize: 12, color: '#64748B' }}>{u.email}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{u.login_count}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{u.sso_login_count}</td>
                      <td style={{ ...s.td, textAlign: 'center', fontWeight: 600, color: '#3B82F6' }}>{u.total_actions}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{u.unique_ips}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{u.last_activity ? new Date(u.last_activity).toLocaleString('ko-KR') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Retention Tab */}
      {tab === 'retention' && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>데이터 보관 정책</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={s.retRow}>
              <span style={s.retLabel}>감사 로그 보관 기간</span>
              {retentionEdit ? (
                <input style={{ ...s.input, width: 100 }} type="number" value={retForm.audit_logs_days}
                  onChange={function (e) { setRetForm({ ...retForm, audit_logs_days: parseInt(e.target.value, 10) || 0 }); }} />
              ) : (
                <span style={s.retValue}>{(retention || retForm).audit_logs_days}일</span>
              )}
            </div>
            <div style={s.retRow}>
              <span style={s.retLabel}>아카이브 보관 기간 (0=무제한)</span>
              {retentionEdit ? (
                <input style={{ ...s.input, width: 100 }} type="number" value={retForm.archives_days}
                  onChange={function (e) { setRetForm({ ...retForm, archives_days: parseInt(e.target.value, 10) || 0 }); }} />
              ) : (
                <span style={s.retValue}>{(retention || retForm).archives_days === 0 ? '무제한' : (retention || retForm).archives_days + '일'}</span>
              )}
            </div>
            <div style={s.retRow}>
              <span style={s.retLabel}>삭제 데이터 보관 기간</span>
              {retentionEdit ? (
                <input style={{ ...s.input, width: 100 }} type="number" value={retForm.deleted_data_days}
                  onChange={function (e) { setRetForm({ ...retForm, deleted_data_days: parseInt(e.target.value, 10) || 0 }); }} />
              ) : (
                <span style={s.retValue}>{(retention || retForm).deleted_data_days}일</span>
              )}
            </div>
            <div style={s.retRow}>
              <span style={s.retLabel}>자동 정리</span>
              {retentionEdit ? (
                <input type="checkbox" checked={retForm.auto_purge}
                  onChange={function (e) { setRetForm({ ...retForm, auto_purge: e.target.checked }); }} />
              ) : (
                <span style={s.retValue}>{(retention || retForm).auto_purge ? '활성' : '비활성'}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {retentionEdit ? (
                <>
                  <button style={s.btn} onClick={saveRetention}>저장</button>
                  <button style={{ ...s.btn, backgroundColor: '#64748B' }} onClick={function () { setRetentionEdit(false); }}>취소</button>
                </>
              ) : (
                <button style={s.btn} onClick={function () { setRetentionEdit(true); }}>수정</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Tab */}
      {tab === 'export' && (
        <div style={s.card}>
          <h2 style={s.sectionTitle}>데이터 내보내기</h2>
          <p style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>GDPR 규정에 따라 조직의 전체 데이터를 내보낼 수 있습니다.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button style={s.exportBtn} onClick={exportCSV}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>CSV</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>감사 로그</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>필터 적용 내보내기</div>
            </button>
            <button style={s.exportBtn} onClick={function () { window.open('/api/data-export/users', '_blank'); }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>JSON</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>사용자 데이터</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>개인정보 내보내기</div>
            </button>
            <button style={s.exportBtn} onClick={exportFull}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>JSON</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>전체 데이터</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>프로젝트, 이슈, 수주 포함</div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

var s = {
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #2A2F45', paddingBottom: 0 },
  tab: { padding: '10px 18px', fontSize: 13, fontWeight: 500, color: '#94A3B8', backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', marginBottom: -1 },
  tabActive: { color: '#3B82F6', borderBottomColor: '#3B82F6' },
  filterRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '7px 10px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 6, outline: 'none' },
  select: { padding: '7px 10px', fontSize: 13, backgroundColor: '#0C0F1A', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 6, outline: 'none' },
  btn: { padding: '7px 16px', fontSize: 13, fontWeight: 600, backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  card: { backgroundColor: '#141824', borderRadius: 12, padding: '20px 24px', border: '1px solid #2A2F45' },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '0 0 16px 0' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #2A2F45', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', fontSize: 13, color: '#E2E8F0', borderBottom: '1px solid #1E2235' },
  tr: {},
  badge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 },
  pageBtn: { padding: '6px 14px', fontSize: 12, backgroundColor: '#1E2235', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 6, cursor: 'pointer' },
  retRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #1E2235' },
  retLabel: { fontSize: 14, color: '#E2E8F0' },
  retValue: { fontSize: 14, color: '#3B82F6', fontWeight: 600 },
  exportBtn: { padding: '20px 24px', backgroundColor: '#0C0F1A', border: '1px solid #2A2F45', borderRadius: 10, cursor: 'pointer', textAlign: 'center', minWidth: 160 },
};
