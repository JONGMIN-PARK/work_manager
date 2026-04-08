'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import AISummary from '@/components/AISummary';

// ── Styles ──────────────────────────────────────────────
var S = {
  page: { maxWidth: 1200 },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 },
  badge: { fontSize: 12, background: '#3B82F6', color: '#fff', borderRadius: 12, padding: '2px 10px', fontWeight: 600 },
  btn: { background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPrimary: { background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 },
  card: { backgroundColor: '#141824', borderRadius: 12, padding: '18px 20px', borderTop: '3px solid' },
  cardLabel: { fontSize: 12, color: '#94A3B8', marginBottom: 4 },
  cardValue: { fontSize: 24, fontWeight: 700, color: '#E2E8F0' },
  filterBar: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 },
  input: { background: '#141824', color: '#E2E8F0', border: '1px solid #2A2F45', borderRadius: 8, padding: '7px 12px', fontSize: 13, outline: 'none' },
  tabBar: { display: 'flex', gap: 0, marginBottom: 20 },
  tab: { padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid #2A2F45', background: '#141824', color: '#94A3B8' },
  tabActive: { padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid #3B82F6', background: '#1E293B', color: '#E2E8F0' },
  tableWrap: { backgroundColor: '#141824', borderRadius: 12, border: '1px solid #2A2F45', overflow: 'auto', maxHeight: 520 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { position: 'sticky', top: 0, background: '#1E2235', color: '#94A3B8', padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #2A2F45', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', color: '#CBD5E1', borderBottom: '1px solid #1E2235', whiteSpace: 'nowrap' },
  rowCount: { fontSize: 12, color: '#64748B', marginTop: 8 },
  chartSection: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  chartCard: { backgroundColor: '#141824', borderRadius: 12, padding: 20, border: '1px solid #2A2F45' },
  chartTitle: { fontSize: 14, fontWeight: 600, color: '#E2E8F0', marginBottom: 16 },
  chipWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { fontSize: 12, borderRadius: 14, padding: '4px 12px', cursor: 'pointer', border: '1px solid #2A2F45', background: '#141824', color: '#94A3B8' },
  chipActive: { fontSize: 12, borderRadius: 14, padding: '4px 12px', cursor: 'pointer', border: '1px solid #3B82F6', background: 'rgba(59,130,246,0.15)', color: '#93C5FD' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  modal: { background: '#141824', borderRadius: 14, padding: 28, border: '1px solid #2A2F45', minWidth: 340, maxWidth: 480, color: '#E2E8F0' },
};

var COLORS = ['#3B82F6','#F59E0B','#10B981','#8B5CF6','#EF4444','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16'];
var CARD_BORDERS = ['#3B82F6','#10B981','#F59E0B','#8B5CF6'];

// ── Helpers ─────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  var s = String(d).replace(/[^0-9]/g, '');
  if (s.length === 8) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
  return String(d).slice(0,10);
}

function sumHours(arr) {
  return arr.reduce(function(s, r){ return s + (parseFloat(r.hours) || 0); }, 0);
}

// ── Doughnut SVG ────────────────────────────────────────
function Doughnut({ data }) {
  // data = [{label, value, color}]
  var total = data.reduce(function(s,d){ return s+d.value; },0);
  if (!total) return null;
  var cum = 0;
  var R = 80, r = 50, cx = 100, cy = 100;

  function arc(startAngle, endAngle) {
    var s = startAngle - Math.PI/2, e = endAngle - Math.PI/2;
    var x1 = cx + R*Math.cos(s), y1 = cy + R*Math.sin(s);
    var x2 = cx + R*Math.cos(e), y2 = cy + R*Math.sin(e);
    var x3 = cx + r*Math.cos(e), y3 = cy + r*Math.sin(e);
    var x4 = cx + r*Math.cos(s), y4 = cy + r*Math.sin(s);
    var large = endAngle - startAngle > Math.PI ? 1 : 0;
    return 'M '+x1+' '+y1+' A '+R+' '+R+' 0 '+large+' 1 '+x2+' '+y2+' L '+x3+' '+y3+' A '+r+' '+r+' 0 '+large+' 0 '+x4+' '+y4+' Z';
  }

  var paths = data.map(function(d, i) {
    var startAngle = (cum / total) * 2 * Math.PI;
    cum += d.value;
    var endAngle = (cum / total) * 2 * Math.PI;
    if (d.value / total > 0.999) endAngle = startAngle + 2 * Math.PI - 0.001;
    return <path key={i} d={arc(startAngle, endAngle)} fill={d.color} />;
  });

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
      <svg width={200} height={200} viewBox="0 0 200 200">{paths}</svg>
      <div style={{ fontSize: 12 }}>
        {data.map(function(d,i){
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ width:10, height:10, borderRadius:2, background:d.color, flexShrink:0 }}/>
              <span style={{ color:'#CBD5E1' }}>{d.label}</span>
              <span style={{ color:'#64748B', marginLeft:'auto' }}>{d.value.toFixed(1)}h ({(d.value/total*100).toFixed(0)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── HBar ────────────────────────────────────────────────
function HBar({ data }) {
  var max = data.reduce(function(m,d){ return Math.max(m,d.value); },0) || 1;
  return (
    <div>
      {data.map(function(d,i){
        return (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <span style={{ width:70, fontSize:12, color:'#CBD5E1', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.label}</span>
            <div style={{ flex:1, height:18, background:'#1E2235', borderRadius:4, overflow:'hidden' }}>
              <div style={{ width:(d.value/max*100)+'%', height:'100%', background:COLORS[i%COLORS.length], borderRadius:4, transition:'width .3s' }}/>
            </div>
            <span style={{ fontSize:12, color:'#94A3B8', width:50, textAlign:'right' }}>{d.value.toFixed(1)}h</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────
export default function RecordsPage() {
  var [records, setRecords] = useState([]);
  var [loading, setLoading] = useState(true);
  var [activeTab, setActiveTab] = useState('table');

  // filters
  var [dateFrom, setDateFrom] = useState('');
  var [dateTo, setDateTo] = useState('');
  var [selectedNames, setSelectedNames] = useState([]);
  var [keyword, setKeyword] = useState('');

  // upload
  var [uploading, setUploading] = useState(false);
  var [uploadMsg, setUploadMsg] = useState('');

  // ── Load data ──
  useEffect(function() {
    apiFetch('/api/archives/records?limit=50000&all=true')
      .then(function(res) { setRecords(res.data || []); })
      .catch(function(e) { console.error('records load error', e); })
      .finally(function() { setLoading(false); });
  }, []);

  // ── Unique names ──
  var uniqueNames = useMemo(function() {
    var set = {};
    records.forEach(function(r){ if(r.name) set[r.name]=1; });
    return Object.keys(set).sort();
  }, [records]);

  // ── Filtered records ──
  var filtered = useMemo(function() {
    return records.filter(function(r) {
      var d = fmtDate(r.date);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (selectedNames.length && selectedNames.indexOf(r.name) === -1) return false;
      if (keyword) {
        var kw = keyword.toLowerCase();
        var hay = [r.name, r.order_no, r.task_type, r.abbr, r.content, r.ocmt, r.oclient].join(' ').toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }, [records, dateFrom, dateTo, selectedNames, keyword]);

  // ── Stats ──
  var stats = useMemo(function() {
    var dates = filtered.map(function(r){ return fmtDate(r.date); }).filter(Boolean).sort();
    var names = {};
    filtered.forEach(function(r){ if(r.name) names[r.name]=1; });
    return {
      count: filtered.length,
      hours: sumHours(filtered),
      period: dates.length ? dates[0]+' ~ '+dates[dates.length-1] : '-',
      people: Object.keys(names).length,
    };
  }, [filtered]);

  // ── Chart data ──
  var taskTypeData = useMemo(function() {
    var map = {};
    filtered.forEach(function(r) {
      var t = r.task_type || '미분류';
      map[t] = (map[t]||0) + (parseFloat(r.hours)||0);
    });
    return Object.keys(map).sort(function(a,b){ return map[b]-map[a]; }).map(function(k,i){
      return { label:k, value:map[k], color:COLORS[i%COLORS.length] };
    });
  }, [filtered]);

  var personData = useMemo(function() {
    var map = {};
    filtered.forEach(function(r) {
      var n = r.name || '?';
      map[n] = (map[n]||0) + (parseFloat(r.hours)||0);
    });
    return Object.keys(map).sort(function(a,b){ return map[b]-map[a]; }).map(function(k){
      return { label:k, value:map[k] };
    });
  }, [filtered]);

  // ── Name chip toggle ──
  var toggleName = useCallback(function(name) {
    setSelectedNames(function(prev) {
      return prev.indexOf(name) >= 0
        ? prev.filter(function(n){ return n !== name; })
        : prev.concat(name);
    });
  }, []);

  // ── Reset filters ──
  var resetFilters = useCallback(function() {
    setDateFrom(''); setDateTo(''); setSelectedNames([]); setKeyword('');
  }, []);

  // ── Excel upload ──
  var handleFile = useCallback(async function(e) {
    var file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMsg('');

    try {
      var XLSX = await import('xlsx');
      var buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!rows.length) { setUploadMsg('빈 파일입니다.'); setUploading(false); return; }

      // column auto-detect
      var colMap = { date:null, name:null, order_no:null, hours:null, task_type:null, abbr:null, content:null, ocmt:null, oclient:null };
      var aliases = {
        date: ['날짜','date','일자'],
        name: ['이름','name','성명','작성자'],
        order_no: ['수주번호','order_no','수주no','수주 번호'],
        hours: ['시간','hours','투입시간','투입 시간','공수'],
        task_type: ['업무분장','task_type','분장','업무 분장'],
        abbr: ['약자','abbr','약어'],
        content: ['업무내용','content','내용','업무 내용'],
        ocmt: ['수주명','ocmt','수주 명','프로젝트명'],
        oclient: ['거래처','oclient','고객사','업체'],
      };
      var headers = Object.keys(rows[0]);
      Object.keys(aliases).forEach(function(key) {
        aliases[key].some(function(a) {
          var found = headers.find(function(h){ return h.trim().toLowerCase() === a.toLowerCase(); });
          if (found) { colMap[key] = found; return true; }
          return false;
        });
      });

      var parsed = rows.map(function(row) {
        var rec = {};
        Object.keys(colMap).forEach(function(key) {
          rec[key] = colMap[key] ? String(row[colMap[key]] ?? '') : '';
        });
        if (rec.hours) rec.hours = parseFloat(rec.hours) || 0;
        return rec;
      });

      await apiFetch('/api/archives/records/bulk', {
        method: 'POST',
        body: JSON.stringify({ records: parsed }),
      });

      // reload
      var res = await apiFetch('/api/archives/records?limit=50000&all=true');
      setRecords(res.data || []);
      setUploadMsg(parsed.length + '건 업로드 완료!');
    } catch (err) {
      console.error(err);
      setUploadMsg('업로드 실패: ' + (err.message || '오류'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, []);

  // ── Render ────────────────────────────────────────────
  if (loading) {
    return <div style={{ color: '#94A3B8', textAlign: 'center', marginTop: 80, fontSize: 15 }}>데이터를 불러오는 중...</div>;
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.headerRow}>
        <h1 style={S.title}>{'📋 업무일지 분석'}</h1>
        <span style={S.badge}>{records.length.toLocaleString() + '건'}</span>
        <div style={{ flex: 1 }} />
        <label style={{ ...S.btn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: uploading ? 0.6 : 1 }}>
          {'📂 엑셀 불러오기'}
          <input type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {uploadMsg && (
        <div style={{ fontSize: 13, color: uploadMsg.includes('실패') ? '#EF4444' : '#10B981', marginBottom: 14 }}>{uploadMsg}</div>
      )}

      {/* Stats cards */}
      <div style={S.grid4}>
        {[
          { label: '총 레코드', value: stats.count.toLocaleString(), border: CARD_BORDERS[0] },
          { label: '총 투입시간', value: stats.hours.toFixed(1) + 'h', border: CARD_BORDERS[1] },
          { label: '기간', value: stats.period, border: CARD_BORDERS[2], small: true },
          { label: '인원 수', value: stats.people + '명', border: CARD_BORDERS[3] },
        ].map(function(c, i) {
          return (
            <div key={i} style={{ ...S.card, borderTopColor: c.border }}>
              <div style={S.cardLabel}>{c.label}</div>
              <div style={{ ...S.cardValue, fontSize: c.small ? 16 : 24 }}>{c.value}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={S.filterBar}>
        <input type="date" value={dateFrom} onChange={function(e){ setDateFrom(e.target.value); }} style={{ ...S.input, width: 150 }} />
        <span style={{ color: '#64748B', fontSize: 13 }}>~</span>
        <input type="date" value={dateTo} onChange={function(e){ setDateTo(e.target.value); }} style={{ ...S.input, width: 150 }} />
        <input placeholder="검색어..." value={keyword} onChange={function(e){ setKeyword(e.target.value); }} style={{ ...S.input, width: 160 }} />
        <button onClick={resetFilters} style={S.btn}>필터 초기화</button>
      </div>

      {/* Name chips */}
      {uniqueNames.length > 0 && (
        <div style={{ ...S.chipWrap, marginBottom: 16 }}>
          {uniqueNames.map(function(name) {
            var active = selectedNames.indexOf(name) >= 0;
            return (
              <span key={name} onClick={function(){ toggleName(name); }} style={active ? S.chipActive : S.chip}>{name}</span>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div style={S.tabBar}>
        <span onClick={function(){ setActiveTab('table'); }} style={{ ...(activeTab==='table' ? S.tabActive : S.tab), borderRadius: '8px 0 0 8px' }}>{'📊 상세'}</span>
        <span onClick={function(){ setActiveTab('chart'); }} style={{ ...(activeTab==='chart' ? S.tabActive : S.tab) }}>{'📈 차트'}</span>
        <span onClick={function(){ setActiveTab('ai'); }} style={{ ...(activeTab==='ai' ? S.tabActive : S.tab), borderRadius: '0 8px 8px 0' }}>{'🤖 AI 요약'}</span>
      </div>

      {/* Table View */}
      {activeTab === 'table' && (
        <>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['이름','날짜','수주번호','수주명','거래처','시간','업무분장','약자','업무내용'].map(function(h){
                    return <th key={h} style={S.th}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(function(r, i) {
                  return (
                    <tr key={r.id || i} style={{ background: i%2 ? '#141824' : '#111520' }}>
                      <td style={S.td}>{r.name}</td>
                      <td style={S.td}>{fmtDate(r.date)}</td>
                      <td style={S.td}>{r.order_no}</td>
                      <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ocmt}</td>
                      <td style={S.td}>{r.oclient}</td>
                      <td style={S.td}>{r.hours}</td>
                      <td style={S.td}>{r.task_type}</td>
                      <td style={S.td}>{r.abbr}</td>
                      <td style={{ ...S.td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.content}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={S.rowCount}>{'표시 행: ' + filtered.length.toLocaleString() + '건'}</div>
        </>
      )}

      {/* Chart View */}
      {activeTab === 'chart' && (
        <div style={S.chartSection}>
          <div style={S.chartCard}>
            <div style={S.chartTitle}>업무분장 비율</div>
            <Doughnut data={taskTypeData} />
          </div>
          <div style={S.chartCard}>
            <div style={S.chartTitle}>인원별 투입시간</div>
            <HBar data={personData} />
          </div>
        </div>
      )}

      {/* AI Summary View */}
      {activeTab === 'ai' && (
        <div style={S.chartCard}>
          <AISummary
            data={filtered.length ? (
              '기간: ' + stats.period + '\n' +
              '총 레코드: ' + stats.count + '건, 총 시간: ' + stats.hours.toFixed(1) + 'h, 인원: ' + stats.people + '명\n' +
              '인원별: ' + personData.slice(0, 10).map(function(d){ return d.label + ' ' + d.value.toFixed(1) + 'h'; }).join(', ') + '\n' +
              '업무분장: ' + taskTypeData.slice(0, 10).map(function(d){ return d.label + ' ' + d.value.toFixed(1) + 'h'; }).join(', ') + '\n' +
              '주요 수주: ' + (function(){
                var m = {};
                filtered.forEach(function(r){ if(r.ocmt) m[r.ocmt] = (m[r.ocmt]||0) + (parseFloat(r.hours)||0); });
                return Object.keys(m).sort(function(a,b){ return m[b]-m[a]; }).slice(0,8).map(function(k){ return k + ' ' + m[k].toFixed(1) + 'h'; }).join(', ');
              })()
            ) : ''}
            context="업무일지 분석 데이터"
            placeholder="현재 필터링된 업무일지 데이터를 AI가 분석하여 핵심 요약을 생성합니다."
          />
        </div>
      )}
    </div>
  );
}
