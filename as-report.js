/**
 * A/S 관리 — 보고서 출력 (분할 6/7)
 * 엑셀 6시트 다운로드(asExportExcel) · 인쇄 미리보기(asPrintReport)
 * PDF 생성/미리보기 모달 · 웹메일 compose URL 빌더 · 메일 발송
 * (원래 as-manager.js 에서 순수 이동 — 동작 변화 없음)
 */

/* ═══ ⑥ 보고서 — 엑셀 6시트 다운로드 (SheetJS) + 인쇄 미리보기 ═══ */
function asExportExcel(ticketId) {
  if (typeof wmLibRetry === 'function' && wmLibRetry('xlsx', asExportExcel, this, arguments)) return;   // 무거운 도구는 처음 쓸 때 받음 (v13.310)
  if (typeof XLSX === 'undefined') {
    if (typeof showToast === 'function') showToast('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.', 'error');
    return;
  }
  asGetExpand(ticketId).then(function (t) {
    var CAT = _asCats();
    var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
    var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
    var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
    var LS = typeof AS_LOG_STATUS !== 'undefined' ? AS_LOG_STATUS : {};
    var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
    var label = function (m, k) { return (m && m[k] && m[k].label) || k || ''; };
    var freqTxt = t.frequency ? _asFreqDisplay(t.frequency, t.frequencyCount) : '';

    var wb = XLSX.utils.book_new();

    // 시트 1: 표지요약
    var deptDur = {};
    (t.activityLogs || []).forEach(function (l) {
      deptDur[l.dept] = (deptDur[l.dept] || 0) + Number(l.durationH || 0);
    });
    var totalH = Object.keys(deptDur).reduce(function (s, k) { return s + deptDur[k]; }, 0);

    var s1 = [
      ['A/S 작업 보고서'],
      ['장비 A/S 처리 결과 통합 리포트 (CS·공정·SW·제조·품질)'],
      [],
      ['리포트 번호', t.ticketNo || '', '', '작성일', _asFmtDate(new Date().toISOString()), '', '리포트 상태', label(typeof AS_STATUS !== 'undefined' ? AS_STATUS : {}, t.status)],
      [],
      ['▶ 고객 및 장비 정보'],
      ['고객사', t.customerName || '', '', '사이트/라인', t.siteLine || '', '', '담당자', t.customerContact || ''],
      ['장비모델', t.equipmentModel || '', '', 'Serial No.', t.serialNo || '', '', '장비번호', t.equipmentNo || ''],
      ['설치일자', _asFmtDate(t.installDate), '', '보증여부', t.warrantyStatus || '', '', '수주번호', t.orderNo || ''],
      [],
      ['▶ 접수 정보'],
      ['접수일시', _asFmtDT(t.receivedAt), '', '접수경로', label(typeof AS_CHANNEL !== 'undefined' ? AS_CHANNEL : {}, t.channel), '', '긴급도', t.priority || ''],
      ['카테고리', (CAT[t.category] || {}).label || t.category, '', '처리방식', label(typeof AS_METHOD !== 'undefined' ? AS_METHOD : {}, t.method)],
      [],
      ['▶ 이슈 요약 (고객 신고 내용)'],
      [t.issueSummary || ''],
      [],
      ['▶ 부서별 처리 요약'],
      ['부서', '소요(h)', '비고']
    ];
    Object.keys(deptDur).forEach(function (k) {
      s1.push([label(DEPT_MAP, k), Number(deptDur[k].toFixed(2)), '']);
    });
    s1.push(['합계', Number(totalH.toFixed(2)), '']);
    s1.push([]);
    s1.push(['▶ 최종 조치 결과 요약']);
    s1.push(['완료여부', t.closure || '', '', '작업종료일', _asFmtDate(t.closedAt), '', '장비 최종 상태', t.finalEquipStatus || '']);
    s1.push(['근본원인(RCA)', t.rca || '']);
    s1.push(['재발방지 대책', t.prevention || '']);
    s1.push(['모니터링', t.monitoring || '']);
    s1.push([]);
    s1.push(['▶ 고객 확인 및 서명']);
    var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
    var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
    s1.push(['현장 담당자', (cust && cust.signerName) || '', '서명일', _asFmtDate(cust && cust.signedAt), 'CSAT', label(CSAT, cust && cust.csatOverall)]);
    s1.push(['담당 엔지니어', (eng && eng.signerName) || '', '서명일', _asFmtDate(eng && eng.signedAt)]);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '표지요약');

    // 시트 2: 접수상세
    var s2 = [
      ['접수 및 이슈 상세'],
      [],
      ['리포트 번호', t.ticketNo, '고객사', t.customerName, '장비모델', t.equipmentModel],
      [],
      ['▶ 접수 상세'],
      ['최초 접수일시', _asFmtDT(t.receivedAt)],
      ['접수자(CS)', '(시스템에서 user_id 매핑)'],
      ['약속 응답일시', _asFmtDT(t.promisedResponseAt)],
      ['약속 방문일시', _asFmtDT(t.promisedVisitAt)],
      [],
      ['▶ 고객 신고 내용 (원문)'],
      [t.issueSummary || ''],
      [],
      ['▶ 1차 분석 (CS/공정)'],
      ['재현 여부', label(typeof AS_REPRODUCTION !== 'undefined' ? AS_REPRODUCTION : {}, t.reproduction)],
      ['발생 빈도', freqTxt],
      ['영향 범위', t.impactScope || ''],
      ['1차 분석 결과', t.initialAnalysis || ''],
      [],
      ['▶ 처리부서 분기 결정'],
      ['부서', '역할', '담당자', '처리방식', '약속일시', '시작', '완료', '소요(h)', '상태', '결과']
    ];
    (t.assignments || []).forEach(function (a) {
      s2.push([label(DEPT_MAP, a.dept), a.role === 'primary' ? '주관' : '보조',
        a.assigneeName || '', label(typeof AS_METHOD !== 'undefined' ? AS_METHOD : {}, a.method),
        _asFmtDT(a.promisedAt), _asFmtDT(a.startedAt), _asFmtDT(a.completedAt),
        Number(a.durationH || 0), label(typeof AS_ASSIGN_STATUS !== 'undefined' ? AS_ASSIGN_STATUS : {}, a.status),
        a.resultNote || '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), '접수상세');

    // 시트 3: 부서별 처리이력
    var s3 = [
      ['부서별 처리 이력 (Activity Log)'],
      [],
      ['No', '일자', '부서', '담당자', '작업유형', '문제/분석', '조치내용', '소요(h)', '상태', '후속']
    ];
    (t.activityLogs || []).forEach(function (l) {
      s3.push([l.seq, _asFmtDT(l.workedAt), label(DEPT_MAP, l.dept), l.authorName || '',
        label(WT, l.workType), l.problem || '', l.actionTaken || '',
        Number(l.durationH || 0), label(LS, l.status), l.followup || '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '처리이력');

    // 시트 4: 사용 부품
    var s4 = [
      ['사용 부품 / 소모품'],
      [],
      ['사용일', '품목', 'Part No', '수량', '단가', '금액', '교체 S/N', '청구구분', '메모']
    ];
    var totals = {}; var grand = 0;
    (t.parts || []).forEach(function (p) {
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      totals[p.billing] = (totals[p.billing] || 0) + amt;
      grand += amt;
      s4.push([_asFmtDate(p.usedAt), p.itemName || '', p.partNo || '',
        Number(p.qty || 0), Number(p.unitPrice || 0), amt,
        p.replacedSn || '', label(BILL, p.billing), p.note || '']);
    });
    s4.push([]);
    s4.push(['▶ 청구구분별 자동 집계']);
    Object.keys(totals).forEach(function (k) {
      s4.push([label(BILL, k), '', '', '', '', totals[k]]);
    });
    s4.push(['합계', '', '', '', '', grand]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), '부품');

    // 시트 5: 최종 결과 + 첨부 + 고객 확인
    var s5 = [
      ['최종 결과 · 첨부 · 고객 확인'],
      [],
      ['▶ 장비 최종 상태'],
      ['운전 가능 여부', t.finalEquipStatus || '', '추가 모니터링', t.monitoring || ''],
      ['현재 장비 상태 상세', ''],
      ['추가 권고 / 개선 제안', t.prevention || ''],
      [],
      ['▶ 첨부 자료'],
      ['구분', '파일/문서명', '경로/링크', '메모']
    ];
    (t.attachments || []).forEach(function (a) {
      var ac = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
      s5.push([label(ac, a.category), a.fileName || '', a.fileUrl || '', a.note || '']);
    });
    s5.push([]);
    s5.push(['▶ 고객 피드백 / 만족도']);
    s5.push(['응답속도', label(CSAT, cust && cust.csatSpeed)]);
    s5.push(['처리품질', label(CSAT, cust && cust.csatQuality)]);
    s5.push(['전반 만족도', label(CSAT, cust && cust.csatOverall)]);
    s5.push(['고객 코멘트', (cust && cust.comment) || '']);
    s5.push([]);
    s5.push(['▶ 고객 확인 서명']);
    s5.push(['현장 담당자', (cust && cust.signerName) || '', '서명일', _asFmtDate(cust && cust.signedAt)]);
    s5.push(['담당 엔지니어', (eng && eng.signerName) || '', '서명일', _asFmtDate(eng && eng.signedAt)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s5), '최종결과');

    // 시트 6: 코드표 / 작성 가이드 (정적)
    var s6 = [
      ['코드표 및 작성 가이드'],
      [],
      ['▶ 작성 순서'],
      ['1.', '접수번호 자동 채번: AS-{년도}-{월}-{순번}'],
      ['2.', '시트2(접수상세) → 시트3(처리이력) → 시트4(부품) → 시트5(결과) → 시트1(표지요약)'],
      ['3.', '한 작업당 한 줄. 부서·담당자·일자·작업유형·내용·소요시간·상태 필수'],
      [],
      ['▶ 표준 코드값 (드롭다운 enum)'],
      ['카테고리'].concat(Object.keys(CAT).map(function (k) { return CAT[k].label; })),
      ['긴급도', 'P1-긴급(라인정지)', 'P2-높음(생산영향)', 'P3-보통', 'P4-낮음'],
      ['처리방식', '원격지원', '출장', 'RMA', '가이드제공', '자료송부'],
      ['처리 상태', '진행중', '완료', '대기(부품)', '대기(고객확인)', '이관', '보류', '취소'],
      ['보증/청구', '보증(무상)', '보증외(유상)', 'Goodwill(무상)', '확인필요'],
      ['만족도', '매우만족', '만족', '보통', '불만족', '매우불만족', 'N/A']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s6), '코드표');

    var fname = (t.ticketNo || 'AS_Report') + '_' + _asFmtDate(new Date().toISOString()) + '.xlsx';
    XLSX.writeFile(wb, fname);
    if (typeof showToast === 'function') showToast('📊 ' + fname + ' 다운로드 시작');
  }).catch(function (err) {
    console.error('[asExportExcel]', err);
    if (typeof showToast === 'function') showToast('엑셀 생성 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

function asPrintReport(ticketId) {
  // 새 창은 클릭 순간에 먼저 연다 — 조회가 끝난 뒤 열면 브라우저가 팝업으로 막는다
  var w = window.open('', '_blank', 'width=900,height=900');
  if (!w) { if (typeof showToast === 'function') showToast('팝업이 차단되었습니다 — 브라우저 주소창의 팝업 허용 후 다시 눌러 주세요.', 'warn'); return; }
  try { w.document.write('<p style="font-family:sans-serif;color:#64748b;padding:20px">보고서를 불러오는 중…</p>'); } catch (e) {}
  asGetExpand(ticketId).then(function (t) {
    var CAT = _asCats();
    var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
    var html = '';
    html += '<!DOCTYPE html><html><head><meta charset="utf-8"><title>A/S Report ' + _asEsc(t.ticketNo) + '</title>';
    html += '<style>body{font-family:Malgun Gothic,Arial,sans-serif;font-size:11px;color:#1F2937;padding:30px;max-width:800px;margin:0 auto}';
    html += 'h1{font-size:20px;border-bottom:2px solid #F59E0B;padding-bottom:8px}';
    html += 'h2{font-size:14px;background:#F3F4F6;padding:5px 10px;margin-top:18px}';
    html += 'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}';
    html += 'th,td{border:1px solid #D1D5DB;padding:5px 8px;text-align:left}';
    html += 'th{background:#F9FAFB;font-weight:700}';
    html += '.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0}';
    html += '.summary>div{border:1px solid #E5E7EB;padding:8px;border-radius:4px}';
    html += '.summary .k{font-size:9px;color:#6B7280;margin-bottom:2px}';
    html += '.sig{display:flex;gap:20px;margin-top:14px}';
    html += '.sig>div{flex:1;border:1px solid #E5E7EB;padding:10px;text-align:center;min-height:90px}';
    html += '.sig img{max-height:60px}';
    html += '@media print{button{display:none}}</style></head><body>';
    html += '<h1>🛠️ A/S Report — ' + _asEsc(t.ticketNo) + '</h1>';
    html += '<button onclick="window.print()" style="margin-bottom:14px;padding:8px 14px;background:#F59E0B;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">🖨️ 인쇄</button>';

    html += '<h2>① 고객 및 장비</h2>';
    html += '<div class="summary">';
    [['고객사', t.customerName], ['장비모델', t.equipmentModel], ['Serial No.', t.serialNo],
     ['장비번호', t.equipmentNo], ['수주번호', t.orderNo], ['보증여부', t.warrantyStatus]].forEach(function (r) {
      html += '<div><div class="k">' + _asEsc(r[0]) + '</div><div>' + _asEsc(r[1] || '-') + '</div></div>';
    });
    html += '</div>';

    html += '<h2>② 접수 정보</h2>';
    html += '<div class="summary">';
    [['접수일시', _asFmtDT(t.receivedAt)], ['긴급도', t.priority],
     ['카테고리', (CAT[t.category] || {}).label || t.category],
     ['재현', t.reproduction], ['빈도', _asFreqDisplay(t.frequency, t.frequencyCount)],
     ['영향범위', t.impactScope]].forEach(function (r) {
      html += '<div><div class="k">' + _asEsc(r[0]) + '</div><div>' + _asEsc(r[1] || '-') + '</div></div>';
    });
    html += '</div>';

    html += '<h2>③ 신고 내용</h2><div style="border:1px solid #E5E7EB;padding:10px;white-space:pre-wrap">' + _asEsc(t.issueSummary || '') + '</div>';

    if ((t.activityLogs || []).length) {
      html += '<h2>④ 처리 이력</h2><table><thead><tr><th>#</th><th>일자</th><th>부서</th><th>유형</th><th>조치</th><th>소요(h)</th></tr></thead><tbody>';
      t.activityLogs.forEach(function (l) {
        var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
        html += '<tr><td>' + l.seq + '</td><td>' + _asFmtDT(l.workedAt) + '</td><td>' +
          _asEsc((DEPT_MAP[l.dept] || {}).label || l.dept) + '</td><td>' +
          _asEsc((WT[l.workType] || {}).label || l.workType) + '</td><td>' +
          _asEsc(l.actionTaken || '') + '</td><td style="text-align:right">' +
          (l.durationH || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    if ((t.parts || []).length) {
      html += '<h2>⑤ 사용 부품</h2><table><thead><tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th><th>청구</th></tr></thead><tbody>';
      var grand = 0;
      t.parts.forEach(function (p) {
        var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
        grand += amt;
        html += '<tr><td>' + _asEsc(p.itemName) + '</td><td style="text-align:right">' + (p.qty || 0) + '</td><td style="text-align:right">' +
          Number(p.unitPrice || 0).toLocaleString() + '</td><td style="text-align:right">' +
          amt.toLocaleString() + '</td><td>' + _asEsc(p.billing) + '</td></tr>';
      });
      html += '<tr><th colspan="3" style="text-align:right">합계</th><th style="text-align:right">' + grand.toLocaleString() + '</th><th></th></tr></tbody></table>';
    }

    html += '<h2>⑥ 근본원인 / 재발방지</h2>';
    html += '<div><strong>RCA:</strong> ' + _asEsc(t.rca || '-') + '</div>';
    html += '<div style="margin-top:6px"><strong>재발방지:</strong> ' + _asEsc(t.prevention || '-') + '</div>';
    html += '<div style="margin-top:6px"><strong>장비 최종 상태:</strong> ' + _asEsc(t.finalEquipStatus || '-') + ' · <strong>모니터링:</strong> ' + _asEsc(t.monitoring || '-') + '</div>';

    var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
    var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
    html += '<h2>⑦ 서명</h2><div class="sig">';
    html += '<div><div class="k">현장 담당자 (고객)</div>';
    html += (cust && cust.signatureUrl) ? '<img src="' + _asEsc(cust.signatureUrl) + '">' : '<div style="height:60px;color:#9CA3AF">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700">' + _asEsc((cust && cust.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(cust && cust.signedAt) + '</div></div>';
    html += '<div><div class="k">담당 엔지니어</div>';
    html += (eng && eng.signatureUrl) ? '<img src="' + _asEsc(eng.signatureUrl) + '">' : '<div style="height:60px;color:#9CA3AF">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700">' + _asEsc((eng && eng.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(eng && eng.signedAt) + '</div></div>';
    html += '</div>';

    html += '</body></html>';

    if (w.closed) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }).catch(function (err) {
    try { w.close(); } catch (e) {}
    if (typeof showToast === 'function') showToast('미리보기 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

/* ═══ ⑥ 보고서 — PDF 인앱 미리보기 + 다운로드 + 메일 발송 ═══
 * 1) asReportPdfPreview(id): jsPDF/html2canvas로 PDF 생성 → 모달 iframe에 미리보기
 * 2) 모달 안 버튼: 📥 다운로드 / ✉️ 메일 보내기
 * 3) 메일은 to/subject/message 입력 → POST /api/as-tickets/:id/email-report
 *
 * PDF 한글: html2canvas로 비트맵 캡처 후 jsPDF에 이미지로 임베드 (폰트 임베드 우회) */

function _asReportHtmlForPdf(t, opts) {
  opts = opts || {};
  // 인쇄용과 같은 HTML 구조를 재사용하되, 인쇄 버튼 등은 제거
  var CAT = _asCats();
  var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
  var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
  var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
  var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
  var ATT_CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};

  var html = '';
  html += '<div id="asPdfRoot" style="font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;font-size:11px;color:#1F2937;padding:24px;width:794px;background:#fff;line-height:1.55">';
  html += '<h1 style="font-size:22px;border-bottom:2px solid #F59E0B;padding-bottom:8px;margin:0 0 12px 0">🛠️ A/S 작업 보고서</h1>';
  html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#6B7280;margin-bottom:14px">';
  html += '<span>접수번호 <strong style="color:#1F2937">' + _asEsc(t.ticketNo) + '</strong></span>';
  html += '<span>작성일 ' + _asFmtDate(new Date().toISOString()) + '</span>';
  html += '</div>';

  // ① 고객/장비
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">① 고객 및 장비</h2>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
  [['고객사', t.customerName], ['사이트/라인', t.siteLine], ['장비모델', t.equipmentModel],
   ['Serial No.', t.serialNo], ['장비번호', t.equipmentNo], ['수주번호', t.orderNo],
   ['보증여부', t.warrantyStatus], ['설치일', _asFmtDate(t.installDate)]
  ].forEach(function (r, i) {
    if (i % 2 === 0) html += '<tr>';
    html += '<th style="text-align:left;padding:5px 8px;background:#F9FAFB;width:14%;border:1px solid #E5E7EB;font-weight:600">' + _asEsc(r[0]) + '</th>';
    html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;width:36%">' + _asEsc(r[1] || '-') + '</td>';
    if (i % 2 === 1) html += '</tr>';
  });
  html += '</tbody></table>';

  // ② 접수
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">② 접수 정보</h2>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
  [['접수일시', _asFmtDT(t.receivedAt)], ['긴급도', t.priority],
   ['카테고리', (CAT[t.category] || {}).label || t.category || '-'],
   ['재현', _asEnumLabel('AS_REPRODUCTION', t.reproduction)],
   ['빈도', _asFreqDisplay(t.frequency, t.frequencyCount)],
   ['영향범위', t.impactScope]
  ].forEach(function (r, i) {
    if (i % 2 === 0) html += '<tr>';
    html += '<th style="text-align:left;padding:5px 8px;background:#F9FAFB;width:14%;border:1px solid #E5E7EB;font-weight:600">' + _asEsc(r[0]) + '</th>';
    html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;width:36%">' + _asEsc(r[1] || '-') + '</td>';
    if (i % 2 === 1) html += '</tr>';
  });
  html += '</tbody></table>';

  // ③ 신고
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">③ 고객 신고 내용</h2>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px;white-space:pre-wrap;background:#fff">' + _asEsc(t.issueSummary || '-') + '</div>';
  if (t.initialAnalysis) {
    html += '<div style="margin-top:6px;border:1px solid #E5E7EB;padding:8px;background:#FAFAFA;font-size:11px"><strong>1차 분석:</strong> ' + _asEsc(t.initialAnalysis) + '</div>';
  }

  // ④ 처리이력
  if ((t.activityLogs || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">④ 처리 이력</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
    ['#', '일자', '부서', '유형', '조치', '소요(h)'].forEach(function (c) {
      html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
    });
    html += '</tr></thead><tbody>';
    t.activityLogs.forEach(function (l) {
      html += '<tr>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + l.seq + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asFmtDT(l.workedAt) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((DEPT_MAP[l.dept] || {}).label || l.dept) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((WT[l.workType] || {}).label || l.workType) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(l.actionTaken || '') + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + (l.durationH || 0) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  // ⑤ 사용 부품
  if ((t.parts || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑤ 사용 부품 / 소모품</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
    ['품목', 'Part No', '수량', '단가', '금액', '청구'].forEach(function (c) {
      html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
    });
    html += '</tr></thead><tbody>';
    var grand = 0;
    t.parts.forEach(function (p) {
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      grand += amt;
      html += '<tr>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(p.itemName) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(p.partNo || '-') + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + (p.qty || 0) + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + Number(p.unitPrice || 0).toLocaleString() + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px;text-align:right">' + amt.toLocaleString() + '</td>';
      html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((BILL[p.billing] || {}).label || p.billing) + '</td>';
      html += '</tr>';
    });
    html += '<tr><th colspan="4" style="border:1px solid #E5E7EB;padding:5px 8px;text-align:right;background:#F9FAFB">합계</th>';
    html += '<th style="border:1px solid #E5E7EB;padding:5px 8px;text-align:right;background:#F9FAFB">' + grand.toLocaleString() + '</th>';
    html += '<th style="border:1px solid #E5E7EB;background:#F9FAFB"></th></tr>';
    html += '</tbody></table>';
  }

  // ⑥ RCA / 재발방지
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑥ 근본원인 · 재발방지 · 최종 상태</h2>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px"><strong>근본원인 (RCA):</strong><div style="margin-top:4px;white-space:pre-wrap">' + _asEsc(t.rca || '-') + '</div></div>';
  html += '<div style="border:1px solid #E5E7EB;padding:10px;margin-top:4px"><strong>재발방지 대책:</strong><div style="margin-top:4px;white-space:pre-wrap">' + _asEsc(t.prevention || '-') + '</div></div>';
  html += '<div style="display:flex;gap:8px;margin-top:4px;font-size:11px">';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>장비 최종 상태:</strong> ' + _asEsc(t.finalEquipStatus || '-') + '</div>';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>모니터링:</strong> ' + _asEsc(t.monitoring || '-') + '</div>';
  html += '<div style="flex:1;border:1px solid #E5E7EB;padding:8px"><strong>완료분류:</strong> ' + _asEsc(t.closure || '-') + '</div>';
  html += '</div>';

  // ⑦ 첨부 자료 (사진은 작게 임베드)
  if ((t.attachments || []).length) {
    html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑦ 첨부 자료 (' + t.attachments.length + '개)</h2>';
    var photos = t.attachments.filter(_asAttIsImage);
    var others = t.attachments.filter(function (a) { return !_asAttIsImage(a); });
    if (photos.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
      photos.forEach(function (a) {
        var cat = (ATT_CAT[a.category] || {});
        html += '<div style="width:180px;border:1px solid #E5E7EB;padding:4px;background:#fff">';
        html += '<img src="' + _asEsc(a.fileUrl) + '" style="width:100%;height:120px;object-fit:contain;background:#fff;display:block">';
        html += '<div style="font-size:9px;color:#6B7280;margin-top:3px">' + _asEsc((cat.icon || '') + ' ' + (cat.label || '')) + '</div>';
        html += '<div style="font-size:10px;color:#1F2937;font-weight:600;word-break:break-all">' + _asEsc(a.fileName) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    if (others.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
      ['구분', '파일명', '메모'].forEach(function (c) {
        html += '<th style="border:1px solid #E5E7EB;padding:5px 6px;background:#F9FAFB;text-align:left;font-weight:600">' + c + '</th>';
      });
      html += '</tr></thead><tbody>';
      others.forEach(function (a) {
        var cat = (ATT_CAT[a.category] || {});
        html += '<tr>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc((cat.icon || '') + ' ' + (cat.label || '')) + '</td>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(a.fileName) + '</td>';
        html += '<td style="border:1px solid #E5E7EB;padding:4px 6px">' + _asEsc(a.note || '-') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
  }

  // ⑧ 서명 + CSAT
  var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
  var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
  html += '<h2 style="font-size:14px;background:#F3F4F6;padding:6px 10px;margin:14px 0 6px 0;border-radius:3px">⑧ 고객 확인 · 서명</h2>';
  html += '<div style="display:flex;gap:10px">';
  [['현장 담당자 (고객)', cust], ['담당 엔지니어', eng]].forEach(function (pair) {
    var s = pair[1];
    html += '<div style="flex:1;border:1px solid #E5E7EB;padding:10px;text-align:center;min-height:110px">';
    html += '<div style="font-size:10px;color:#6B7280;margin-bottom:4px">' + _asEsc(pair[0]) + '</div>';
    html += (s && s.signatureUrl)
      ? '<img src="' + _asEsc(s.signatureUrl) + '" style="max-height:60px">'
      : '<div style="height:60px;color:#9CA3AF;font-size:10px;display:flex;align-items:center;justify-content:center">(미서명)</div>';
    html += '<div style="margin-top:4px;font-weight:700;font-size:11px">' + _asEsc((s && s.signerName) || '-') + '</div>';
    html += '<div style="font-size:9px;color:#6B7280">' + _asFmtDate(s && s.signedAt) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  if (cust && (cust.csatSpeed || cust.csatQuality || cust.csatOverall || cust.comment)) {
    html += '<div style="margin-top:6px;border:1px solid #E5E7EB;padding:8px;background:#FAFAFA;font-size:11px">';
    html += '<strong>CSAT</strong> — ';
    html += '응답: ' + _asEsc((CSAT[cust.csatSpeed] || {}).label || '-') + ' · ';
    html += '품질: ' + _asEsc((CSAT[cust.csatQuality] || {}).label || '-') + ' · ';
    html += '전반: ' + _asEsc((CSAT[cust.csatOverall] || {}).label || '-');
    if (cust.comment) html += '<div style="margin-top:4px;color:#374151">"' + _asEsc(cust.comment) + '"</div>';
    html += '</div>';
  }

  html += '<div style="margin-top:18px;padding-top:8px;border-top:1px solid #E5E7EB;font-size:9px;color:#9CA3AF;text-align:center">업무 관리자 — A/S 모듈</div>';
  html += '</div>';
  return html;
}

/* 보고서 PDF를 생성해서 Blob/Base64로 반환. 미리보기·다운로드·메일에 공통 사용
 * v13.344: 글자를 그림으로 찍던 방식(뿌옇고 확대하면 번짐) → 진짜 글자(벡터) PDF.
 *   나눔고딕을 PDF 에 넣고(쓴 글자만 담김) jsPDF + autotable 로 직접 그림. 글꼴을 못 받으면 예전 그림 방식으로 */
function _asGeneratePdf(t) {
  return _asGeneratePdfVector(t).catch(function (e) {
    console.warn('[as-pdf] 벡터 PDF 실패 → 그림 방식으로', e && e.message);
    var libs = typeof wmLib === 'function' ? wmLib(['jspdf', 'html2canvas']).catch(function () {}) : Promise.resolve();
    return libs.then(function () { return _asGeneratePdfNow(t); });
  });
}

/* 한글 글꼴(나눔고딕 보통·굵게) — 처음 한 번 받아 base64 로 들고 있음 (각 2MB, 브라우저 캐시도 탐) */
var AS_PDF_FONT_URL = {
  normal: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Bold.ttf'
};
var _asPdfFontP = null;
function _asPdfFonts() {
  if (_asPdfFontP) return _asPdfFontP;
  function b64(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('글꼴을 받지 못했습니다 (' + r.status + ')');
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result).split(',')[1]); };
        fr.onerror = function () { rej(new Error('글꼴 읽기 실패')); };
        fr.readAsDataURL(blob);
      });
    });
  }
  _asPdfFontP = Promise.all([b64(AS_PDF_FONT_URL.normal), b64(AS_PDF_FONT_URL.bold)])
    .then(function (a) { return { normal: a[0], bold: a[1] }; })
    .catch(function (e) { _asPdfFontP = null; throw e; });
  return _asPdfFontP;
}

/* 사진·서명 → JPEG data URL (흰 바탕, 긴 변 1600px 이하). 못 읽으면 null (다른 곳 이미지가 막힌 경우 등) */
function _asPdfLoadImage(url) {
  return new Promise(function (resolve) {
    if (!url) return resolve(null);
    var img = new Image(), done = false;
    var fin = function (v) { if (!done) { done = true; resolve(v); } };
    if (!/^data:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return fin(null);
        var k = Math.min(1, 1600 / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        fin({ data: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height });
      } catch (e) { fin(null); }
    };
    img.onerror = function () { fin(null); };
    setTimeout(function () { fin(null); }, 10000);
    img.src = url;
  });
}

/* PDF 에 쓸 글 — 글꼴에 없는 그림 글자(이모지)는 빼고, 빈 값은 '-' */
function _asPdfTxt(v, dash) {
  var s = (v == null ? '' : String(v)).replace(/\r\n?/g, '\n')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[ \t]+\n/g, '\n').trim();
  return s || (dash === false ? '' : '-');
}
function _asHexRgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [100, 116, 139];
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function _asGeneratePdfVector(t) {
  if (typeof wmLib !== 'function') return Promise.reject(new Error('wmLib 없음'));
  var photos = (t.attachments || []).filter(_asAttIsImage);
  var sigs = (t.signatures || []);
  var imgUrls = photos.map(function (a) { return a.fileUrl; }).concat(sigs.map(function (s) { return s.signatureUrl; }));
  return Promise.all([
    wmLib('jspdf').then(function () { return wmLib('jspdfAutotable'); }),
    _asPdfFonts(),
    Promise.all(imgUrls.map(_asPdfLoadImage))
  ]).then(function (r) {
    var IMG = {};
    imgUrls.forEach(function (u, i) { if (u) IMG[u] = r[2][i]; });
    return _asBuildVectorPdf(t, r[1], IMG, photos);
  });
}

function _asBuildVectorPdf(t, F, IMG, photos) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.addFileToVFS('NanumGothic-Regular.ttf', F.normal); doc.addFont('NanumGothic-Regular.ttf', 'NG', 'normal');
  doc.addFileToVFS('NanumGothic-Bold.ttf', F.bold); doc.addFont('NanumGothic-Bold.ttf', 'NG', 'bold');
  doc.setFont('NG', 'normal');
  doc.setLineHeightFactor(1.5);

  var CAT = _asCats();
  var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
  var WT = typeof AS_WORK_TYPE !== 'undefined' ? AS_WORK_TYPE : {};
  var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
  var CSAT = typeof AS_CSAT !== 'undefined' ? AS_CSAT : {};
  var ATT_CAT = typeof AS_ATTACH_CATEGORY !== 'undefined' ? AS_ATTACH_CATEGORY : {};
  var ST = typeof AS_STATUS !== 'undefined' ? AS_STATUS : {};
  var PR = typeof AS_PRIORITY !== 'undefined' ? AS_PRIORITY : {};

  // ── 판형 · 색
  var W = 210, H = 297, M = 16, CW = W - M * 2;
  var TOP = 20, BOTTOM = H - 19;
  var INK = [15, 23, 42], SUB = [100, 116, 139], FAINT = [148, 163, 184], LINE = [226, 232, 240], SOFT = [248, 250, 252];
  var ACC = [217, 119, 6], HEAD = [30, 41, 59];
  var PT = 0.3528;   // 1pt = 0.3528mm
  var y = 0;
  var X = function (v) { return _asPdfTxt(v); };

  function font(size, bold, color) { doc.setFont('NG', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color ? color[0] : INK[0], color ? color[1] : INK[1], color ? color[2] : INK[2]); }
  function fill(c) { doc.setFillColor(c[0], c[1], c[2]); }
  function stroke(c, w) { doc.setDrawColor(c[0], c[1], c[2]); if (w != null) doc.setLineWidth(w); }
  function lh(size) { return size * PT * 1.5; }
  function newPage() { doc.addPage(); y = TOP; }
  function ensure(h) { if (y + h > BOTTOM) newPage(); }
  function fit(text, maxW) {   // 한 줄에 안 들어가면 … 로 줄임
    text = String(text);
    if (doc.getTextWidth(text) <= maxW) return text;
    while (text.length > 1 && doc.getTextWidth(text + '…') > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  // ── 첫 쪽 머리
  fill(ACC); doc.rect(0, 0, W, 2.4, 'F');
  font(8, true, ACC); doc.setCharSpace(0.6); doc.text('AFTER-SERVICE REPORT', M, 15); doc.setCharSpace(0);
  font(20, true); doc.text('A/S 작업 보고서', M, 24.5);
  font(7.5, false, SUB); doc.text('접수번호', W - M, 13.5, { align: 'right' });
  font(13, true); doc.text(X(t.ticketNo), W - M, 20, { align: 'right' });
  font(8, false, SUB); doc.text('작성일 ' + _asFmtDate(new Date().toISOString()), W - M, 25.5, { align: 'right' });
  stroke(INK, 0.5); doc.line(M, 30, W - M, 30);
  y = 35;

  // ── 요약 카드 4칸: 고객사 · 장비 · 긴급도 · 상태
  (function () {
    var gap = 3, cw = (CW - gap * 3) / 4, ch = 17;
    var st = ST[t.status] || {}, pr = PR[t.priority] || {};
    [
      { k: '고객사', v: X(t.customerName) },
      { k: '장비 모델', v: X(t.equipmentModel) },
      { k: '긴급도', v: X(pr.label || t.priority), dot: pr.color },
      { k: '진행 상태', v: X(st.label || t.status), dot: st.color }
    ].forEach(function (c, i) {
      var x = M + i * (cw + gap);
      fill(SOFT); stroke(LINE, 0.25); doc.roundedRect(x, y, cw, ch, 2, 2, 'FD');
      font(7.5, false, SUB); doc.text(c.k, x + 4, y + 5.6);
      var tx = x + 4;
      if (c.dot) { fill(_asHexRgb(c.dot)); doc.circle(x + 5.2, y + 11.2, 1.2, 'F'); tx = x + 8; }
      font(10.5, true); doc.text(fit(c.v, cw - (tx - x) - 3), tx, y + 12.4);
    });
    y += ch + 8;
  })();

  // ── 공통 조각
  var secNo = 0;
  function section(title, extra, need) {
    ensure(10.5 + (need || 14));   // 제목만 쪽 끝에 홀로 남지 않게 — 바로 뒤 내용 첫 덩어리 높이까지
    secNo++;
    font(10, true, ACC); doc.text((secNo < 10 ? '0' : '') + secNo, M, y + 4);
    font(11.5, true); doc.text(title, M + 8, y + 4);
    if (extra) { var tw = doc.getTextWidth(title); font(8, false, SUB); doc.text(extra, M + 8 + tw + 2.5, y + 4); }
    stroke(LINE, 0.3); doc.line(M, y + 7, W - M, y + 7);
    y += 10.5;
  }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  var baseTable = {
    margin: { left: M, right: M, top: TOP, bottom: H - BOTTOM },
    styles: { font: 'NG', fontStyle: 'normal', fontSize: 9, textColor: INK, cellPadding: { top: 2.1, bottom: 2.1, left: 2.8, right: 2.8 }, lineColor: LINE, lineWidth: 0, valign: 'middle', overflow: 'linebreak' },
    rowPageBreak: 'avoid'
  };
  function kv(pairs) {   // 이름·값 두 쌍씩 한 줄
    var body = [];
    for (var i = 0; i < pairs.length; i += 2) {
      var a = pairs[i], b = pairs[i + 1] || ['', ''];
      body.push([a[0], X(a[1]), b[0], b[0] ? X(b[1]) : '']);
    }
    var lab = { fontStyle: 'bold', textColor: SUB, fillColor: SOFT, cellWidth: 25, fontSize: 8.5 };
    doc.autoTable(merge(baseTable, {
      startY: y, theme: 'plain', body: body,
      columnStyles: { 0: lab, 1: { cellWidth: CW / 2 - 25 }, 2: lab, 3: { cellWidth: CW / 2 - 25 } },
      didParseCell: function (d) { d.cell.styles.lineWidth = { bottom: 0.2 }; d.cell.styles.lineColor = LINE; }
    }));
    y = doc.lastAutoTable.finalY + 7;
  }
  function grid(head, body, colStyles, foot) {
    doc.autoTable(merge(baseTable, {
      startY: y, theme: 'striped', head: [head], body: body, foot: foot ? [foot] : undefined, showFoot: 'lastPage',
      headStyles: { fillColor: HEAD, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: SOFT },
      columnStyles: colStyles || {}
    }));
    y = doc.lastAutoTable.finalY + 7;
  }
  function textBlock(label, text, tone) {   // 왼쪽 색 띠가 있는 글 상자 — 길면 다음 쪽으로 이어짐
    var size = 9.5, L = lh(size), padX = 5, padY = 3.4, labelH = label ? 5.4 : 0, first = true;
    tone = tone || ACC;
    font(size, false);
    var lines = doc.splitTextToSize(X(text), CW - padX * 2 - 1.5);
    while (lines.length) {
      var head = first ? labelH : 0;
      ensure(padY * 2 + head + L * Math.min(2, lines.length));
      var room = Math.max(1, Math.floor((BOTTOM - y - padY * 2 - head) / L));
      var chunk = lines.splice(0, room);
      var h = padY * 2 + head + L * chunk.length;
      fill(SOFT); doc.rect(M, y, CW, h, 'F');
      fill(tone); doc.rect(M, y, 1.2, h, 'F');
      var yy = y + padY;
      if (head) { font(8, true, tone); doc.text(label, M + padX, yy + 3); yy += labelH; }
      font(size, false);
      chunk.forEach(function (ln, i) { doc.text(ln, M + padX, yy + L * i + L * 0.72); });
      y += h;
      if (lines.length) newPage(); else y += 4;
      first = false;
    }
  }

  // 01 고객 및 장비
  section('고객 및 장비');
  kv([['고객사', t.customerName], ['사이트 / 라인', t.siteLine], ['장비 모델', t.equipmentModel], ['Serial No.', t.serialNo],
      ['장비 번호', t.equipmentNo], ['수주 번호', t.orderNo], ['보증 여부', t.warrantyStatus], ['설치일', _asFmtDate(t.installDate)]]);

  // 02 접수 정보
  section('접수 정보');
  kv([['접수 일시', _asFmtDT(t.receivedAt)], ['긴급도', (PR[t.priority] || {}).label || t.priority],
      ['카테고리', (CAT[t.category] || {}).label || t.category], ['재현', _asEnumLabel('AS_REPRODUCTION', t.reproduction)],
      ['발생 빈도', _asFreqDisplay(t.frequency, t.frequencyCount)], ['영향 범위', t.impactScope]]);

  // 03 고객 신고 내용
  section('고객 신고 내용');
  textBlock('', t.issueSummary, HEAD);
  if (t.initialAnalysis) textBlock('1차 분석', t.initialAnalysis, [99, 102, 241]);

  // 04 처리 이력
  if ((t.activityLogs || []).length) {
    var totalH = 0;
    var logs = t.activityLogs.map(function (l) {
      totalH += Number(l.durationH || 0);
      return [String(l.seq == null ? '' : l.seq), X(_asFmtDT(l.workedAt)), X((DEPT_MAP[l.dept] || {}).label || l.dept),
              X((WT[l.workType] || {}).label || l.workType), X(l.actionTaken), String(l.durationH || 0)];
    });
    section('처리 이력', t.activityLogs.length + '건');
    grid(['#', '일시', '부서', '유형', '조치 내용', '소요(h)'], logs,
      { 0: { cellWidth: 10, halign: 'center', textColor: SUB }, 1: { cellWidth: 34 }, 2: { cellWidth: 20 }, 3: { cellWidth: 20 }, 5: { cellWidth: 16, halign: 'right' } },
      ['', '', '', '', { content: '합계', styles: { halign: 'right' } }, { content: String(Math.round(totalH * 10) / 10), styles: { halign: 'right' } }]);
  }

  // 05 사용 부품
  if ((t.parts || []).length) {
    var grand = 0;
    var parts = t.parts.map(function (p) {
      var amt = Number(p.amount || (Number(p.qty || 0) * Number(p.unitPrice || 0)));
      grand += amt;
      return [X(p.itemName), X(p.partNo), String(p.qty || 0), Number(p.unitPrice || 0).toLocaleString(), amt.toLocaleString(), X((BILL[p.billing] || {}).label || p.billing)];
    });
    section('사용 부품 · 소모품', t.parts.length + '건');
    var R = { halign: 'right' };
    grid(['품목', 'Part No.', '수량', '단가', '금액', '청구'], parts,
      { 1: { cellWidth: 28 }, 2: { cellWidth: 13, halign: 'right' }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 24, halign: 'right' }, 5: { cellWidth: 26 } },
      [{ content: '합계', colSpan: 4, styles: R }, { content: grand.toLocaleString(), styles: R }, '']);
  }

  // 06 근본원인 · 재발방지
  section('근본원인 · 재발방지 · 최종 상태');
  textBlock('근본원인 (RCA)', t.rca, [220, 38, 38]);
  textBlock('재발방지 대책', t.prevention, [5, 150, 105]);
  kv([['장비 최종 상태', t.finalEquipStatus], ['모니터링', t.monitoring], ['완료 분류', t.closure], ['', '']]);

  // 07 첨부 자료
  if ((t.attachments || []).length) {
    section('첨부 자료', t.attachments.length + '개', photos.length ? 57 : 14);
    if (photos.length) {
      var gap = 4, cols = 3, cw = (CW - gap * (cols - 1)) / cols, ih = 44, capH = 10;
      for (var i = 0; i < photos.length; i += cols) {
        ensure(ih + capH + 3);
        photos.slice(i, i + cols).forEach(function (a, j) {
          var x = M + j * (cw + gap), im = IMG[a.fileUrl];
          fill(SOFT); stroke(LINE, 0.25); doc.roundedRect(x, y, cw, ih, 1.5, 1.5, 'FD');
          if (im) {
            var k = Math.min((cw - 3) / im.w, (ih - 3) / im.h), dw = im.w * k, dh = im.h * k;
            doc.addImage(im.data, 'JPEG', x + (cw - dw) / 2, y + (ih - dh) / 2, dw, dh, undefined, 'FAST');
          } else { font(8, false, FAINT); doc.text('이미지를 불러오지 못함', x + cw / 2, y + ih / 2, { align: 'center' }); }
          var cat = ATT_CAT[a.category] || {};
          font(7, false, SUB); doc.text(fit(X(cat.label || '사진'), cw), x, y + ih + 3.8);
          font(7.5, true); doc.text(fit(X(a.fileName), cw), x, y + ih + 7.6);
        });
        y += ih + capH + 3;
      }
    }
    var others = (t.attachments || []).filter(function (a) { return !_asAttIsImage(a); });
    if (others.length) {
      grid(['구분', '파일 이름', '메모'], others.map(function (a) { return [X((ATT_CAT[a.category] || {}).label || a.category), X(a.fileName), X(a.note)]; }),
        { 0: { cellWidth: 28 }, 2: { cellWidth: 55 } });
    }
  }

  // 08 고객 확인 · 서명
  var cust = (t.signatures || []).find(function (s) { return s.role === 'customer_field'; });
  var eng = (t.signatures || []).find(function (s) { return s.role === 'engineer'; });
  section('고객 확인 · 서명', '', 42);
  (function () {
    var gap = 6, bw = (CW - gap) / 2, bh = 40;
    [['현장 담당자 (고객)', cust], ['담당 엔지니어', eng]].forEach(function (pair, i) {
      var s = pair[1], x = M + i * (bw + gap), im = s && s.signatureUrl ? IMG[s.signatureUrl] : null;
      stroke(LINE, 0.3); doc.roundedRect(x, y, bw, bh, 2, 2, 'S');
      font(8, true, SUB); doc.text(pair[0], x + 4, y + 6);
      if (im) {
        var k = Math.min(56 / im.w, 17 / im.h), dw = im.w * k, dh = im.h * k;
        doc.addImage(im.data, 'JPEG', x + (bw - dw) / 2, y + 8.5 + (17 - dh) / 2, dw, dh, undefined, 'FAST');
      } else { font(8.5, false, FAINT); doc.text('(서명 없음)', x + bw / 2, y + 18.5, { align: 'center' }); }
      stroke(LINE, 0.3); doc.line(x + 8, y + 27.5, x + bw - 8, y + 27.5);
      font(10, true); doc.text(X(s && s.signerName), x + bw / 2, y + 32.8, { align: 'center' });
      font(7.5, false, SUB); doc.text(s && s.signedAt ? _asFmtDate(s.signedAt) : '-', x + bw / 2, y + 37, { align: 'center' });
    });
    y += bh + 6;
  })();
  if (cust && (cust.csatSpeed || cust.csatQuality || cust.csatOverall || cust.comment)) {
    var cs = function (v) { return X((CSAT[v] || {}).label || v); };
    var csat = '응답 속도  ' + cs(cust.csatSpeed) + '      품질  ' + cs(cust.csatQuality) + '      전반  ' + cs(cust.csatOverall);
    if (cust.comment) csat += '\n“' + _asPdfTxt(cust.comment) + '”';
    textBlock('고객 만족도 (CSAT)', csat, [37, 99, 235]);
  }

  // ── 쪽마다 머리 · 꼬리 (총 쪽수는 다 그린 뒤에 앎)
  var n = doc.getNumberOfPages();
  for (var pg = 1; pg <= n; pg++) {
    doc.setPage(pg);
    if (pg > 1) {
      fill(ACC); doc.rect(0, 0, W, 1.2, 'F');
      font(7.5, true, SUB); doc.text('A/S 작업 보고서', M, 11);
      font(7.5, false, SUB); doc.text(X(t.ticketNo) + '  ·  ' + X(t.customerName), W - M, 11, { align: 'right' });
      stroke(LINE, 0.25); doc.line(M, 13.5, W - M, 13.5);
    }
    stroke(LINE, 0.25); doc.line(M, H - 13, W - M, H - 13);
    font(7, false, FAINT); doc.text('업무 관리자 · A/S 작업 보고서 · ' + X(t.ticketNo), M, H - 8.5);
    font(7.5, true, SUB); doc.text(pg + ' / ' + n, W - M, H - 8.5, { align: 'right' });
  }

  doc.setProperties({ title: 'A/S 작업 보고서 ' + X(t.ticketNo), subject: X(t.customerName) + ' ' + X(t.equipmentModel), creator: '업무 관리자' });
  var fileName = (t.ticketNo || 'AS_Report') + '_' + _asFmtDate(new Date().toISOString()) + '.pdf';
  return { blob: doc.output('blob'), dataUrl: doc.output('datauristring'), fileName: fileName, pdf: doc };
}

/* 예전 방식(화면을 그림으로) — 글꼴을 못 받을 때만 */
function _asGeneratePdfNow(t) {
  return new Promise(function (resolve, reject) {
    if (!window.jspdf || !window.html2canvas) {
      reject(new Error('PDF 라이브러리(jsPDF/html2canvas)가 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도하세요.'));
      return;
    }
    // 화면 밖 컨테이너에 HTML 렌더 — 폭을 명시해서 html2canvas가 0폭으로 캡처하는 사고 방지
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;background:#fff;z-index:-1';
    holder.innerHTML = _asReportHtmlForPdf(t);
    document.body.appendChild(holder);
    var root = holder.querySelector('#asPdfRoot');

    window.html2canvas(root, { scale: 3, backgroundColor: '#ffffff', useCORS: true, allowTaint: true, logging: false, width: 794, windowWidth: 794 }).then(function (canvas) {
      try {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var pageW = pdf.internal.pageSize.getWidth();   // 210
        var pageH = pdf.internal.pageSize.getHeight();  // 297
        var margin = 8;
        var imgW = pageW - margin * 2;
        // canvas → 비율 유지 + 페이지 분할
        var imgH = canvas.height * imgW / canvas.width;
        var imgData = canvas.toDataURL('image/jpeg', 0.97);
        if (imgH <= pageH - margin * 2) {
          pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
        } else {
          // 다중 페이지 — canvas를 페이지 높이 단위로 잘라서 add
          var pageContentH = pageH - margin * 2;          // mm
          var pxPerMm = canvas.width / imgW;              // px / mm
          var pageContentPx = Math.floor(pageContentH * pxPerMm);
          var y = 0;
          while (y < canvas.height) {
            var sliceH = Math.min(pageContentPx, canvas.height - y);
            var slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = sliceH;
            slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            var sliceImg = slice.toDataURL('image/jpeg', 0.97);
            if (y > 0) pdf.addPage();
            pdf.addImage(sliceImg, 'JPEG', margin, margin, imgW, sliceH / pxPerMm);
            y += sliceH;
          }
        }
        var fileName = (t.ticketNo || 'AS_Report') + '_' + _asFmtDate(new Date().toISOString()) + '.pdf';
        var blob = pdf.output('blob');
        var dataUrl = pdf.output('datauristring');
        document.body.removeChild(holder);
        resolve({ blob: blob, dataUrl: dataUrl, fileName: fileName, pdf: pdf });
      } catch (e) {
        try { document.body.removeChild(holder); } catch (_) {}
        reject(e);
      }
    }).catch(function (e) {
      try { document.body.removeChild(holder); } catch (_) {}
      reject(e);
    });
  });
}

/* 메일 작성기 URL 빌더 — 사용자가 선택한 웹메일 서비스의 compose 화면을 직접 연다.
 * 각 서비스의 URL 파라미터 규약은 공식문서/실측 기반.
 * Naver는 body 파라미터를 일관되게 지원하지 않아 subject만 채움. */
function _asBuildComposeUrl(provider, to, subject, body) {
  var enc = encodeURIComponent;
  to = to || ''; subject = subject || ''; body = body || '';
  switch (provider) {
    case 'gmail':
      // Gmail 신규 작성: view=cm, fs=1(전체 작성창), to/su/body
      return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + enc(to) + '&su=' + enc(subject) + '&body=' + enc(body);
    case 'outlook':
      // Office 365 / Outlook on the web
      return 'https://outlook.office.com/mail/deeplink/compose?to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'outlook-live':
      // Outlook.com (개인) — Live/Hotmail 계정용
      return 'https://outlook.live.com/owa/?path=/mail/action/compose&to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'naver':
      // 네이버 메일 — 공식 compose URL은 to/subject 받음. body는 환경에 따라 다름
      return 'https://mail.naver.com/write/popup/?to=' + enc(to) + '&subject=' + enc(subject) + '&body=' + enc(body);
    case 'mailto':
    default:
      // PC 기본 메일 클라이언트 (Outlook 데스크톱/Thunderbird/Mail 등)
      return 'mailto:' + enc(to) + '?subject=' + enc(subject) + '&body=' + enc(body);
  }
}

/* ⑥ 보고서 — PDF 미리보기 모달 진입점 */
function asReportPdfPreview(ticketId) {
  return _asGuard('asPdfPreview', 'asPdfPreviewOverlay', function () { return _asBuildPdfPreview(ticketId); });
}
function _asBuildPdfPreview(ticketId) {
  if (window.wmProgress) {
    wmProgress.show({
      icon: '📄',
      title: 'PDF 보고서 생성 중',
      sub: '신고·처리이력·부품·서명·첨부 사진을 8개 섹션으로 묶고 있습니다.',
      tip: '첨부 사진이 많거나 처리이력이 길면 더 오래 걸릴 수 있습니다.'
    });
    wmProgress.autoSteps([
      '📥 접수 정보 로드',
      '🛠️ 처리이력 + 부품 집계',
      '🖼️ 첨부 사진 인라인 임베드',
      '✍️ 서명·CSAT 렌더',
      '🔤 한글 글꼴 담기',
      '📄 선명한 PDF 조립 + 쪽 나누기'
    ], 1500);
  }
  return asGetExpand(ticketId).then(function (t) {
    return _asGeneratePdf(t).then(function (out) {
      if (window.wmProgress) wmProgress.hide();
      _asRenderPdfPreviewModal(t, out);
    });
  }).catch(function (err) {
    if (window.wmProgress) wmProgress.hide();
    console.error('[asReportPdfPreview]', err);
    throw new Error('PDF 생성 실패: ' + _asErrMsg(err));   // 토스트는 _asGuard
  });
}

function _asRenderPdfPreviewModal(t, out) {
  document.querySelectorAll('#asPdfPreviewOverlay').forEach(function (el) { el.remove(); });

  var blobUrl = URL.createObjectURL(out.blob);

  var h = '<div style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;width:min(960px,98vw);max-height:96vh;display:flex;flex-direction:column;overflow:hidden;color:var(--t2);box-shadow:0 14px 50px rgba(0,0,0,0.6)">';

  // 헤더
  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--bg-i)">';
  h += '<div><div style="font-size:13px;font-weight:700">📄 A/S 보고서 PDF — ' + _asEsc(t.ticketNo) + '</div>';
  h += '<div style="font-size:10px;color:var(--t5);margin-top:2px">' + _asEsc(t.customerName || '-') + ' · ' + _asEsc(t.equipmentModel || '-') + '</div></div>';
  h += '<button onclick="_asPdfPreviewClose()" style="font-size:16px;padding:4px 10px;border:none;background:none;color:var(--t5);cursor:pointer">✕</button>';
  h += '</div>';

  // 본문 — 좌측 iframe / 우측 액션
  h += '<div style="display:flex;flex:1;overflow:hidden;min-height:520px">';
  h += '<div id="asPdfPreviewArea" style="flex:1;display:flex;flex-direction:column;background:#525659;min-width:0">';
  h += '<iframe id="asPdfPreviewFrame" src="' + blobUrl + '" style="width:100%;height:100%;border:none;background:#525659;display:block" title="PDF 미리보기"></iframe>';
  h += '</div>';

  // 우측 액션 패널
  var savedProvider = '';
  try { savedProvider = localStorage.getItem('as_mail_provider') || 'gmail'; } catch (e) { savedProvider = 'gmail'; }
  var defaultSubj = 'A/S 작업 보고서 ' + (t.ticketNo || '') + ' — ' + (t.customerName || '');
  var defaultBody = '안녕하세요,\n\nA/S 작업 보고서를 전달드립니다.\n\n• 접수번호: ' + (t.ticketNo || '') +
                    '\n• 고객사: ' + (t.customerName || '-') +
                    (t.equipmentModel ? '\n• 장비: ' + t.equipmentModel : '') +
                    '\n\n※ 첨부된 PDF 보고서를 확인 부탁드립니다.\n감사합니다.';

  h += '<div style="width:300px;border-left:1px solid var(--bd);padding:14px 16px;overflow-y:auto;background:var(--bg-i)">';

  // PDF 저장
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📥 PDF 다운로드</div>';
  h += '<button id="asPdfDownloadBtn" style="width:100%;padding:9px 12px;border:none;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;font-size:11px;font-weight:600;margin-bottom:14px">📥 PDF로 저장</button>';

  // 메일 작성기 콤보
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">✉️ 메일 작성기 열기</div>';

  // 메일 서비스 선택
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">사용할 메일 서비스</label>';
  h += '<select id="asMail_provider" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';
  [
    { v: 'gmail',        l: '📧 Gmail (웹)' },
    { v: 'outlook',      l: '📨 Outlook / Office 365 (웹)' },
    { v: 'outlook-live', l: '📨 Outlook.com / Hotmail (개인)' },
    { v: 'naver',        l: '📬 네이버 메일 (웹)' },
    { v: 'mailto',       l: '💻 PC 기본 메일 앱 (mailto:)' }
  ].forEach(function (o) {
    h += '<option value="' + o.v + '"' + (savedProvider === o.v ? ' selected' : '') + '>' + o.l + '</option>';
  });
  h += '</select>';

  // To / 제목 / 본문
  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">받는 사람 (To) * <span style="color:var(--t6);font-size:9px">— 컨택 마스터 자동완성</span></label>';
  h += '<input id="asMail_to" type="email" list="asMail_contactList" placeholder="customer@example.com" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';
  h += '<datalist id="asMail_contactList"></datalist>';

  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">제목</label>';
  h += '<input id="asMail_subject" type="text" value="' + _asEsc(defaultSubj) + '" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;box-sizing:border-box;margin-bottom:8px">';

  h += '<label style="display:block;font-size:10px;color:var(--t4);margin-bottom:3px">본문</label>';
  h += '<textarea id="asMail_message" rows="6" style="width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--t2);font-size:11px;resize:vertical;box-sizing:border-box;margin-bottom:10px">' + _asEsc(defaultBody) + '</textarea>';

  h += '<button id="asPdfMailBtn" style="width:100%;padding:9px 12px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:11px;font-weight:600">✉️ PDF 다운로드 + 작성기 열기</button>';
  h += '<div id="asMail_status" style="margin-top:8px;font-size:10px;color:var(--t5);min-height:14px;line-height:1.5"></div>';

  // 안내
  h += '<div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--bd);font-size:9px;color:var(--t6);line-height:1.6">';
  h += '<strong>📋 작동 방식</strong><br>';
  h += '1. 클릭 시 PDF가 자동 다운로드됩니다<br>';
  h += '2. 선택한 메일 서비스의 작성 창이 새 탭으로 열립니다 (To·제목·본문 자동 입력)<br>';
  h += '3. 다운로드된 PDF를 <strong>작성 창에 끌어다 놓고</strong> "보내기"를 누르세요<br>';
  h += '<br><strong style="color:var(--t5)">✨ 장점</strong> — 본인 메일 명의로 발송되어 "보낸 편지함"에 자동 보관됩니다. 서버 SMTP 설정이 필요 없습니다.<br>';
  h += '<br><span style="color:' + SEM_COLOR.warn + '">⚠ 팝업이 차단되면 브라우저 주소창 우측의 "팝업 허용"을 클릭하세요.</span>';
  h += '</div>';
  h += '</div>';
  h += '</div></div>';

  var overlay = _asOverlay('asPdfPreviewOverlay', 10004, 'background:rgba(0,0,0,0.75);padding:24px');
  overlay.innerHTML = h;
  // v13.63: backdrop 클릭 닫기 비활성화 — 메일 입력 중 실수 클릭 방지 (✕ 버튼만 닫기)

  // 컨택 마스터 자동완성 채우기 (이 ticket의 customer_name 우선)
  if (typeof asContactsSearch === 'function') {
    asContactsSearch({ customer: t.customerName || '' }).then(function (rows) {
      var listEl = document.getElementById('asMail_contactList');
      if (!listEl) return;
      var html = '';
      (rows || []).forEach(function (c) {
        if (!c.email) return;
        var label = c.email + ' — ' + (c.contactName || c.customerName || '') + (c.role ? ' (' + c.role + ')' : '');
        html += '<option value="' + _asEsc(c.email) + '">' + _asEsc(label) + '</option>';
      });
      // 같은 고객사 컨택이 없으면 전체에서 상위 20
      if (!html) {
        return asContactsSearch({ limit: 20 }).then(function (all) {
          var h2 = '';
          (all || []).forEach(function (c) {
            if (!c.email) return;
            h2 += '<option value="' + _asEsc(c.email) + '">' + _asEsc(c.customerName) + ' / ' + _asEsc(c.contactName || '') + ' (' + _asEsc(c.email) + ')</option>';
          });
          listEl.innerHTML = h2;
        });
      }
      listEl.innerHTML = html;
    }).catch(function () { /* 무시 */ });
  }

  // PDF iframe 로딩 실패/차단 감지 (CSP/구브라우저 폴백)
  (function () {
    var fr = document.getElementById('asPdfPreviewFrame');
    var area = document.getElementById('asPdfPreviewArea');
    if (!fr || !area) return;
    var loaded = false;
    fr.addEventListener('load', function () { loaded = true; });
    setTimeout(function () {
      if (loaded) return;
      // 3초 안에 load 이벤트가 안 오면 폴백 UI
      area.innerHTML =
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#cbd5e1;padding:40px;text-align:center">' +
        '<div style="font-size:60px;margin-bottom:14px">📄</div>' +
        '<div style="font-size:13px;margin-bottom:8px">브라우저 미리보기가 차단되었습니다.</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px">새 탭에서 PDF를 확인하거나, 우측 [PDF로 저장]을 사용하세요.</div>' +
        '<button id="asPdfOpenNewTab" style="padding:9px 18px;border:none;border-radius:6px;background:#3B82F6;color:#fff;cursor:pointer;font-size:12px;font-weight:600">🔗 새 탭에서 열기</button>' +
        '</div>';
      var btn = document.getElementById('asPdfOpenNewTab');
      if (btn) btn.onclick = function () { window.open(blobUrl, '_blank'); };
    }, 3000);
  })();

  // 액션 바인딩 — out을 클로저로 잡고 있어야 함
  document.getElementById('asPdfDownloadBtn').onclick = function () {
    try { out.pdf.save(out.fileName); }
    catch (e) {
      // fallback: blob 직접 저장
      var a = document.createElement('a');
      a.href = blobUrl; a.download = out.fileName; document.body.appendChild(a); a.click(); a.remove();
    }
  };

  document.getElementById('asPdfMailBtn').onclick = function () {
    var to = (document.getElementById('asMail_to').value || '').trim();
    var subject = (document.getElementById('asMail_subject').value || '').trim();
    var message = (document.getElementById('asMail_message').value || '').trim();
    var provider = (document.getElementById('asMail_provider').value || 'gmail');
    var status = document.getElementById('asMail_status');
    var btn = this;
    if (!to) { status.textContent = '⚠ 받는 사람을 입력하세요.'; status.style.color = SEM_COLOR.danger; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { status.textContent = '⚠ 올바른 이메일 형식이 아닙니다.'; status.style.color = SEM_COLOR.danger; return; }

    // 1) 선택 기억
    try { localStorage.setItem('as_mail_provider', provider); } catch (e) {}

    // 진행 모달 (짧은 작업이지만 사용자가 "뭔가 일어났다"는 신호를 받도록)
    if (window.wmProgress) {
      wmProgress.show({
        icon: '✉️',
        title: '메일 작성기 준비 중',
        sub: 'PDF를 다운로드하고 ' + ({gmail:'Gmail',outlook:'Outlook',naver:'네이버 메일','outlook-live':'Outlook.com',mailto:'기본 메일 앱'}[provider] || '메일') + ' 작성 창을 엽니다.',
        tip: '팝업이 차단되면 주소창의 팝업 허용을 눌러 주세요.'
      });
      wmProgress.autoSteps(['📥 PDF 다운로드', '🔗 작성 창 열기', '✅ 완료'], 700);
    }

    // 2) PDF 자동 다운로드 (사용자 제스처 활성 상태에서)
    try { out.pdf.save(out.fileName); }
    catch (e) {
      var a = document.createElement('a');
      a.href = blobUrl; a.download = out.fileName;
      document.body.appendChild(a); a.click(); a.remove();
    }

    // 3) 메일 작성기 URL 구성
    var composeUrl = _asBuildComposeUrl(provider, to, subject, message);

    // 4) 새 탭에서 작성기 열기 (팝업 차단 회피 위해 같은 클릭 안에서)
    var win = window.open(composeUrl, '_blank');
    setTimeout(function () { if (window.wmProgress) wmProgress.hide(); }, 1500);
    if (!win || win.closed || typeof win.closed === 'undefined') {
      status.innerHTML = '⚠ 팝업이 차단되었습니다. 주소창 우측의 "팝업 허용"을 누르고 다시 시도하거나 <a href="' + _asEsc(composeUrl) + '" target="_blank" style="color:#3B82F6">여기를 클릭</a>하세요.';
      status.style.color = SEM_COLOR.warn;
      return;
    }

    var label = {
      gmail: 'Gmail', outlook: 'Outlook', 'outlook-live': 'Outlook.com', naver: '네이버 메일', mailto: 'PC 기본 메일 앱'
    }[provider] || '메일 작성기';
    status.innerHTML = '✅ PDF 다운로드 + ' + label + ' 작성기 열림.<br><strong style="color:' + SEM_COLOR.ok + '">다운로드된 PDF를 작성 창에 끌어다 놓고 보내기를 누르세요.</strong>';
    status.style.color = 'var(--t3)';
    if (typeof showToast === 'function') showToast('📄 PDF 다운로드 + ' + label + ' 작성기 열림');
  };

  // 모달 닫을 때 blob URL 해제
  window._asPdfPreviewClose = function () {
    try { URL.revokeObjectURL(blobUrl); } catch (e) {}
    var ov = document.getElementById('asPdfPreviewOverlay');
    if (ov) ov.remove();
    window._asPdfPreviewClose = null;
  };
}
