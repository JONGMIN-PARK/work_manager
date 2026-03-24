# 업무 관리자 — 작업 목록

## 완료된 작업 (2026-03-25)

### 체크리스트
- [x] 개요 탭에 체크리스트 기본 표시
- [x] pipelineLoadAllChecklists 서버 모드 지원
- [x] chkPut 서버 모드 flat ID 버그 수정
- [x] 항목 인라인 수정 기능
- [x] 완료 날짜 선택 (date input)
- [x] 삭제/토글 인라인 갱신 (패널 재생성 없음)

### 업무분장 코드
- [x] R(제안), B(수주), M(양산) 변경

### 모바일 최적화
- [x] apiFetch 15초 타임아웃, authInit 10초 타임아웃
- [x] auth 실패해도 _postAuthInit 실행
- [x] wrGetAll/wrCount 서버 실패 시 로컬 fallback
- [x] openDBv2 onblocked 핸들러
- [x] DB에 데이터 있으면 업로드 화면 스킵, 바로 대시보드
- [x] 로컬 IndexedDB 직접 읽기 + 서버 API fallback
- [x] limit=50000 → 전체 로드 + hours 문자열→숫자 변환
- [x] 모바일 반응형 CSS (768px, 480px 브레이크포인트)

### 스케일링 Phase 1
- [x] DB 복합 인덱스 4개 + user_id 컬럼
- [x] 집계 API (stats/summary, weekly, by-team, by-order)
- [x] COUNT(*) OVER() 제거, 페이지네이션 상한 200
- [x] 부서별 접근제어 (archives/records)

### UI/UX
- [x] 다중 파일 드래그앤드롭
- [x] 본문 전체 드롭 + 오버레이
- [x] 통계 카드 색상 구분 (blue/amber/cyan/green)
- [x] 테이블 줄무늬, 패널 그림자, 칩 선택 강조
- [x] 헤더 → "Developed by Jongmin, Park"

---

## 남은 작업

### Phase 2: 프론트엔드에서 집계 API 활용 (우선)
- [ ] 주간 분석 차트: `/api/stats/weekly` 사용으로 전환
- [ ] 요약 통계: `/api/stats/summary` 사용으로 전환
- [ ] 인원별 분포: 서버 집계 데이터 사용
- [ ] 수주별 분석: `/api/stats/by-order` 사용
- [ ] `limit=50000&all=true` 호출 제거 → stats API로 대체

### Phase 3: JS 모듈 분리
- [ ] 업무일지_분석기.html에서 기능별 JS 파일 추출
  - [ ] `weekly-analysis.js` — 주간 분석 로직
  - [ ] `chart-renderer.js` — 차트 렌더링
  - [ ] `team-selector.js` — 팀원 선택 UI
  - [ ] `filter-panel.js` — 상세 필터 UI
  - [ ] `ai-summary.js` — AI 요약/인사이트
- [ ] 인라인 스타일 → CSS 클래스 정리

### Phase 4: 캐싱
- [ ] 서버: 집계 결과 메모리 캐시 (5분 TTL)
- [ ] 클라이언트: Service Worker 정적 파일 캐싱
- [ ] API 응답 ETag/Last-Modified

### Phase 5: DB 구조 개편
- [ ] work_records 정규화 (teams, members 테이블 분리)
- [ ] weekly_summaries 집계 테이블 (미리 계산)
- [ ] work_records.user_id 필수화 (name 의존 제거)

### Phase 6: 프레임워크 도입 (장기)
- [ ] React + Vite + TypeScript 전환
- [ ] 컴포넌트 기반 UI
- [ ] 상태 관리 라이브러리 (zustand 등)

### Phase 7: 인프라
- [ ] Render Free → Starter (서버 슬립 제거)
- [ ] DB 커넥션 풀링 최적화
- [ ] CDN: 정적 파일 Cloudflare
- [ ] 모니터링/알림 설정

### 기타
- [ ] API 엔드포인트 테스트 코드 작성
- [ ] 에러 로깅 체계 (Sentry 등)
- [ ] 사용자 가이드/매뉴얼
