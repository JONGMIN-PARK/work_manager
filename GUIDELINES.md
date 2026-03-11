# 업무 관리자 — 개발 가이드라인

이 문서는 프로젝트 전반에 걸친 코딩/디자인 권고 사항입니다.
어떤 환경에서든 이 프로젝트를 수정할 때 참고하세요.

---

## 1. 글자 표시 원칙

- **JS에서 `.slice()`로 텍스트를 자르지 말 것** — 셀/컨테이너 안에서 글자가 최대한 보여야 함
- CSS로 오버플로 처리:
  ```css
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  ```
- 테두리/마진/패딩은 최소한으로 — 텍스트 영역을 최대한 확보
- 폰트 크기는 **10px 이상** 유지 (8px 이하 사용 금지)
- 긴 텍스트는 `title` 속성(tooltip)으로 전체 내용 확인 가능하게

---

## 2. 코딩 스타일

- **`var`** 사용 (외부 JS 파일에서 `let`/`const` 사용 금지 — 전역 스코프 보장)
- **function 선언문** 사용 (`function foo(){}` ← O, `const foo = () => {}` ← X)
- 화살표 함수는 HTML 인라인 JS에서만 허용
- `file://` 프로토콜 호환 유지 (서버 없이 동작해야 함)
- 외부 JS 로드 실패 대비 인라인 폴백 유지

---

## 3. 프로젝트 구조

| 파일 | 역할 |
|------|------|
| `업무일지_분석기.html` | 메인 HTML + CSS + 팀관리 JS (주간분석, 아카이브, 트렌드) |
| `config.js` | 상수/설정 (테마, 색상, 업무분장 코드, AI 설정) |
| `settings.js` | 팀원 그룹, 별칭, localStorage 래퍼 |
| `order.js` | 수주번호 ↔ 수주명 매핑 |
| `project-data.js` | IndexedDB CRUD, 프로젝트/마일스톤/이벤트 데이터, 유틸 함수 |
| `calendar.js` | 달력 뷰 (월간/주간, 이벤트 등록, 드래그, ICS 가져오기) |
| `timeline.js` | 타임라인/간트 뷰 (프로젝트 등록, 바 드래그, 의존관계 화살표) |
| `dashboard.js` | 대시보드 위젯 (상태 카드, 리소스맵, AI 인사이트) |

---

## 4. 데이터 구조

### IndexedDB (`WorkAnalyzerDB` v3)

| 스토어 | keyPath | 인덱스 | 용도 |
|--------|---------|--------|------|
| `weeks` | `id` | — | 주간 업무 아카이브 |
| `projects` | `id` | `orderNo`, `status` | 프로젝트 |
| `milestones` | `id` | `projectId` | 마일스톤 |
| `events` | `id` | `startDate` | 일정/이벤트 |
| `progressHistory` | `id` | `projectId`, `date` | 진척률 히스토리 |

### 팀 관리 데이터 (aD 배열)
```
{date: "YYYYMMDD", name, orderNo, hours, taskType, abbr, content}
```

### 프로젝트 데이터
```
{id, orderNo, name, startDate: "YYYY-MM-DD", endDate, status, progress,
 estimatedHours, assignees: [], dependencies: [], color, memo}
```

### 공통 연결 키
- `orderNo` — 수주번호로 팀 업무 ↔ 프로젝트 연결
- `name` ↔ `assignees` — 팀원명으로 연결
- 날짜 형식 주의: 팀 측 `YYYYMMDD`, 프로젝트 측 `YYYY-MM-DD`

---

## 5. 날짜 처리

- **타임존 안전**: `localDate()`, `dateToStr(d)` 헬퍼 사용
- `toISOString().slice(0,10)` 직접 사용 금지 (UTC 기준이라 한국 시간과 다를 수 있음)
- 팀 측 ↔ 프로젝트 측 날짜 변환 시:
  - `YYYYMMDD` → `YYYY-MM-DD`: `d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)`
  - `YYYY-MM-DD` → `YYYYMMDD`: `d.replace(/-/g,'')`

---

## 6. UI 패턴

- **토스트 알림**: `showToast(msg, type)` — type: `undefined`(성공), `'error'`, `'warn'`
- **모달**: `position:fixed;inset:0;z-index:9999` + 배경 클릭 닫기
- **사이드 패널**: `position:fixed;right:0` + `animation:slideIn .2s ease`
- **빈 상태**: 데이터 없을 때 안내 메시지 + 등록 버튼 표시
- **2단 탭**: `setPage('team'|'project')` → `setMode('weekly'|'archive'|...)`

---

## 7. 브라우저 호환

- 외부 라이브러리: Chart.js 4.x, SheetJS (xlsx)
- ES5+ 문법 (외부 JS), ES6 허용 (HTML 인라인 JS)
- `file://` 프로토콜 대응: 모든 외부 JS에 `onerror` 폴백 정의
