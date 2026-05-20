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

### Phase 8: 개별 계정 주기적 백업
- [ ] Phase 8-1: 사용자별 백업 스크립트 (backup-db.js → user_id 필터 + 연관 데이터 포함)
- [ ] Phase 8-2: 자동 스케줄러 (매일 02:00 UTC, 활성 사용자별 자동 백업)
- [ ] Phase 8-3: 백업 다운로드 API (GET /api/backups/mine, download, POST restore)
- [ ] Phase 8-4: 외부 스토리지 연동 (Supabase Storage 또는 S3/Backblaze B2)
- [ ] 프론트엔드 백업 관리 UI (내 백업 목록, 다운로드, 복원)
- [ ] 증분 백업 지원 (last_backup_at 기준 변경분만)
- [ ] 백업 보존 정책 (30일 자동 정리)

### 기타
- [ ] API 엔드포인트 테스트 코드 작성
- [ ] 에러 로깅 체계 (Sentry 등)
- [ ] 사용자 가이드/매뉴얼

---

## 텔레그램 추가 기능 (2026-05-21 작업 예정)

### 🔥 다음 라운드 우선 — 안전 3건 멀티에이전트 병렬
- [ ] **/standup** — 매일 아침 봇이 "어제 한 일 / 오늘 할 일 / 블로커" 3 질문 → 답변을 standup_responses 테이블에 누적 + 팀 채팅에 요약 전송
  - 새 마이그레이션: standup_questions(daily seed), standup_responses(user_id, date, q1/q2/q3)
  - utility.js 또는 personal.js에 cmdStandup
  - 대화 상태 보관: 사용자 응답 중간 메시지를 standup_sessions(chat_id, current_q)에 저장
- [ ] **알림 DND** — `/mute 1h` / `/mute weekend` / `/mute 18-09` / `/unmute`. 긴급(P1) 예외 토글
  - notification_prefs에 dnd_start/dnd_end/dnd_weekdays/allow_critical 컬럼 추가
  - notification.service.resolveTelegramTargets에서 시간대 매칭으로 필터
  - utility.js에 cmdMute / cmdUnmute
- [ ] **/menu 인라인 메뉴** — 카테고리 버튼(내 일·일정·팀·분석·도구) 탭 트리. 명령어 외우기 부담 해소
  - help.js 옆에 menu.js 신규
  - inline_keyboard 콜백 데이터로 명령 분기
  - "🔙 뒤로" 버튼으로 메뉴 탐색

### 다음 라운드 — 그 다음 (가치 ↑)
- [ ] **음성 메모 → 업무일지** — Telegram voice 메시지 → STT(Gemini/Whisper) → cmdLog 파이프
- [ ] **2FA OTP 발송** — 로그인·중요 변경 시 텔레그램으로 6자리 OTP (telegram_links 이미 매핑됨)
- [ ] **결재 인라인 버튼** — 휴가/외근 신청 → 팀장 텔레그램 [승인][반려][조건부] → audit_log

### A/S·현장 워커 특화 (장비 보유 환경)
- [ ] 위치 공유 → 반경 N km 내 진행중 A/S 자동 목록 + 거리/이동시간 기록
- [ ] "현장 도착" / "복귀" 빠른 버튼 → 작업 시작/종료 자동 기록
- [ ] QR/바코드 스캔 → 장비 즉시 호출 (사진 분석)
- [ ] A/S 완료 시 고객 서명 링크 텔레그램 전송 → 모바일 서명 → 자동 첨부

### 개인 생산성·분석 (낮은 우선순위)
- [ ] `/note "내용"` 검색 가능한 개인 노트
- [ ] `/timer start` / `stop` — 작업 타이머 → 자동 cmdLog
- [ ] `/now` — 팀원별 현재 작업(최근 1시간 /log 기준) 한 화면
- [ ] `/expert <키워드>` — 과거 이슈/문서에서 키워드 다룬 사람 검색
- [ ] `/snapshot` — 현재 상태를 PNG/PDF 카드로 채팅 첨부
- [ ] 매 알림에 "이 알림 그만 받기" 1탭 음소거 버튼

### 큐 통합 (인프라는 v13.86에서 마련됨)
- [ ] notification.service.notify() → queueService.publish('telegram_send', ...) enqueue 전환
- [ ] QUEUE_ENABLED 환경변수 운영 활성화 결정
- [ ] console.log 점진 교체 → logger
