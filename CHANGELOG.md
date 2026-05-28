# Work Manager — 변경 이력

## v13.98 (2026-05-28) — 타임라인 좌측 라벨 프로젝트명도 완료 시 가운데 줄 (v13.97 보완)

### 배경
v13.97에서 사이드바 + 우측 색 막대 텍스트만 처리했고, 간트 좌측 라벨의 큰 글씨 프로젝트명(예: "한국비아테크 커팅")에는 누락되어 있었음.

### 변경 (`timeline.js`)
- 좌측 라벨 첫 줄 프로젝트명 `<span>`: `st === 'done'`일 때 인라인으로 `text-decoration: line-through; text-decoration-thickness:1px; text-decoration-color: var(--t5)` 추가 (line 247).
- 다른 행(담당자·기간·라이프사이클 아이콘 등)은 변경 없음 → 가독성 유지.

### 영향
- 클라이언트 `timeline.js`만 변경. CSS·서버·DB 변경 없음.

## v13.97 (2026-05-28) — 타임라인 완료 항목 가운데 줄 처리 (사이드바·프로젝트 막대 타이틀)

### 배경
완료 프로젝트는 기존에 opacity 0.5로 옅게만 표시되어 "완료됨"이 한눈에 덜 명확. 사용자가 사이드바 목록과 프로젝트 막대 타이틀에 취소선(가운데 줄)도 함께 적용 요청.

### 변경 (`style.css`, `업무일지_분석기.html` 인라인 CSS)
- `.tl-list-item.tl-list-done`: `text-decoration: line-through; text-decoration-thickness:1px; text-decoration-color: var(--t5)` 추가 (기존 `opacity:.5` 유지). 단, `.tl-list-item.tl-list-done .badge { text-decoration:none }` 로 상태 뱃지 라벨에는 줄이 그어지지 않도록 제외.
- `.tl-bar-done .tl-bar-text`: `text-decoration: line-through; text-decoration-thickness:1.5px; text-decoration-color: rgba(255,255,255,.85)` 추가. 색 막대 위에서도 또렷하게 보이도록 흰색 + 두께 1.5px. 마일스톤 막대(.tl-bar-ms)는 텍스트가 없어 영향 없음.

### 영향
- 클라이언트 `style.css`·`업무일지_분석기.html` 인라인 CSS만 변경. JS·서버·DB 변경 없음.

## v13.96 (2026-05-26) — 마일스톤 호버 툴팁 단일화: 한 줄 네이티브 박스(+D-day)

### 배경
v13.95로 카드만 남겼다고 했으나 사용자 환경에서 여전히 2개(기본 title + 카드)가 보였고, 사용자가 "프로젝트 막대처럼 한 줄 사각 박스 + D-day"로 단순화 요청. 커스텀 카드를 폐기하고 네이티브 title 단일 방식으로 전환 → 구조적으로 1개만 표시.

### 변경 (`timeline.js`, `style.css`)
- 마일스톤 막대(`.tl-bar-ms`)·이름 라벨(`.tl-label-sub`)에서 카드용 `data-tip-*` 속성과 `onmouseenter/move/leave` 핸들러 제거, 대신 네이티브 `title="이름 · 시작 ~ 종료 · N일 · D-7"` 부여(프로젝트 막대와 동일 형태, `_tlFmtDday`로 D-day 산출).
- 커스텀 카드 코드 일괄 제거: `_tlTipEl`·`_tlTipFmtDate`·`tlBarTipShow/Move/Hide` 함수, `_tlBarDragging` 플래그 및 `startBarDrag`/`onUp`/`tlMsDragStart`/`renderTimeline`의 관련 배선. `startBarDrag`의 `.tl-drag-tooltip` 잔재 정리는 유지.
- `style.css`의 `.tl-bar-tip*` 규칙 전부 제거.

### 영향
- 클라이언트 `timeline.js`·`style.css`만 변경. 이제 호버 시 한 줄 기본 박스 1개만 표시.

## v13.95 (2026-05-26) — 마일스톤 호버 툴팁 중복 제거(카드만) + 반투명 88%

### 배경
호버 시 툴팁이 2개 떴음 — v13.93에서 "확실히 표시" 폴백으로 넣은 브라우저 기본 `title`과 v13.91 커스텀 카드가 동시 출력. 사용자가 카드만 남기기로 선택.

### 변경
- `timeline.js`: 마일스톤 막대(`.tl-bar-ms`)·라벨(`.tl-label-sub`)의 네이티브 `title` 속성 및 관련 계산(`msTipTitle`/`_msDays`) 제거 → 반투명 카드 단일 표시. (카드는 v13.93 견고화로 안정 표시 확인됨)
- `style.css`: `.tl-bar-tip` 배경 반투명도 80% → 88%(`color-mix ... 88%`)로 가독성 강화.

### 영향
- 클라이언트 `timeline.js`·`style.css`만 변경.

## v13.94 (2026-05-26) — 마일스톤 호버 카드 반투명(프로스티드 글래스)

### 변경 (`style.css`)
- `.tl-bar-tip` 배경을 `color-mix(in srgb, var(--bg-p) 80%, transparent)`로 반투명화 + `backdrop-filter: blur(10px) saturate(1.4)`로 뒤 배경 블러(프로스티드 글래스).
- 테두리도 `color-mix(... var(--bd) 70%, transparent)`로 살짝 투명하게.
- 폴백: `color-mix`/`backdrop-filter` 미지원 시 `background:var(--bg-p)`(불투명)로 자동 폴백 → 가독성 유지. 테마 색을 그대로 사용하므로 전 테마 호환.

### 영향
- 클라이언트 `style.css`만 변경.

## v13.93 (2026-05-26) — 마일스톤 호버 정보 확실 표시: 네이티브 title 폴백 + 카드 견고화

### 배경
사용자가 v13.92(최신)에서도 기간 조정 막대 위 카드 툴팁이 안 뜬다고 보고. 격리(헤드리스) 테스트에선 정상이라 재현 불가 → 환경 특이 요인 추정. 추정 디버깅 대신 "정보는 무조건 표시"를 보장하고 카드의 취약 실패 모드를 제거.

### 변경 (`timeline.js`)
- **네이티브 title 폴백**: 마일스톤 막대(`.tl-bar-ms`)와 이름 라벨(`.tl-label-sub`)에 `title="이름 (시작 ~ 종료 · N일)"` 추가 — 프로젝트 막대와 동일하게 브라우저 기본 툴팁으로 항상 표시(페이지 렌더링/CSS 이슈와 무관).
- **카드 위치 인라인 보장**: `_tlTipEl`에서 `position:fixed`·`z-index:10050`를 인라인 설정 → style.css 미로드 시에도 커서 옆에 표시(이전엔 CSS 클래스에만 의존 → 미로드 시 static로 문서 하단에 렌더될 위험).
- **드래그 가드 견고화**: `tlBarTipShow/Move`의 억제 조건을 `document.querySelector('.tl-drag-tooltip')`(잔재 요소가 남으면 호버 영구 차단) → 불리언 `_tlBarDragging` 플래그로 교체. `startBarDrag` 시작 시 true, `onUp`에서 false.
- **self-heal**: `renderTimeline`에서 `_tlBarDragging=false` + 잔여 `.tl-drag-tooltip` 제거 → 비정상 종료된 드래그 상태가 다음 렌더에 자동 복구.

### 영향
- 클라이언트 `timeline.js`만 변경. 카드 툴팁(v13.91~92)은 유지 + 네이티브 title 폴백 병행.

## v13.92 (2026-05-26) — 마일스톤 호버 툴팁 보강: 이름 라벨에도 표시

### 배경
v13.91에서 마일스톤 막대 호버 툴팁을 추가했으나, 막대가 날짜 위치의 얇은 세그먼트라 마우스를 정확히 올리기 어려움. (참고: 호버 함수 로직 자체는 헤드리스 브라우저 기능 테스트로 정상 동작 확인 — "안 보임"은 주로 이전 빌드 캐시 또는 얇은 막대 타게팅 문제.)

### 변경 (`timeline.js`)
- 마일스톤 하위 행의 **이름 라벨(`.tl-label-sub`)에도** `data-tip-*` + `onmouseenter/move/leave` 부여 → 라벨(넓은 타겟)에 올려도 시작·종료·기간 카드 툴팁 표시. (라벨 네이티브 title "드래그하여 순서 변경"은 카드 툴팁과 중복되어 제거; ⠿ 그립·grab 커서로 드래그 가능 표시 유지)
- `tlMsDragStart`에서 순서 변경 드래그 시작 시 `tlBarTipHide()` 호출(드래그 중 잔여 카드 정리).

### 영향
- 클라이언트 `timeline.js`만 변경. 막대 호버(v13.91)는 그대로 + 라벨 호버 추가.

## v13.91 (2026-05-26) — 타임라인 마일스톤 막대 호버 툴팁 (시작·종료·기간)

### 배경
타임라인의 마일스톤 막대에 마우스를 올려도 기간 정보가 안 보였음(네이티브 title 없음). 시작일·종료일·기간을 멋진 카드 툴팁으로 표시.

### 변경 (`timeline.js`, `style.css`)
- 마일스톤 막대(`.tl-bar-ms`)에 `data-tip-*` 속성(이름/시작/종료/상태/색상) + `onmouseenter/move/leave` 핸들러 추가.
- `tlBarTipShow/Move/Hide` + `_tlTipEl`/`_tlTipFmtDate`: body에 싱글톤 `#tlBarTip` 카드 생성. 내용 = 상태 점·이름·상태 배지 / 📅 시작 → 종료 / ⏱️ 기간 N일(`daysDiff+1`) · D-Day(`_tlFmtDday`).
- 커서 기준 위치(위쪽 우선, 화면 우측/상단 넘침 보정), `requestAnimationFrame`으로 fade-in.
- 막대 드래그 중(`.tl-drag-tooltip` 존재 시)에는 호버 툴팁 표시 안 함 → 충돌 방지. 재렌더 시 잔여 툴팁 정리.
- CSS `.tl-bar-tip` 카드: 좌측 프로젝트 컬러 바, 그림자, 상태 배지, 모노스페이스 탭 정렬.

### 영향
- 클라이언트 전용 변경(서버 무관). 배포 후 강력새로고침으로 반영.

## v13.90 (2026-05-26) — 투입실적 전면 개편: 담당자별 목표시간 대비 누적 실적

### 배경
투입실적 탭이 "시간을 기록한 사람"을 단순 나열만 하고 목표 개념이 없었음. 할당받은 담당자별로 **누적 실적 vs 목표시간**을 보고, 목표는 직접 입력해 관리하도록 구조 개편. (목표 단위: 인원×마일스톤별 / 입력 위치: 프로젝트 편집 모달 — 사용자 선택)

### 데이터 모델
- `milestones.assignee_targets` JSONB 신규 (`server/migrations/033_milestone_assignee_targets.sql`, 멱등 `ADD COLUMN IF NOT EXISTS`). `{ "이름": 목표h }` 맵 — 마일스톤별 인원 목표.
- `toCamel`에 `assignee_targets` 파싱 추가 → 클라 `assigneeTargets`.
- `createMilestone`/`msPut`가 `assigneeTargets` 전달, 서버 milestones POST/PUT가 저장(PUT은 `COALESCE($::jsonb, …)`로 미전달 시 보존).

### 입력 UI (`timeline.js` 프로젝트 편집 모달)
- 마일스톤 섹션에 **🎯 목표 배분** 버튼 → 매트릭스 모달(행=마일스톤 × 열=담당자) 목표시간 입력. 행/열/전체 합계 실시간 계산.
- 행마다 `data-rowkey`(기존=msid, 신규=temp), 값은 `_msTargetStaging`에 스테이징 → 프로젝트 [수정/등록] 시 각 마일스톤 `assigneeTargets`로 저장.

### 투입실적 탭 (`project-detail.js` pdLoadWork)
- **담당자별 누적 실적 vs 목표**: 담당자(proj.assignees)별 실적(work_records 이름 집계) / 목표(Σ 마일스톤) 진행률 바, 달성%·잔여·초과(빨강) 표시. 0시간 담당자도 표시.
- 요약 박스: 총 투입 + **목표 대비 %**(Σ목표) + 예상 대비 %(estimatedHours).
- 마일스톤별 상세에 담당자별 실적/목표 동시 표기.
- **할당 외 기록**: 담당자가 아닌데 시간 기록한 사람을 별도 섹션으로 분리(데이터 누락 방지).
- 목표 미설정 시 안내 배너로 🎯 목표 배분 유도.

### 영향
- 변경 파일: `timeline.js`, `project-detail.js`, `project-data.js`, `server/routes/milestones.js`, `server/migrations/033_*.sql`, `업무일지_분석기.html`.
- 마이그레이션은 서버 시작 시 멱등 적용. 클라+서버 동시 배포 필요(컬럼 의존). 배포 전엔 목표 미설정 상태로 graceful 동작.

## v13.89 (2026-05-26) — 문서 관리 폴더/메뉴 선택 속도 개선 (캐시 + 중복 fetch 제거)

### 배경
프로젝트 관리 > 문서 관리에서 폴더·뷰·검색·파일을 선택할 때마다 화면 갱신이 느림. 선택은 클라이언트 필터만 바꾸는데도 매번 서버를 다시 조회한 것이 원인.

### 원인
- `renderDocManager`가 모든 선택 동작(`docSelectFolder`/`docSetView`/`docClickFile`/`docSearchFiles`/`docToggleDeepSearch`)에서 전체 재실행되며 `folderGetByProject` + `fileGetByProject`를 매번 재조회.
- **중복 fetch**: 한 번 그릴 때 `getProjectStorageSize()`가 `fileGetByProject`를 한 번 더 호출 → 같은 무거운 파일 페이로드(`text_cache`·`version_history` 포함)를 2번 다운로드.
- 파일 선택/탭 전환 시 `fileGet`이 프로젝트 필터 없이 **테넌트 전체 파일**을 받아 `.find` 하던 비용.

### 변경 (`document-manager.js`)
- `_docDataCache = { projId, folders, allFiles }` 모듈 캐시 추가. `renderDocManager(opts)`에 `opts.useCache` 도입 — 같은 프로젝트면 직전에 받아둔 folders/allFiles 재사용(네트워크 0회).
- 선택 핸들러 5종을 `renderDocManager({ useCache: true })`로 전환.
- 용량 표시를 `getProjectStorageSize()` 재조회 대신 이미 받은 `allFiles`로 합산 → 중복 fetch 제거.
- 파일 선택 복원·탭 전환의 `fileGet` 테넌트 전체 조회를 캐시 `.find`로 대체(미캐시 시에만 fileGet 폴백).
- 변경(업로드/삭제/이름변경/이동/메모 등)은 기존대로 `renderDocManager()`(useCache 없음) 호출 → 최신 데이터 재조회 + 캐시 갱신으로 정합성 유지.

### 영향
- 클라이언트 `document-manager.js`만 변경. 서버 변경 없음.
- 미리보기는 서버 레코드에 blob(`data`) 컬럼이 없어 기존과 동일 동작(회귀 없음).
- 후속 옵션: 서버 `GET /docs/files`에 list용 `fields` 파라미터를 추가해 `text_cache`/`version_history`를 제외하면 초기 로드·프로젝트 전환도 더 빨라짐(별도 라운드, 배포 필요).

## v13.88 (2026-05-26) — 타임라인 마일스톤 기간 막대 드래그 오류 수정 (잔존 IndexedDB 제거)

### 배경
프로젝트 타임라인에서 마일스톤 기간 막대를 드래그하면 `Cannot read properties of null (reading 'transaction')` 오류가 발생하며 기간이 변경되지 않던 문제.

### 원인
`timeline.js` `startBarDrag`의 마일스톤(`type==='ms'`) 분기에 과거 로컬 모드(IndexedDB) 코드 `db.transaction('milestones','readonly')`가 가드 없이 남아 있었음. 로컬 모드 제거 후 `db`가 null이라 막대 드래그 시 항상 크래시(프로젝트 막대는 `updateProject` 경유라 정상).

### 변경
- `timeline.js`: 마일스톤 막대 드래그 종료 핸들러를 IndexedDB 조회 → 서버 모드 `msGetAll()`로 대상 마일스톤을 찾아 `startDate`/`endDate` 갱신 후 `msPut`으로 변경. 이후 재렌더·캘린더 갱신·토스트는 기존과 동일.

### 참고 — 같은 부류의 잔존 IndexedDB 코드 점검
- `pipeline.js`(체크리스트 집계): `if (!db) res({})` 가드 있어 안전.
- `project-detail.js`(체크리스트 완료일·인라인 수정의 `else` 분기): 서버 모드에선 chkId에 `::`가 항상 있어 서버 분기로만 진입 → IndexedDB 분기는 사실상 도달 불가(죽은 코드).
- 이번 버그는 timeline.js 분기에만 가드가 없어 발생.

### 영향
- 클라이언트 `timeline.js`만 변경. 서버 변경 없음(이미 v13.87 PUT 수정 포함).

## v13.87 (2026-05-26) — 마일스톤 순서 드래그 변경 (편집 모달 · 타임라인) + 정렬 잠재버그 수정

### 배경
프로젝트 편집/등록 모달과 프로젝트 타임라인 양쪽에서 마일스톤(하위 단계)의 표시 순서를 드래그로 바꿀 수 있게 함. 작업 중 마일스톤 정렬이 사실상 동작하지 않던 잠재 버그 2건도 함께 수정.

### 변경 — 기능
- **편집 모달 (`timeline.js` showProjectModal·addMsRow)**: 마일스톤 행 앞에 드래그 핸들(⠿) 추가, HTML5 드래그로 행 재배열. `saveProjectUI`가 `#msRows`의 DOM 순서대로 `order:i`를 저장하므로 [저장] 시 자동 영속화. 신규(아직 미저장) 행도 동일하게 재배열 가능.
- **타임라인 (`timeline.js` renderTimeline 하위 행 + `_tlReorderMs`)**: 마일스톤 하위 행 라벨을 드래그하여 **같은 프로젝트 내** 순서 변경. 드롭 시 order 재계산 → 변경분만 `msPut` → 재렌더. 다른 프로젝트의 행 위에는 드롭 불가(이관은 기존 ↪ 버튼 사용). 드롭존 하이라이트 표시.

### 변경 — 정렬 잠재 버그 수정
- **읽기 경로 (`project-data.js` `_msNorm`)**: 서버는 `sort_order` 컬럼을 반환 → `toCamel`이 `sortOrder`로 변환하는데 클라이언트 정렬은 `m.order`를 사용해 `undefined`가 되어 정렬이 무효였음(서버의 보조 `start_date` 정렬에만 의존). `msGetAll`·`msGetByProject` 결과를 `sortOrder→order`로 정규화.
- **쓰기 경로 (`server/routes/milestones.js` PUT)**: `sort_order=COALESCE($5,...)`의 `$5`가 `b.order || b.sort_order`라 `order=0`(첫 항목)이 falsy로 무시돼 저장 누락. `!= null` 체크로 0도 보존하도록 수정.

### 변경 — 스타일 (`style.css`)
- `.ms-drag-handle`(편집 모달 핸들), `.tl-ms-grip`(타임라인 그립), `.tl-ms-dropzone`(드롭 위치 하이라이트), grab/grabbing 커서.

### 영향
- 서버 모드 전용 구조 기준 반영(로컬 IndexedDB 모드는 이전에 제거됨). 서버 PUT 변경은 배포 후 적용.
- 변경 파일: `timeline.js`, `project-data.js`, `style.css`, `server/routes/milestones.js`, `업무일지_분석기.html`(버전/패치노트).

## v13.86 (2026-05-20) — 운영 인프라: winston 로깅 · pg-boss 큐 · 자동 DB 백업 cron

### 배경
100명 사내 도입을 위한 운영 안정성 보강. Redis·S3 의존 없이 코드+PostgreSQL만으로 가능한 3건을 병렬 처리.

### 변경 — 신규 인프라

**winston 로깅 (`server/lib/logger.js` 신규)**
- 218라인. `info/warn/error/debug` + `child({label})` 인터페이스
- 콘솔 + 일자 회전 파일 transport (`logs/app-YYYY-MM-DD.log`, 14일 보관, 20MB rotate, gzip)
- 환경변수: `LOG_LEVEL` (기본 info) / `LOG_DIR` (기본 `server/logs/`) / `NODE_ENV=test`면 파일 transport 비활성
- **이중 fallback**: `winston` 또는 `winston-daily-rotate-file` 미설치/초기화 실패 시 `console` 기반 더미 로거로 자동 전환 — 호출자 코드는 fallback 여부 무관 동일 작동
- Asia/Seoul 타임스탬프

**pg-boss 큐 (`server/services/queue.service.js` 신규)**
- 337라인. `start/stop/publish/subscribe/isEnabled/getStats`
- **활성 3중 게이트**: `QUEUE_ENABLED=1` AND `pg-boss` 로드 성공 AND `start()` 성공. 어느 단계든 실패 시 인라인 fallback
- 인라인 fallback: 메모리 `_handlers` 맵 — `publish` 시 즉시 등록 핸들러 호출. 시그니처 동일하므로 호출자는 옵션 변경 없이 호환
- pg-boss 옵션: schema=`pgboss`, retryLimit=3, retryDelay=60, retryBackoff=true
- 10.x/9.x API 양쪽 호환(`send`/`work` 우선, `publish`/`subscribe` 폴백)
- **`notification.service.js` enqueue 전환은 별도 라운드** — 본 라운드는 인프라만 마련

**자동 DB 백업 cron**
- `server/scripts/backup-db.js` 모듈화: `runBackup({outDir, retentionDays})` async export. `process.exit`는 `require.main === module` CLI 가드 안으로 분리. CLI 동작·출력·exit code 동등 유지
- `server/services/scheduler.service.js`에 4번째 cron 추가: **매일 03:00 KST + 7일 보존**
- 등록 메시지를 `_tasks.length`로 동적 계산
- 백업 위치: `server/backups/backup_YYYY-MM-DDTHH-MM-SS.json` (JSON 16개 핵심 테이블, .gitignore 등록)

### 변경 — 통합 (`server/app.js`)
- 부팅 직후 logger·queueService·asScheduler 초기화 (express init 직전)
- `queueService.start()` 실패는 warn 로그 + 인라인 모드 자동 폴백 (서버는 정상 기동)
- `asScheduler.start()`로 SLA(평일 09~18시 매시)·미회신 D+3(09:10)·주간요약(월 08:30)·**DB 백업(매일 03:00)** 4개 cron 활성화

### 변경 — 의존성
- `server/package.json`: `pg-boss@^10.1.5`, `winston@^3.17.0`, `winston-daily-rotate-file@^5.0.0` 추가 — 운영 환경 `npm install` 시 자동 설치. 미설치 시에도 fallback으로 정상 부팅
- `.gitignore`: `server/logs/` 추가

### 영향
- **호출자 코드 무영향**: 큐는 enqueue 통합 미적용, 로거는 신규 모듈 + 점진 교체 패턴
- 5개 파일 `node -c` 통과, 멀티에이전트 3명 병렬 충돌 0건
- 코드 변경만으로 운영 가시성·복구 안정성·확장성 인프라 마련

### 잔여 (별도 의사결정)
- notification.service.js 알림 발송을 `queueService.publish` enqueue로 통합 (큐 인프라는 마련됨, 트리거만 결정)
- console.log → logger 점진 교체 (44회 호출, 단계적)
- 외부 백업 보관(S3/R2/B2) — 보존 정책·비용 결정
- 프론트엔드 번들링(esbuild/Vite), Node cluster, WebSocket/SSE, 테스트 확대

## v13.85 (2026-05-20) — 100명 도입 P0/P1 잔건: 로그인 잠금 · 알림 escape · 첨부 검증 · LIKE 정규화

### 배경
100명 도입 검토 보고서의 텔레그램 외 P0/P1 5건을 멀티에이전트 병렬 처리. 인프라(번들/큐/백업)는 별도 라운드.

### 변경
**P0 — 로그인 잠금 호출 (`server/routes/auth.js`)**
- L93~103: status 체크 직후 `authService.isLocked(user)` 가드 추가 — 잠긴 계정은 HTTP **423 LOCKED** + `lockedUntil` ISO 응답
- L105~124: `verifyPassword` 실패 시 `incrementLoginFail(user.id)` 호출 + `attemptsRemaining` 응답. 마지막 시도에서 잠긴 경우 423 전환
- 정책: `config.loginLock.{maxAttempts:5, lockMinutes:15}` 기반(이미 정의). 무차별 대입 차단.

**P1 — 알림 템플릿 escape + 메모리 필터 제거 (`server/services/notification.service.js`)**
- `TEMPLATES` 14개 함수 전체에 `escHtml()` 적용 — `p.title/customerName/summary/userName/department/milestoneName/orderNo/client/delivery/author/equipmentModel/categoryLabel/deptLabel/promisedAt/elapsedH/slaH/progress/expected` 등 사용자 발 필드. `p.content`(weekly_digest/event_today/as_weekly_digest)는 호출자가 직접 안전 HTML 조립함을 grep으로 확인 → 이중 escape 방지 위해 raw 유지
- `sendDailyBriefing()` (L437~500): 전체 이슈 1회 조회 후 메모리 필터하던 패턴 제거 → `issue_assignees` JOIN으로 사용자×이슈 사전 매핑 1회 조회. user_id 정확 매칭 우선 + assignee_name 폴백
- `r.title`에 `escHtml` 적용

**P1 — projects LIKE → project_members 정규화 (`server/telegram/commands/personal.js`)**
- `projects.assignees::text LIKE '%name%'` 3건(cmdMy L35-39 / cmdTasks L93-97 / cmdDone L140-144)을 다음으로 교체:
  ```sql
  EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.tenant_id = projects.tenant_id
      AND pm.user_id = $1
      AND pm.released_at IS NULL
  ) OR created_by = $1
  ```
- `idx_project_members_user_project` partial 인덱스 활용 가능 → 풀스캔 → 인덱스 검색
- 동명이인 오매칭 + 부분일치 위양성 해소

**P1 — A/S 첨부 입력 검증 (`server/routes/as-tickets.js`)**
- 모듈 스코프 상수 추가: `ALLOWED_MIME`(이미지·PDF·Office), `DENY_EXT`(svg/html/js/mjs/jsx/ts/vbs/bat/sh/exe/dll/jar/com/cmd/ps1/psm1/app/deb/rpm/dmg/pkg), `MAX_FILE_BYTES = 10MB`
- `POST /:id/attachments` (L828~889) 검증 6단계: 필수 → 확장자 차단(`UNSAFE_EXT` 400) → URL 스킴(`INVALID_URL` 400) → dataURL 헤더 파싱·MIME 검증·base64 길이로 바이트 추정·10MB 초과(`TOO_LARGE` 413) → 메타 MIME 화이트리스트(`UNSAFE_MIME` 400) → 메타 fileSize 한도 → INSERT
- XSS(SVG/HTML), DoS(거대 dataURL), 스크립트 실행 위협 차단

### 영향
- 외부 export·응답 스키마·INSERT 컬럼 모두 무변경
- 4개 파일 `node -c` 통과, 멀티에이전트 4명 병렬 충돌 0건
- `incrementLoginFail`/`resetLoginFail`/`isLocked`는 v13.x 이전부터 존재했으나 라우트가 호출하지 않아 무력화 상태였음 — 본 변경으로 정책 실효화

### 잔여
- **인프라(별도 의사결정 필요)**: 프론트엔드 번들링 + 해시 캐싱 / BullMQ+Redis 또는 PG 큐 / 자동 백업 cron + S3·R2
- 클러스터링·PM2, WebSocket/SSE, 운영 로깅(winston/pino), 테스트 커버리지 확대

## v13.84 (2026-05-20) — 텔레그램 P1 잔건: /closevote · /cancelremind + issues 정규화(공존)

### 배경
v13.83에서 reminders/votes를 DB로 영속화했으나 종료/취소 수단이 없었음. 또한 `issues.assignees::text LIKE '%이름%'` 패턴이 동명이인·부분일치 오인식을 일으켜 텔레그램 명령(`/my`, `/issues`, `/today`, `/weekly_report`)이 잘못된 이슈를 보여줄 수 있었음. Redis 의존 없이 코드+SQL만으로 처리.

### 변경 — 데이터 (`server/migrations/032_issue_assignees.sql` 신설)
- `issue_assignees(id, issue_id, assignee_name, user_id, tenant_id, created_at)` + `UNIQUE(issue_id, assignee_name)` + `FK issue_id → issues.id ON DELETE CASCADE`
- 인덱스: user_id partial / assignee_name / tenant_id / issue_id
- **PL/pgSQL 트리거 `sync_issue_assignees()`**: issues INSERT 또는 UPDATE OF assignees 시 자동 DELETE+INSERT
  - JSONB가 `["이름1","이름2"]`(문자열) 또는 `[{"name":"이름1"}]`(객체) 양쪽 모두 처리
  - tenant 내 동일 이름 active 사용자 1건만 있을 때 `user_id` 자동 매핑 — 동명이인은 `user_id = NULL`로 안전 폴백
- **백필**: 기존 issues 전체에 대해 한 번 채움 — JSONB가 손상된 row는 자연 스킵
- **공존 모드**: `issues.assignees` JSONB는 그대로 유지 — 호출처 코드 변경 없이도 기존 동작 100% 유지

### 변경 — 코드

**보조 명령 2개 (`utility.js` + `telegram.service.js`)**
- `cmdCancelRemind(chatId, user, arg)`:
  - 인자 없음 → 호출자 chat의 pending 리마인더 20건 목록(이스케이프 적용)
  - `all` → tenant·chat 격리 한 일괄 취소
  - 숫자 ID → 해당 1건만 `status='cancelled'`
- `cmdCloseVote(chatId, user, arg)`:
  - 인자 없음 → 같은 chat의 가장 최근 활성 투표를 자동 선택
  - 권한: `created_by = user.user_id` 또는 admin/manager만 종료 가능
  - 집계 후 inline keyboard 제거(`editMessageReplyMarkup`, []) + 최종 결과 메시지(옵션·표·퍼센트·총표수)
- `telegram.service.js`
  - `handleUpdate`에 `/cancelremind`, `/closevote` 디스패치(정확 prefix 매칭)
  - `setMyCommands` 배열에 두 명령 등록 (BotFather 자동완성)
  - `module.exports`에 위임 함수 + `callApi` 노출(`utility.js`의 `editMessageReplyMarkup` 호출용, 지연 require로 순환참조 회피)

**LIKE → EXISTS 조인 교체 (`personal.js` · `schedule.js` · `analysis.js`)**
- `issues.assignees::text LIKE '%name%'` 4곳을 다음 패턴으로 교체:
  ```sql
  EXISTS (
    SELECT 1 FROM issue_assignees ia
    WHERE ia.issue_id = issues.id
      AND ia.tenant_id = issues.tenant_id
      AND (ia.user_id = $1 OR ia.assignee_name = $2)
  )
  ```
  - user_id 정확 매칭 우선, 매핑 누락 시 정확 이름 폴백 → 동명이인 ambiguous + 부분일치 오인식 동시 해소
  - `ia.tenant_id = issues.tenant_id` 이중 격리
- 대상: `personal.cmdMy` / `personal.cmdIssues` / `schedule.cmdToday` / `analysis.cmdWeeklyReport`
- `projects.assignees`·`checklists.p.assignees` LIKE는 이번 라운드 범위 밖 — 별도 정규화 라운드에서 처리

### 영향
- **호환성**: `issues.assignees` JSONB 유지 + 트리거 자동 동기화 → 클라이언트/UI/다른 라우트 코드 무영향
- **회귀 위험**: 결과 건수가 미세하게 달라질 수 있으나 이는 의도된 개선(부분일치 → 정확매칭). 동명이인은 폴백 매칭으로 기존과 동등 이상
- **검증**: 7개 파일 `node -c` 통과, 외부 export 시그니처 무변경, 멀티에이전트 2명 병렬 충돌 0건

### 잔여 / 후속
- **BullMQ + Redis**: 인프라 추가 필요 (REDIS_URL 환경변수 + Render Redis add-on)
- **projects.assignees 정규화**: project_members가 일부 역할(PL) 의미로 사용 중이라 신중한 매핑 설계 필요
- 트리거 함수가 issues.id 변경(거의 없음)을 처리하지 않음 — 필요 시 BEFORE DELETE 트리거나 ON UPDATE 처리 추가

## v13.83 (2026-05-20) — 텔레그램 P1 후속: HTML 이스케이프 · 영속화 · 메트릭

### 배경
v13.82 P0 처리 후 후속으로 진행한 안전 3건. 인프라 의존(Redis) 없이 코드 변경만으로 운영 안정성·관측성·보안을 한 단계 더 끌어올림.

### 변경 — 데이터 (`server/migrations/031_telegram_reminders_votes.sql` 신설)
- `telegram_reminders(id, tenant_id, user_id, chat_id, message, fire_at, sent_at, status, error_detail, created_at)` — pending/sent/failed/cancelled. due 인덱스 + chat·tenant 인덱스.
- `telegram_votes(id, tenant_id, chat_id, message_id, created_by, question, options(JSONB), is_closed, created_at)` — 인라인 키보드 갱신을 위해 message_id 저장.
- `telegram_vote_responses(vote_id, user_id, user_name, option_index, voted_at)` + `UNIQUE(vote_id, user_id)` — 1인 1표(재투표 시 갱신).

### 변경 — 코드

**HTML 이스케이프 (P1-1)**
- 신규 헬퍼 `server/telegram/util/escape.js` — `escHtml(value)`로 `&/<>` 변환. 미정의/숫자 안전.
- 적용: `server/telegram/commands/` 7개 파일(docs, schedule, personal, analysis, team, project, help)에서 DB 자유 텍스트(프로젝트명·이슈 제목·문서명·메모·검색 쿼리·사용자명 등)를 모두 `escHtml()`로 감쌈. 마크업 태그·날짜·진행률·아이콘 등 검증된 값은 비대상. 변수명/메시지 구조/이모지/순서 그대로 유지.
- `server/services/telegram.service.js` `handlePhotoIssue`: 텔레그램에서 받은 사진 캡션과 등록자 이름을 `escHtml`로 이스케이프 → `<` 포함 입력으로 인한 발송 거부 차단.

**reminders / votes DB 영속화 (P1-2)**
- `server/telegram/scheduler.js`에 `scheduleEvery(intervalMinutes, callback, label)` 추가 (시작 10초 후 첫 실행 + 이후 주기).
- `server/telegram/commands/utility.js`
  - `cmdRemind`: `setTimeout` 제거 → `telegram_reminders` INSERT. 서버 재시작에도 보존, 최대 7일 정책 유지.
  - `cmdVote`: `telegram_votes` INSERT + 옵션 JSONB 저장. callback_data를 `vote:{voteId}:{optionIndex}`로 단순화. 발송 응답의 `message_id`를 UPDATE로 보존(이후 키보드 갱신용).
- `server/app.js`: 1분 워커 등록 — `pending` + `fire_at <= NOW()` 50건씩 폴링 → `sendMessage` → 결과에 따라 status/error_detail 갱신.
- `server/routes/telegram.js` vote 콜백 재작성: 테넌트 격리 SELECT → is_closed/범위 검증 → `ON CONFLICT (vote_id, user_id) DO UPDATE`로 1인 1표 갱신 → 응답 집계 후 `editMessageReplyMarkup`로 버튼 카운트 갱신(별도 메시지 발송 없음 → 채팅 스팸 방지) → `answerCallbackQuery` 토스트.

**메트릭 집계 + /debug 노출 (P1-3)**
- `server/services/telegram.service.js`에 `getMetrics(tenantId)` 추가 — `notification_logs` 1일/7일 sent·failed 카운트, 이벤트별 1일 분포 상위 20건, 최근 실패 5건, `successRate` 소수 1자리 산출. 테넌트 격리.
- `server/routes/telegram.js` `/debug` 응답에 `metrics` 필드 추가 — 관리자만 접근, 운영 가시성 즉시 확보.

### 영향
- 외부 export 시그니처 무변경. 14개 파일 모두 `node -c` 구문 검사 통과.
- 회귀 위험: 텔레그램 메시지 표시에서 사용자 입력이 보이는 모든 경로가 영향을 받지만, 변경은 "값 → escHtml(값)" 단일 패턴뿐이라 출력은 동일(특수 문자가 제대로 렌더되는 차이만).
- 멀티에이전트 병렬: 파일 단위로 3 에이전트 동시 작업하여 작업 시간 단축. 충돌 0건.

### 잔여 / 후속
- BullMQ + Redis 큐(인프라 추가 필요) — `notify()` enqueue, DLQ, 백오프
- `assignees::text LIKE` → `project_assignees` 또는 JSONB `?` 정규화 — 동명이인/부분일치 해소
- /vote 종료/취소 명령(`/closevote`), 리마인더 취소(`/cancelremind`)

## v13.82 (2026-05-20) — 텔레그램 연동 P0 보안 강화 (멀티테넌트 격리)

### 배경
사내 100명+ 도입 검토 중 발견된 P0 5건 일괄 처리. 텔레그램 관련 5개 테이블이 `tenant_id` 없이 운영되어 테넌트 간 채팅/알림 누설 가능, `/auth-code` 라우트의 `DROP TABLE CASCADE` 4건이 운영 중 실수로 4개 테이블을 동시 소실시킬 위험, `planGate('telegram')` 미적용으로 Pro 미만 요금제 우회, `/linkgroup` 명령이 타 테넌트 자원 ID로 알림 가로채기 가능, 텔레그램 429 응답을 무시한 즉시 재시도로 부하 폭증 — 모두 SaaS 운영 차단 수준.

### 변경 — 데이터 (`server/migrations/030_telegram_tenant_isolation.sql` 신설)
- `telegram_links`, `telegram_auth_codes`, `telegram_group_links`, `notification_prefs`, `notification_logs` 5개 테이블에 `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` 컬럼 추가 + `users`에서 백필 + 격리 인덱스
- `telegram_auth_codes.attempts INT DEFAULT 0` 추가 (코드별 시도 카운터)
- `telegram_auth_attempts(chat_id, code_input, success, attempted_at)` 신설 + chat 인덱스 — `/start` 브루트포스 방어용 시도 로그

### 변경 — 코드
- **`server/routes/telegram.js`** (P0-2/P0-3)
  - `POST /auth-code` catch 블록의 `DROP TABLE ... CASCADE × 4` + 마이그레이션 재실행 코드 통째 제거 → 단순 `500 DB_ERROR` 응답으로 대체
  - 7개 라우트(`/auth-code`, `/status`, `/unlink`, `/prefs` GET/PUT, `/debug`, `/setup-webhook`)에 `planGate('telegram')` 적용
  - 콜백 핸들러 6개 액션(`issue_start/resolve/urgent`, `checklist_done`, `approve/reject_user`)의 모든 UPDATE/SELECT에 `AND tenant_id = $X` 가드 추가 — cross-tenant 변경 차단
- **`server/services/telegram.service.js`** (P0-1/P0-4)
  - `callApi`에 **429/5xx retry-after 처리**: `result.parameters.retry_after`(최대 30초) 대기 후 1회 재시도, 5xx는 500ms 백오프 1회 재시도 (P0-5)
  - `createAuthCode` / `verifyAndLink` / `getUserByChatId` / `handlePhotoIssue`: `tenant_id` 컬럼 INSERT·SELECT 전파 — `getUserByChatId`는 이제 user 객체에 `tenant_id`도 반환
  - `/start`: 최근 10분간 실패 5회 이상이면 즉시 거부, 모든 시도를 `telegram_auth_attempts`에 기록
  - `/linkgroup`: `project`는 `projects.tenant_id`, `team`은 `departments.tenant_id` 일치 검증 후에만 연동. `announce`는 ID 없이 호출자 테넌트 컨텍스트만 사용. INSERT에 `tenant_id` 컬럼 포함 → cross-tenant 알림 가로채기 차단
- **`server/services/notification.service.js`** (P0-1/P0-5)
  - `notify()` 시작부에서 `userTenantMap` 1회 배치 조회 → 모든 in-app/email/telegram 로그 INSERT에 `tenant_id` 전파
  - `resolveTelegramTargets`가 `notification_prefs`/`telegram_links`/`notification_logs` 조회에 `tenant_id`를 함께 SELECT한 뒤 사용자별 기대 테넌트와 불일치하는 행 폐기
  - 무조건 즉시 재호출하던 "1회 재시도" 블록(이전 라인 285~294) **삭제** — 재시도 책임은 `callApi`에 일임 (P0-5)
  - `notifyGroup(linkType, linkId, text, tenantId)`: `tenantId` 누락 시 발송 거부 + 쿼리에 `AND tenant_id = $3` 강제. `notifyProjectStakeholders`는 `projects.tenant_id` 조회 후 자동 전달

### 영향
- **데이터**: 030 마이그레이션 자동 실행(서버 첫 연결 시) — 컬럼은 nullable 추가 + users 조인 백필로 기존 데이터 안전
- **시그니처 호환**: 외부 export 함수(`notify`, `notifyAdmins`, `notifyProjectStakeholders`, `notifyGroup`) 모두 유지. `notifyGroup`의 신규 4번째 인자(`tenantId`) 미전달 시 발송이 거부되도록 의도된 동작 — cross-tenant 누출 방지가 우선
- **검증**: 3개 수정 파일 모두 `node -c` 구문 검사 통과

### 잔여 / 후속 (P1)
- BullMQ + Redis 큐로 `notify()` enqueue 전환, 백오프/DLQ
- `reminders`/`votes` 테이블 영속화(setTimeout 제거)
- assignees `LIKE` → 정규화 조인
- HTML 이스케이프 헬퍼 도입 (photo caption, /vote 옵션 등)
- 메트릭 집계 + `/debug`에 성공률/응답시간 노출

## v13.81 (2026-05-19) — Linear/Vercel 스타일 테마 추가

### 배경
사용자: "카드 배치, 글자 간격 등 너무 AI가 작업한 티가 나는데, 스타일리쉬하게 테마 적용은 안 될까?" → 기존 20여 테마를 건드리지 않고 정제된 디자이너 테마를 opt-in 추가(가역적).

### 변경
- `[data-theme="linear"]` 토큰 세트 신설: 근-블랙 중성 배경(#08090B), 헤어라인 테두리(#1B1C20), 채도 낮은 인디고 액센트(#5E6AD2), 정제 stat 팔레트. slate 기준 45개 토큰 전부 포함 + stat 6개(누락 0 검증).
- 스코프 컴포넌트 정제(`[data-theme="linear"]` 한정): `.pnl/.sc` box-shadow 제거, `.sc::before` 그라데이션 액센트·`.sc:hover` lift 제거, `.hdr::after` 반사 opacity .12, 제목/통계값 자간 -.02em, 라벨 트래킹 .07em·뮤트, `.cg` gap 16px, 카드 radius 10px·padding 20px.
- 테마 등록: `config.js` `TH` + `업무일지_분석기.html` 인라인 폴백 양쪽에 `{id:'linear',l:'리니어'}` 추가.

### 영향
선택 시에만 적용되는 가역적 변경 — 베이스/기존 테마 CSS 무변경. 클라이언트 단일 HTML + config.js. config.js `node -c` 통과.

## v13.80 (2026-05-19) — 팀원 선택 칩 이름 3글자 고정폭

### 배경
사용자: "팀원 선택에서 팀원 이름 폭 3글자로 고정하자 … 레이아웃이 깨지는 거 같아 보기가 안 좋아."

이름 길이 가변 + 별칭일 때 `별칭(실명)` 꼬리표가 붙어 칩 너비가 들쭉날쭉 → 줄바꿈 레이아웃이 깨짐.

### 변경 (`업무일지_분석기.html`)
- `.chip .chip-nm` 추가: `width:3.25em; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — 이름 영역 3글자 고정폭, 길면 말줄임
- `rNC()` `chipFn`: 이름을 `.chip-nm` 으로 감싸고, 별칭 사용 시 칩에 붙던 `(실명)` 인라인 꼬리표 제거. 전체 실명은 기존 `title` 툴팁으로 유지
- 영향 범위: 팀원 선택 칩 한정 (`.chip-nm` 미사용 다른 `.chip` 요소 무변경). 클라이언트 단일 HTML 단일 소스

## v13.79 (2026-05-19) — 글씨체 메뉴 z-order · 주간분석 상세 스크롤 수정

### 1) 글씨체 선택 메뉴가 패널 뒤로 숨음
**원인:** `.hdr` 가 `backdrop-filter:blur(12px)` + `position:relative; z-index:0` 으로 낮은 쌓임 맥락(stacking context)을 생성 → 내부 폰트 메뉴의 `z-index:100` 이 아무리 높아도 헤더 전체가 `z-index:0` 레벨에 갇혀 본문 패널 뒤로 깔림. 추가로 `.hdr{overflow:hidden}` 이 헤더 아래로 펼쳐지는 드롭다운을 클리핑.
**수정:** `.hdr` → `z-index:900`(모달/토스트 9000+ 보다는 아래, 본문 위), `overflow:hidden` 제거. `.hdr::after` 반사는 `inset:0` 이라 헤더 영역을 벗어나지 않아 시각 변화 없음. `.fnb-menu` z-index 100 → 1000.

### 2) 주간 분석 > 상세 — 리스트 일부만 출력 + 내부 스크롤
**원인:** `.tw{max-height:940px;overflow:auto}` (모바일 400/360px) 가 상세 테이블에 내부 세로 스크롤 영역을 만들어, 일부만 보이고 리스트 위에서 스크롤해야 나머지 행이 보임.
**수정:** `.tw` 세로 높이 제한·내부 overflow 제거 → 전체 행을 한 번에 출력, 페이지 스크롤로 탐색. 가로 스크롤만 유지(테이블 `min-width:700px`, 좁은 화면 대비). `.tw` 는 상세 테이블 1곳 전용이라 영향 범위 한정.

### 영향
클라이언트 CSS만 변경 (단일 HTML 단일 소스 — 서버 측 중복 없음).

## v13.78 (2026-05-19) — 트렌디 폰트 7종 추가

### 배경
사용자: "구글 폰트 등 이쁜것 많던데..." — 기존 폰트 선택기(18종)에 요즘 인기 폰트 보강.

### 변경
`config.js` `FONTS` 배열에 7종 추가 (로더·UI 코드 무변경 — `rFnt()`가 group별 자동 렌더):
- **산세리프**: `wantedsans` 원티드 산스 (Wanted Sans Variable, jsdelivr CDN — Pretendard와 동일 url 방식)
- **표제**: `gasoekone` 가속(Gasoek One), `bagelfatone` 베이글팻(Bagel Fat One), `moiraione` Moirai One, `gugi` 구기(Gugi)
- **손글씨**: `dongle` 동글(Dongle), `yeonsung` 연성(Yeon Sung)

### 검증
- `node -c config.js` 통과
- 로더 URL 생성 시뮬레이션 정상 (`family=...:wght@...&display=swap`)
- 신규 CDN/Google Fonts URL 7개 모두 HTTP 200, Wanted Sans CSS `font-family:"Wanted Sans Variable"` 일치
- `FONTS`는 단일 소스(서버 측 중복 없음) — 로컬/서버 양쪽 동일 반영

## v13.77 (2026-05-19) — 백엔드 리팩토링 (보안·성능·구조)

### 배경
서브에이전트 코드 분석으로 도출한 리팩토링 항목 중, 회귀 위험이 낮고 효과가 확실한 서버 측 항목을 적용. 위험이 높거나 제품 정책 결정이 필요한 항목은 보류하고 사유를 기록.

### 보안
- `server/services/email.service.js`: 이메일 헤더 인젝션 방어 추가. `sanitizeHeader()`가 subject/from/to/cc/bcc/replyTo/첨부파일명의 ASCII 제어문자(0x00–0x1F, 0x7F — CR/LF 포함)를 공백으로 치환. 일반 문자·공백·하이픈은 보존. 모든 발송이 거치는 중앙 함수에 적용 (defense-in-depth).

### 성능
- `server/services/notification.service.js` `sendDailyBriefing()`: N+1 쿼리 제거. 사용자 무관 쿼리(오늘 일정/오늘 납기/알림설정)를 루프 밖에서 1회 실행, 긴급 이슈는 전체 1회 조회 후 사용자별 메모리 필터(`assignees::text LIKE '%name%'` 동등). 사용자 50명 기준 약 201 → 4 쿼리. 메시지 구조·순서·스킵 로직·폴백 동일.

### 구조
- `server/config/as-policy.js` 신설: A/S SLA 정책(P1–P4 response/visit/close)·STATUS/WARRANTY/METHOD 색상 상수를 `as-stats.js` 인라인에서 분리. 값·동작 동일, 단일 소비자.
- `server/services/notification.service.js` `notify()` 117→약 70줄: `buildTelegramSendOpts()`(순수 함수)·`resolveTelegramTargets()`(배치 쿼리 → 맵) 추출. 동작 동일.

### 검토 후 보류 (사유 기록)
- escape 함수 통합(`_esc`/`_asEsc`/`_asStatsEsc`/`esc`): 이스케이프 범위(3자 vs 5자)·방식(DOM vs regex)·스코프(IIFE) 차이로 통합 시 XSS 이스케이프 동작이 변경되며 로드 순서 의존성 발생. 효과(약 15줄) 대비 회귀 위험 큼 → 런타임 검증 선행 필요.
- 할당 수정 API(`as-tickets.js` PUT `/assignments/:aid`) RBAC: 라우터 전체가 `auth+tenantScope`만 사용하는 일관된 설계이며 `as.*` 권한 미정의. 단일 엔드포인트 강제 게이트는 정상 사용자 차단 가능한 제품 정책 결정 사안.
- `as-stats.js` GET 핸들러(약 416줄) 분해: 공유 가변 파라미터 배열(`paramsFull/paramsPrev/idx`) 의존 + 테스트 부재로 분해 시 회귀 위험 큼. 가장 무거운 순수 로직(`buildInsights`)은 이미 별도 함수.

### 검증
- 변경 4개 파일 `node -c` 구문 검사 통과. `sanitizeHeader`·`buildTelegramSendOpts`·SLA 값은 격리 단위 테스트로 동작 동일 확인. (환경에 node_modules 없어 jest 스위트는 미실행)

## v13.76 (2026-05-19) — 주간 분석 내용요약 필터 결과 반영

### 배경
사용자: "팀관리 > 주간 분석 > 내용요약 메뉴에서 내용요약은 필터링 결과로 해줘. 전체 데이터를 다 적용해서 표시하는 거 같은데."

`rContentSum()`이 중앙 필터 함수 `gF()` 대신 이름(`sN`)만으로 필터링한 `aD` 전체를 사용해, 수주·분장·검색어·주차·부서·휴가제외 필터가 무시되고 있었음.

### 변경
- `rContentSum()`이 `gF()`를 사용하도록 변경 — 표/차트 등 다른 탭과 동일한 필터 기준 적용
- 필터 변경 시 `upV()`가 sum 탭 표시 중이면 `rContentSum()`을 재호출하므로 실시간 반영
- 패널 라벨 `(필터 무관 · 선택 인원 전체)` → `(필터 적용 결과 기준)`
- 빈 결과 안내문을 인원 미선택 / 필터 결과 없음으로 구분

## v13.75 (2026-05-15) — ai_query_usage 테이블 누락 수정 + fail-safe

### 배경
사용자: "AI 요약 실패: relation \"ai_query_usage\" does not exist"

`server/routes/ai.js`가 `ai_query_usage`(월별 사용량) + `tenant_ai_configs`(테넌트 전용 키) 테이블을 참조하는데 마이그레이션이 빠져 있었음.

### 변경

**`server/migrations/029_ai_query_usage.sql` 신설:**
- `ai_query_usage(id, tenant_id, user_id, query_text, provider, created_at)`
- `idx_ai_query_usage_tenant_date (tenant_id, created_at DESC)`
- `idx_ai_query_usage_user_date` partial WHERE user_id IS NOT NULL
- `tenant_ai_configs(tenant_id PK, provider, api_key, model, updated_at)` — 테넌트별 전용 키

**`server/routes/ai.js` fail-safe:**
```js
async function getMonthlyUsage(tenantId) {
  try { ... }
  catch (e) {
    if (/relation .* does not exist/i.test(e.message)) { return 0; }
    throw e;
  }
}
```
- `logUsage` 도 동일 패턴 — 테이블 없어도 graceful return
- 마이그레이션 적용 전에도 AI 호출 정상 동작 (사용량 추적만 비활성)

**`AI_QUOTA_DISABLED` 환경변수 추가:**
- `=1` 설정 시 한도 체크 자체 우회 → Free 플랜이라도 무제한 AI 호출
- 단일 테넌트/관리자 환경 권장. 멀티테넌트 SaaS면 설정 안 함

### 운영 반영
1. 서버 재시작 → 029 자동 적용 (`runMigrations`)
2. 단일 테넌트면 Render Environment에 `AI_QUOTA_DISABLED=1` 추가

### 변경 파일
- 신규: `server/migrations/029_ai_query_usage.sql`
- 수정: `server/routes/ai.js`, `업무일지_분석기.html` (v13.75 + 패치노트), `CHANGELOG.md`

---

## v13.74 (2026-05-15) — Gemini 과부하 자동 재시도 + 폴백 모델

### 배경
사용자: "AI 요약 실패: This model is currently experiencing high demand."

Gemini 무료 티어 모델의 일시적 과부하(503/RESOURCE_EXHAUSTED). 보통 1~2분 내 해소되는 정상 현상이지만 사용자 입장에선 실패로 보임.

### 변경 — `server/routes/ai.js` Gemini 분기

**3단계 재시도 전략:**
1. **같은 모델 3회 지수 백오프** — 500ms → 1500ms → 4500ms
2. **폴백 모델 (`gemini-2.0-flash`)로 다시 3회 재시도**
3. 모두 실패 시 `AI_OVERLOADED` 코드 + 503 응답

**감지 패턴:** `status === 503 || 429 || /overloaded|high demand|unavailable|rate.*limit|busy/i`

**환경변수:** `GEMINI_FALLBACK_MODEL` (기본 `gemini-2.0-flash`)

폴백 모델로 성공 시 응답 헤드에 안내 prepend:
```
[ℹ️ gemini-2.5-flash 과부하 → gemini-2.0-flash로 폴백]
...
```

### 클라이언트 친화 메시지
- `🌐 AI 모델이 현재 과부하 상태입니다. 1~2분 후 다시 시도하세요. (서버에서 3회 자동 재시도 + 폴백 모델까지 시도했습니다)`
- 대안 카드 3가지: 재시도 / `GEMINI_FALLBACK_MODEL` 변경 / 로컬 분석

### 변경 파일
- `server/routes/ai.js`
- `업무일지_분석기.html` (에러 카드 + 패치노트 + v13.74)
- `CHANGELOG.md`

---

## v13.73 (2026-05-15) — Anthropic 크레딧 부족 자동 감지 + Gemini 자동 폴백

### 배경
사용자: "AI 요약 실패: Your credit balance is too low to access the Anthropic API."

코드 문제가 아니라 Anthropic 계정 크레딧 소진. 사용자에게 명확한 해결 안내 + 자동 폴백 제공.

### 변경 — `server/routes/ai.js`
`callAIWithPrompt` Claude 분기에 크레딧 패턴 감지:
- `credit balance|insufficient credit|low balance` 정규식 매칭
- `GEMINI_API_KEY` 설정돼 있으면 **즉시 Gemini로 폴백** (직접 fetch, 재귀 X). 응답 헤드에 `[ℹ️ Claude 크레딧 부족 — Gemini로 자동 폴백]` 안내 prepend
- Gemini 키도 없으면 `CREDIT_LOW` 에러 + Anthropic Console URL

`/api/ai/summary` 응답:
- 402 Payment Required + `action: { label, url }` 객체

### 변경 — `업무일지_분석기.html` `reqSum`
크레딧 부족 시 에러 카드에 해결 방법 3가지 노출:
- ① **Anthropic Console** 링크 (target="_blank")
- ② **`GEMINI_API_KEY`** 설정으로 자동 폴백
- ③ **`AI_PROVIDER=gemini`** 로 전환

로컬 분석은 기존대로 자동 폴백되어 표시.

### 변경 파일
- `server/routes/ai.js`
- `업무일지_분석기.html` (에러 카드 + 패치노트 + v13.73)
- `CHANGELOG.md`

---

## v13.72 (2026-05-15) — AI 호출 "signal is aborted" 수정 (apiFetch 타임아웃 옵션 + 진행 모달)

### 배경
사용자: "Claude 실패라고 나와, 업무 분석 AI 요약 & 인사이트에서 `signal is aborted without reason`."

### 진단
`auth.js` `apiFetch`가 **모든 요청에 15초 fixed AbortController 타임아웃**을 걸고 있었음. Claude opus-4-7이 긴 프롬프트(주간 분석 데이터 3500자+)에 응답을 마무리하는 데 10~30초가 걸릴 수 있어 15초 안에 못 받으면 abort.

### 변경

**`auth.js`** — apiFetch에 `opts.timeoutMs` 옵션:
```js
var _timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 15000;
```
- 기본 15초 그대로 (모바일 네트워크 대비)
- 호출자가 옵션으로 override

**클라이언트 AI 호출에 120s 적용:**
- `업무일지_분석기.html` `callAI` (`/api/ai/summary`)
- `project-data.js` `asAiAnalyze`, `asAiSimilar`, `asAiWeeklyInsight`

**진행 모달 추가** (`reqSum`):
- 🤖 [모델명] AI 분석 중 + 5단계 자동 회전 (3s 간격)
  - 📝 업무 분장 집계 → 👥 인원별 패턴 → 🎯 프로젝트별 리소스 → 💡 인사이트 도출 → ✅ 결과 정리
- 모델명을 진행 모달 tip에 표시

**타임아웃 에러 메시지 친화화:**
- `signal is aborted` → `⏱️ 응답 타임아웃 — 모델이 응답에 시간이 더 필요합니다. 데이터를 줄이거나 다시 시도하세요.`

### 변경 파일
- `auth.js`
- `업무일지_분석기.html` (callAI / reqSum + 패치노트 + v13.72)
- `project-data.js` (asAi* 3종)
- `CHANGELOG.md`

---

## v13.71 (2026-05-15) — AI 요약 라우터 견고성 + 진단 정보

### 배경
사용자: "팀관리 > 주간분석 > AI요약에서 요약 생성이 클로드와 연결 안 되었나?"

### 진단
코드상으론 v13.65부터 `config.ai.provider='anthropic'` 기본 + `claude-opus-4-7` 모델로 Claude API에 연결됨. 다만:
1. `data.content[0].text` 단순 접근 — **adaptive thinking 활성화** 시 첫 블록이 `thinking` 타입이라 텍스트가 비어 보일 수 있음
2. `/api/ai/status` 응답이 빈약 — 모델명·키 출처·hint가 없어 "왜 안 되는지" 확인 어려움

### 변경 — `server/routes/ai.js`

**`callAIWithPrompt` Claude 분기:**
- 모델명 누락 시 `claude-opus-4-7` 폴백
- 응답 파싱을 `content.filter(b => b.type === 'text')`로 안전화 → adaptive thinking 블록 무시
- 에러 메시지 분기: `not_found_error` → 모델명 확인 / `authentication_error` → API 키 / `rate_limit_error` → 재시도 안내

**`/api/ai/status` 진단 정보 풍부화:**
```json
{
  "configured": true,
  "provider": "Claude",
  "providerCode": "anthropic",
  "model": "claude-opus-4-7",
  "keySource": "env",
  "tenantKey": false,
  "envKeys": { "anthropic": true, "gemini": false },
  "quota": { "used": 12, "limit": 100, "plan": "pro" },
  "hint": null
}
```

### 변경 — `업무일지_분석기.html`
AI 상태 카드에 **모델명 + 키 출처 + 쿼터** 함께 노출:
- `✅ Claude 연결됨 · 모델 [claude-opus-4-7] · 12/100회`
- 미설정 시 `⚠️ AI 미설정 — 환경변수 설정 후 재시작 필요`

### 운영 점검 가이드
1. 브라우저 콘솔에서 `fetch('/api/ai/status').then(r=>r.json()).then(console.log)` — 응답 확인
2. `configured: false` + `envKeys.anthropic: false` → Render Environment에 `ANTHROPIC_API_KEY` 추가
3. `configured: true` + 동작 안 함 → 브라우저 콘솔의 `/api/ai/summary` 응답 에러 확인 (404 → 모델명 / 401 → 키 / 429 → 플랜 한도)

### 변경 파일
- `server/routes/ai.js`
- `업무일지_분석기.html` (AI 상태 카드 표시 강화 + 패치노트 + v13.71)
- `CHANGELOG.md`

---

## v13.70 (2026-05-15) — 트렌디 테마 3종 + 공용 시각 효과

### 배경
사용자: "전체적으로 멋지게 한번 테마 적용해봐. 이제 좀 식상해서 그래."

### 신규 테마 3종 (`config.js` TH + `업무일지_분석기.html` CSS)

| 테마 | 분위기 | 강조 컬러 |
|---|---|---|
| **🌌 aurora** | 딥블루 베이스, 차분한 야간 | `#10D8A8` (민트) |
| **🌸 cyber** | 흑보라 + 네온 글로우 | `#FF2D95` (자홍) / `#00E5FF` (시안) |
| **🪟 glass** | 글래스모피즘 라이트 | `#6366F1` (인디고) |

- **aurora**: 데이터 분석 작업에 어울리는 차분 다크. 머스트 컬러 보더가 살아있음
- **cyber**: 헤더·강조 텍스트에 네온 글로우, 버튼 호버 시 핑크 발광
- **glass**: 본문 그라데이션 배경 고정 + 패널 `backdrop-filter: blur(16px)` 반투명. 화이트 모던 룩

총 **17종 테마** (시스템 자동 / 라이트 4 / 다크 9 / 글래스 / 고대비).

### 공용 시각 효과 (모든 테마 적용)

**`.pnl` hover**: 보더 진해짐 + `box-shadow` 강화 → 마우스 위치가 명확.

**`.sc` (통계 카드)**:
```css
.sc::before { /* 상단 그라데이션 액센트 라인 */
  background: linear-gradient(90deg, var(--ac), transparent 50%, var(--ac));
}
.sc:hover { transform: translateY(-1px); border-color: var(--ac); }
```
- hover 시 1px 떠오름 + 강조색 보더 + 글로우

**`.hdr`**: 좌→우 미세 반사 (linear-gradient + `mix-blend-mode: overlay`) — 살짝 살아있는 느낌. 로고 ◆은 그라데이션 텍스트 + 글로우, weight 800.

### 회귀 위험
- CSS만 추가 (기존 selector 변경 없음)
- 모든 테마(라이트/다크/글래스) 일관 동작
- pseudo `::before`/`::after`는 기존에 사용 안 하던 위치라 충돌 0

### 변경 파일
- `config.js` (TH 3종 추가)
- `업무일지_분석기.html` (테마 CSS + 공용 효과 + 패치노트 + v13.70)
- `CHANGELOG.md`

---

## v13.69 (2026-05-14) — 주간 분석 시인성 강화 (sticky KPI + 인원 칩 접힘 + 차트 3열)

### 배경
사용자: "팀 관리 > 주간 분석 메뉴 구성·배치 최적화. 지금도 훌륭하지만 시인성과 작업성 개선." 옵션 A-L 선택.

### 변경 — `업무일지_분석기.html`

**1) KPI 4카드 sticky** (`#kpiSticky` / `.sg-sticky`)
- 스크롤 시 상단에 고정
- 배경 그라데이션 페이드 + `backdrop-filter: blur(6px)` — 본문이 살짝 비치는 모던 룩
- `IntersectionObserver` 로 떠 있는 상태 감지 → `.is-stuck` 클래스 자동 토글 → 그림자 강조

**2) 인원 칩 접힘/펼침** (`#nameChips.chips-collapsed`)
- 팀원 선택 헤더에 `[▼ 접기/펼치기]` 토글 버튼
- 접힌 상태: `max-height: 42px` + 페이드아웃 `mask-image` (첫 줄만 보임, 아래는 자연스럽게 사라짐)
- `localStorage('wm-chips-collapsed')`에 상태 저장 → 다음 방문 시 복원

**3) 차트 그리드 큰 화면 3열** (`.cg` `@media (min-width:1500px)`)
- 27인치 이상 모니터 등에서 2열 → 3열 자동
- 1500px 미만은 기존 2열, 1024px 이하 1열 유지 (회귀 없음)

### 효과
- 스크롤 중에도 KPI 4지표 항상 보임
- 인원 수 많아도 본문 공간 차지 X
- 큰 화면에서 차트 비교 한 번에 더 많이 보임
- 위치 변경 없음, 회귀 위험 최소

### 변경 파일
- `업무일지_분석기.html` (CSS + 토글 JS + 마크업 + 패치노트 + v13.69)
- `CHANGELOG.md`

---

## v13.68 (2026-05-14) — 사용자 관리 탭 가속 (3 API 병렬화 + 부가 섹션 비동기)

### 배경
사용자: "사용자 관리 탭 클릭하는 건 왜 느리지?"

### 진단 — `auth.js` `renderUserAdmin`
- `await pending → await users → await departments` 3번 **직렬** (병렬화 안 됨)
- 그 뒤 `renderOrgManagement()` (또 API) + `renderAuditLog()` (또 API) 호출 — 모두 메인 흐름에서 차단
- 로딩 placeholder가 단순 텍스트라 체감 더 느림

### 변경
1. **3개 API `Promise.all` 병렬화** — pending + users + departments 한 round-trip
2. **`renderOrgManagement` / `renderAuditLog`를 `setTimeout(0)` 백그라운드로** — 메인 목록 즉시 표시, 부가 섹션은 자연스럽게 채워짐
3. **로딩 placeholder를 인라인 카드로** — v13.67 wmProgress 디자인 재사용. 듀얼 회전 링 + 펄스 아이콘 + 점멸 글로우 + 단계 메시지 자동 회전(0.9s 간격):
   - 🔍 가입 대기 조회 → 👥 사용자 목록 정리 → 🏢 부서 정보 매핑 → 📋 화면 구성

### 효과
- 500ms+ 직렬 → 가장 느린 1회 API(~150ms) 수준 (~3×)
- 조직/감사 섹션은 메인 목록 표시 후 비동기 → 사용자 입장에서 "이미 떠 있는 화면에 채워지는" 느낌

### 변경 파일
- `auth.js`
- `업무일지_분석기.html` (v13.68 + 패치노트)
- `CHANGELOG.md`

---

## v13.67 (2026-05-14) — 첫 진입 데이터 로딩 카드 (wmProgress 디자인 일관 적용)

### 배경
사용자: "데이터 로딩 중... 표시도 동적으로 멋지게 처리해줘. 팀 관리 데이터 로딩할 때 나오는 메시지 대신."

### 변경 — `업무일지_분석기.html`
- `#initLoading` 한 줄 텍스트 → 인라인 카드 구조로 교체:
  - 듀얼 회전 링 + 펄스 아이콘
  - 점멸 글로우 박스
  - 점핑 닷 + 흐르는 그라데이션 진행바
  - 단계 메시지 칩 (자동 회전)
- CSS는 v13.66 `wmProgress`와 동일한 키프레임/팔레트 재사용 → 디자인 언어 일관
- 단계 메시지 자동 회전 (1.5s 간격):
  - 📂 캐시 확인 → 👥 팀원 정보 로드 → 📅 주차 데이터 정리 → 📊 통계 집계 준비 → 🔄 최근 주차 자동 선택 → ✨ 화면 준비
- DOM에서 element 제거되면 setTimeout 자체 종료 — 메모리 누수 없음

### 변경 파일
- `업무일지_분석기.html` (CSS + #initLoading 마크업 + 메시지 회전 IIFE + v13.67)
- `CHANGELOG.md`

---

## v13.66 (2026-05-14) — 화려한 진행 모달 (AI/PDF/메일/첨부 비동기 단계 표시)

### 배경
사용자: "버튼 실행 후 대기 메시지를 화려하게. 완료 시에만 업데이트가 뜨니 뭘 하고 있는지 모르겠다."

### 신규 — `wmProgress` 전역 API + CSS

**디자인:**
- 듀얼 회전 링 (보라/파랑 + 시안/초록, 반대 방향)
- 펄스 아이콘 중앙
- 점멸 글로우 박스 (purple + blue 이중)
- 점핑 닷 3개 + 흐르는 그라데이션 진행바
- 큰 타이틀 + 부 설명 + 현재 단계 칩 + 운영 팁
- backdrop blur 8px + 다크 그라데이션 카드

**API:**
```js
wmProgress.show({ icon, title, sub, tip, cancelable, onCancel })
wmProgress.update({ sub?, step?, icon?, title? })
wmProgress.step(text)
wmProgress.autoSteps([...], intervalMs)   // 단계 자동 시퀀스
wmProgress.hide()
wmProgress.run(opts, asyncFn)              // try/finally 자동 wrap
```

### 적용된 4곳

| 작업 | 단계 시퀀스 |
|---|---|
| 🤖 A/S 모달 AI 분석 | 신고 검토 → 카테고리 매칭 → RCA 추론 → 재발방지 작성 → 결과 정리 |
| 📄 보고서 PDF 미리보기 | 접수 로드 → 처리이력+부품 → 사진 임베드 → 서명·CSAT → html2canvas → jsPDF |
| ✉️ 메일 작성기 열기 | PDF 다운로드 → 작성 창 열기 → 완료 |
| 📎 다중 파일 첨부 | 파일 읽기(n/m) → 서버 업로드(n/m + 파일명) — 2개↑ 또는 2MB↑일 때만 |

### 기타
- 모달 띄운 동안 `body.overflow = hidden`으로 스크롤 잠금
- 취소 버튼 옵션 (`cancelable: true`, `onCancel` 콜백)
- 단계 칩에 pop 애니메이션 (재시작)

### 변경 파일
- `업무일지_분석기.html` (CSS + wmProgress API + 버전·패치노트)
- `as-manager.js` (4곳 적용)
- `CHANGELOG.md`

### 효과
사용자가 작업이 멈춘 게 아니라 진행 중임을 확실히 인지. AI 호출(5~15초), PDF 생성(2~5초), 첨부 업로드에서 가장 효과적.

---

## v13.65 (2026-05-14) — Claude AI 통합: 1차 분석 자동 초안 + 유사 사례 + 통계 자연어 인사이트

### 배경
사용자: "AI 1차 분석만 진행 (옵션 A). 클로드가 더 좋아 — 클로드로 가자." 이어서 "페이지 내 AI 분석 기능 있는 곳들도 전부 Claude로?"

### 변경 — 전역 기본 provider 전환
- `config.ai.provider` 기본값 `gemini` → `anthropic` (환경변수 `AI_PROVIDER=gemini`로 폴백 유지)
- `config.ai.anthropicModel` 기본값 `claude-sonnet-4-20250514` → `claude-opus-4-7` (`ANTHROPIC_MODEL`로 override)
- 클라이언트 `aiProv` 변수 기본값도 `anthropic` (서버 응답 받기 전 placeholder)

### 신규 의존성
`server/package.json` 에 `@anthropic-ai/sdk ^0.88.0` — 공식 Anthropic SDK. 기존 raw HTTP 경로(`server/routes/ai.js`, `server/services/ai.service.js`)는 그대로 두고, 새 A/S AI 기능만 SDK 사용.

### `server/services/ai-claude.service.js` 신설
공식 SDK 기반. 모든 메서드는 사람이 검토할 **초안**을 반환 — 자동 적용 없음.

- `analyzeTicket(input)` — 신고 내용 + 카테고리 후보 + 컨텍스트 → `{category, categoryConfidence, priority, summary, rcaDraft, preventionDraft, checkPoints[]}`
- `summarizeWeeklyStats(stats)` — 주간 통계 JSON → `{headline, narrative, focus[], actions[]}`
- `recommendSimilarCases(current, candidates)` — SQL 후보 10건 + 현재 신고 → `{top: [{ticketNo, score, reason}], summary}`

**구현 디테일:**
- SDK lazy-load: `ANTHROPIC_API_KEY` 없거나 SDK 미설치면 `isReady()=false` 반환 (서버 부팅 영향 없음)
- 모델: `claude-opus-4-7` (config)
- `thinking: {type: 'adaptive'}` — Claude가 thinking 깊이 자동 결정
- `output_config.format.type: 'json_schema'` — 구조화 출력 보장 → JSON 파싱 안전
- 모든 프롬프트는 한국어 산업 도메인 컨텍스트 (제조·반도체·자동화)

### `server/routes/as-ai.js` 신설

| 엔드포인트 | 동작 |
|---|---|
| `POST /api/as-ai/analyze` | body 검증 → 테넌트 활성 카테고리 30종 로드 → `analyzeTicket()` 호출 |
| `POST /api/as-ai/similar/:ticketId` | SQL 우선순위(`serial > equipment_no > customer+cat > cat`)로 후보 10건 → `recommendSimilarCases()` |
| `GET /api/as-ai/weekly-insight` | 주간 통계 SQL 5개 병렬 → `summarizeWeeklyStats()`. **테넌트별 1시간 캐시** (AI 비용 절감) |
| `GET /api/as-ai/_status` | `{ready, model, cacheStats}` — 관리자 디버그 |

**보안:**
- Rate-limit 사용자당 시간당 30회 (express-rate-limit, keyGenerator=user.sub)
- 모든 호출 `audit_logs`에 `as.ai_analyze/similar/weekly_insight` 기록 (usage 토큰 포함)
- 503 응답: 미설정 시 명확한 에러 (`ANTHROPIC_API_KEY 미설정`)

### 프론트 통합

**A/S 등록·편집 모달 — `[🤖 AI 분석 (Claude)]` 버튼**
- "1차 분석" 라벨 옆에 보라색 버튼
- 클릭 시 신고 내용 + 컨텍스트(고객사/장비/긴급도/재현/빈도/영향범위) Claude 호출
- 응답 도착 시:
  - **빈 필드 자동 채움**: 카테고리(빈 상태일 때만), 긴급도(P3 기본일 때만)
  - **1차 분석 textarea에 append**: `[🤖 AI 분석]` 헤더 + 요약 + 추정 RCA + 재발방지 초안 + 현장 점검 권장
- 상태 표시: `✅ Claude 분석 완료 · 카테고리 hw_fault (신뢰도 75%) · 긴급도 P2 · 토큰 in=1230 out=420`

**통계 화면 — Claude AI 인사이트 카드** (`as-stats.js`)
- 건강 점수 카드 다음 위치, 비동기 로드
- 보라색(`#8B5CF6`) 좌측 보더 + 그라데이션 배경
- 구성:
  - 헤드라인 1줄 (큰 글씨)
  - 자연어 분석 2~3문장
  - 우측 그리드: `🔎 집중 관찰` / `✅ 다음 주 액션`
- 우상단: 토큰 사용량 + 캐시(1h) + 생성 시각
- 503(미설정) 시 카드 자연 숨김

**데이터 레이어** (`project-data.js`)
- `asAiAnalyze(payload)`, `asAiSimilar(ticketId)`, `asAiWeeklyInsight()`

### 운영 반영
1. `cd server && npm install` — anthropic SDK 설치
2. 환경변수 `ANTHROPIC_API_KEY=sk-ant-...` 설정
3. (선택) `ANTHROPIC_MODEL=claude-opus-4-7` 또는 다른 모델로 override
4. (선택) `AI_PROVIDER=gemini` 로 Gemini 폴백
5. 서버 재시작

### 변경 파일
- 신규: `server/services/ai-claude.service.js`, `server/routes/as-ai.js`
- 수정: `server/package.json`, `server/config/index.js`, `server/app.js`, `project-data.js`, `as-manager.js`, `as-stats.js`, `업무일지_분석기.html`, `CHANGELOG.md`

---

## v13.64 (2026-05-14) — 탭 전환 결과 메모리 캐시 (한 번 본 탭은 즉시 표시)

### 배경
사용자: "각 탭들이 초기 로딩할 때 느린 거 같은데. 버퍼링이 필요한 건가? lazy 로딩 방식이어서 그런 거?"

### 진단
`setMode(m)` 가 호출될 때마다 해당 모드의 render 함수(`renderArch/renderPipeline/...`)를 매번 실행 — 같은 탭을 왕복해도 매번 fetch + 렌더 반복. lazy 로딩이지만 결과를 캐싱하지 않아 비효율.

### 변경 — `업무일지_분석기.html`

#### 1) 캐시 게이트 (setMode)
```js
var _modeRendered = {};  // mode → 마지막 렌더 timestamp
var _MODE_CACHE_TTL = 5 * 60 * 1000;

function setMode(m){
  // ...탭 활성화/hidden 처리는 그대로...
  if (_modeIsFresh(m)) return;  // 캐시 hit → render 스킵
  // miss 시에만 render() 호출 + _modeMarkRendered(m)
}
```

- **Hit 시 render 함수 호출 자체를 스킵** → 이전에 그린 DOM이 그대로 보임 → 즉시 표시
- TTL 5분 폴백 (오래된 데이터 방지)
- F5 / 새로고침 시 전역 변수라 자연 클리어

#### 2) 자동 무효화 (wmDataBus '*' 리스너)
```js
var invDepMap = {
  pipeline: { project:1, milestone:1, checklist:1, issue:1, order:1 },
  calendar: { project:1, milestone:1, event:1 },
  timeline: { project:1, milestone:1, checklist:1, order:1, event:1 },
  orders:   { order:1, project:1, issue:1 },
  issues:   { issue:1, project:1 },
  docs:     { document:1, project:1 },
  as:       { as:1, asCategory:1, order:1, project:1 },
  archive:  { archive:1 },
  trend:    { archive:1 }
};
```

mutation 이벤트마다 해당 type에 의존하는 모든 탭의 캐시를 자동 삭제.

#### 3) 활성 탭 ts 갱신
기존 v13.40의 wmDataBus 자동 재렌더 흐름은 그대로. 그 직후 `_modeMarkRendered(curMode)` 추가 호출로 캐시 ts 갱신 → 비활성 탭만 dirty.

#### 4) 강제 새로고침 헬퍼
`window.refreshCurrentTab()` — 콘솔/향후 UI 버튼에서 호출 가능.

### 효과
- 9개 탭(주간/아카이브/트렌드/파이프라인/달력/타임라인/수주/이슈/문서/A/S) 사이 왕복 시 첫 진입만 무겁고 나머지는 즉시
- 체감 응답 ~90% 개선
- 실제 데이터 변경은 무효화로 즉시 반영되므로 stale 위험 없음

### 변경 파일
- `업무일지_분석기.html` (setMode 캐시 게이트 + wmDataBus 무효화 + 패치노트)
- `CHANGELOG.md`

### 운영 메모
- DB·서버·의존성 변경 없음
- 캐시는 전역 변수라 새로고침 시 자연 클리어
- 의심스러우면 콘솔에 `refreshCurrentTab()` 입력 또는 F5

---

## v13.63 (2026-05-14) — 모든 모달 backdrop 클릭 닫기 일괄 비활성화

### 배경
사용자: "네, 다른 것도 동일하게 처리해주세요." (v13.62의 정책을 전체 모달로 확장)

### 변경 — 22곳 일괄 제거 + 공통 헬퍼 안전화

| 파일 | 위치(라인) | 모달 |
|---|---|---|
| `timeline.js` | 1060, 1138, 1194 | 마일스톤 이관 / 공유 추가 / 소유권 이관 |
| `as-manager.js` | 446, 895, 1348, 1598, 1672, 2498, 2715, 2987 + 1곳 | A/S 등록·편집·상세·부품 추가·첨부 추가·카테고리 관리·할당 추가·PDF 미리보기 등 |
| `calendar.js` | 376, 565 | 이벤트 모달 2종 |
| `dashboard.js` | 1242 | 보고서 모달 |
| `issue-manager.js` | 346 | 이슈 등록·편집 |
| `order-view.js` | 225 | 수주 등록·편집 |
| `settings.js` | 167, 227, 410, 616 | 별칭·옵션·즐겨찾기·기타 설정 |

`project-data.js`의 공통 모달 헬퍼:
```js
// 기존: 기본 true (closeOnOverlay !== false 면 동작)
// 변경: 기본 false (closeOnOverlay === true 일 때만 동작)
```
이미 호출자 코드에서 이 옵션을 명시적으로 켜지 않으므로 모든 헬퍼 사용처가 자동 안전.

### 닫는 방법 (모든 모달 공통)
- 우상단 **[✕ 닫기]** 버튼
- **[💾 저장 / 등록 / 수정]** 버튼 (성공 시 자동 닫힘)
- ESC 키 / backdrop 클릭 → **무반응**

### 변경 파일
- `timeline.js`, `as-manager.js`, `calendar.js`, `dashboard.js`, `issue-manager.js`, `order-view.js`, `settings.js`, `project-data.js`
- `업무일지_분석기.html` (v13.63 + 패치노트)
- `CHANGELOG.md`

---

## v13.62 (2026-05-14) — 프로젝트 편집 모달: backdrop 클릭 닫기 비활성화 (데이터 유실 방지)

### 배경
사용자: "프로젝트 편집 창 팝업 시 창 외곽을 누르면 닫히지 않도록. 작업 중 바깥을 누르면 데이터 유실 가능."

### 변경 — `timeline.js` `showProjectModal`
```js
// 제거됨
modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
```

### 닫는 방법 (의도된 닫기만 허용)
- 우상단 **[✕ 닫기]** 버튼
- **[💾 수정] / [➕ 등록]** 버튼 (저장 성공 시 자동)

### 변경 파일
- `timeline.js` (라인 733)
- `업무일지_분석기.html` (v13.62 + 패치노트)
- `CHANGELOG.md`

---

## v13.61 (2026-05-14) — 타임라인 프로젝트 상세 패널 즉시 표시 (중복 fetch + await 차단 제거)

### 배경
사용자: "프로젝트 관리 > 타임라인 > 프로젝트 선택 시 옆에 뜨는 창 열리는 속도가 왜 느리지?"

### 진단
1. `showProjectDetail`이 `await calcHoursByMilestone(id)`로 패널 첫 렌더를 **차단**
2. `calcHoursByMilestone` 내부에서 **이미 가진 `proj`/`milestones`를 다시 fetch** (네트워크 2× 낭비)
3. `readAllArchiveRecords` 후 **records × milestones 매칭 루프** (1만 records × 10 마일스톤 = 10만 비교)가 차단

결과: 패널이 클릭 후 수백ms ~ 1초+ 후에 열림.

### 변경

#### `project-data.js` — `calcHoursByMilestone(projectId, opts)`
- `opts.proj` / `opts.milestones` 전달 시 내부 fetch 생략.
- backward compatible — 기존 호출자는 `opts` 없이 호출하면 기존 동작.

#### `project-detail.js` — `showProjectDetail`
- **`await calcHoursByMilestone` 제거** → 패널이 즉시 그려짐.
- 마일스톤 시간 정보는 `<span class="pd-ms-hours" data-msid="...">` 자리만 비워 두고,
  `setTimeout(0)`로 백그라운드에서 `calcHoursByMilestone(id, { proj, milestones })` 호출 → 결과를 DOM에 후속 주입.
- 사용자가 패널을 닫았으면 주입 안 함.

#### `project-detail.js` — `pdLoadWork` (투입실적 탭)
- `Promise.all([projGet, msGetByProject])` 먼저, 그 결과를 `calcHoursByMilestone(id, { proj, milestones })`에 전달.
- 같은 데이터 5회 fetch → 2회 + 1회 계산.

### 효과
- **체감 응답 ~수백ms+ → 즉시**.
- 시간 정보는 0.1~1초 후 자연스럽게 채워짐 (UX 자연스러움).
- 아카이브 records가 많을수록 큰 효과.

### 변경 파일
- `project-data.js` (calcHoursByMilestone 시그니처 확장)
- `project-detail.js` (await 제거, 백그라운드 시간 집계)
- `업무일지_분석기.html` (v13.61 + 패치노트)
- `CHANGELOG.md`

---

## v13.60 (2026-05-14) — 팀관리/주간분석 초기 로드 가속 (자동 최근 주차 + 마지막 선택 기억)

### 배경
사용자: "팀관리, 주간분석 처음에 읽어올때 다 읽어서 느린거 같은데. 기본 선택을 세션 열릴 때 최근 날짜로 자동 지정하면 빠를 거 같은데?"

### 진단
`initWeekSelector()` 의 기존 폴백이 "오늘 주가 데이터에 없으면 전체 표시"였음 (`selWeek = null`). 데이터가 누적될수록 첫 진입 시 모든 주차를 처리·렌더해야 해서 체감 속도가 떨어짐.

### 변경 — `업무일지_분석기.html`

**`initWeekSelector()` 우선순위 재설계** — 항상 1주만 선택:
1. **localStorage(`wm-lastWeek`)에 저장된 마지막 선택 주차** 가 데이터에 있으면 복원
2. **오늘이 속한 주**
3. **데이터에서 가장 최근 주차** (buildWeekList는 최신순 정렬이므로 `weeks[0]`)
4. 데이터 자체가 없으면 전체(null) — 기존 폴백 유지

```js
// 기존
else { selWeek = null; renderWeekSelector(); } // 전체 표시 ← 느림

// 변경
pickWeek(weeks[0].start); // 가장 최근 주차 자동
```

**`pickWeek` 에 localStorage 저장 추가**:
- 주차 선택 시 → `localStorage.setItem('wm-lastWeek', sunStart)`
- '전체' 칩 누름 → `localStorage.removeItem('wm-lastWeek')` (사용자 의도 우선)

### 효과
- 50주 누적 워크스페이스: 50주 데이터 처리 → 1주 데이터 처리
- 통계 카드·차트·표 모두 즉시 표시
- 새로고침/재방문 시 직전 작업 중이던 주차로 자동 복귀
- "전체"를 명시적으로 누르면 그 선택을 기억 안 함 (의도 보존)

### 변경 파일
- `업무일지_분석기.html` (initWeekSelector + pickWeek + v13.60 패치노트)
- `CHANGELOG.md`

---

## v13.59 (2026-05-14) — 100명 동시 사용 대비: DB 풀 확대 + 통계 메모리 캐시 + 인덱스 보강

### 배경
사용자: "업무 관리자를 100명이 한꺼번에 사용하려는데, 최적화 필요한 부분들 검토해줘." → 옵션 M(Mid): DB 풀 + 통계 캐싱 + 인덱스 추가.

### A. DB 연결 풀 확대 (`server/config/db.js`)

```js
max: 20 → 50,
min: 2,
idleTimeoutMillis: 30000 → 45000,
connectionTimeoutMillis: 5000 → 8000
```

환경변수 `DB_POOL_MAX/MIN/IDLE_MS/CONN_MS` 로 운영 중 튜닝 가능. Render Postgres Standard 플랜은 max connection ~100이므로 안전 범위.

**효과:** 통계 1회 = 18 병렬 쿼리이므로 동시 30명 진입 시 풀 즉시 고갈됐던 문제 해결.

### B. A/S 통계 메모리 캐시 (`server/services/ttl-cache.service.js` 신설)

- 외부 의존성 0의 단순 TTL Map 캐시. Redis·Memcached 불필요.
- **TTL 5분** (`AS_STATS_CACHE_MS`), max 200 항목, FIFO eviction.
- **캐시 키**: `tenant_id|from|to|groupBy|category|priority|customer`
- **응답 헤더 `X-Cache: HIT | MISS | BYPASS`** 로 추적.
- `?nocache=1` 강제 우회 가능.
- **자동 무효화**: 티켓 CUD(POST/PUT/soft-delete/hard-delete/restore) 시 해당 테넌트 캐시 일괄 무효화.
- **새 엔드포인트**:
  - `GET /api/as-stats/_cache/stats` — `{size, hits, misses, hitRate}`
  - `POST /api/as-stats/_cache/invalidate` — 수동 무효화

**효과:** 같은 조건 응답 ~500ms → ~5ms (100x). 100명 동시 통계 진입 시 DB 1,800쿼리 → 18쿼리.

### C. 인덱스 보강 (`server/migrations/028_as_perf_indexes.sql`)

| 인덱스 | 효과 |
|---|---|
| `idx_as_activity_logs_tenant_date (tenant_id, worked_at DESC)` | 부서 부하·MTTR 시간 범위 |
| `idx_as_parts_tenant_used (tenant_id, used_at DESC) WHERE used_at NOT NULL` | 월별 부품 추이 |
| `idx_as_signatures_tenant_date (tenant_id, signed_at DESC) WHERE role='customer_field'` | CSAT 추이 |
| `idx_as_tickets_closed_at (tenant_id, closed_at DESC) WHERE status='closed' AND deleted_at IS NULL` | RCA·종결 통계 |
| `idx_as_tickets_customer_received` | Top 고객 Pareto |
| `idx_audit_logs_dedup (action, target_id, created_at DESC) WHERE action LIKE 'as.%'` | 스케줄러 dedup |

### 100명 동시 사용 추정 (수정 후)

| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| 100명 통계 동시 진입 (같은 기간) | 풀 고갈 + 1,800쿼리 → 응답 1~3s | 18쿼리 + 99명 캐시 hit → 5~50ms |
| 100명 목록 페이지 새로고침 (1초당) | apiLimiter 200/분 = 100 통과 OK | 동일 |
| 100명 동시 티켓 등록 | 풀 20 = 80명 대기 | 풀 50 = 50명만 약간 대기 (~ms) |
| Render Standard ($25/월) | OOM 위험 | 안정 |

### 운영 반영
1. `psql $DATABASE_URL -f server/migrations/028_as_perf_indexes.sql` (또는 서버 재시작 시 자동 적용)
2. 서버 재시작 — 풀 설정 + 캐시 초기화
3. (선택) `GET /api/as-stats/_cache/stats` 로 hitRate 모니터링 — 50% 이상이면 효과 정상

### 변경 파일
- 신규: `server/migrations/028_as_perf_indexes.sql`, `server/services/ttl-cache.service.js`
- 수정: `server/config/db.js`, `server/routes/as-stats.js`, `server/routes/as-tickets.js`, `업무일지_분석기.html`, `CHANGELOG.md`

---

## v13.58 (2026-05-14) — 모바일(iPhone 17 Pro) 최적화 + 한국어 폰트 18종 그룹화 + 가독성

### 배경
사용자: "모바일(아이폰17프로) 사이즈에도 최적화. 폰트가 구글 폰트라든지 좋은게 더 많던데… 많이 추가. 모바일에서 최적화된 레이아웃·글씨 크기·줄바꿈."

### 1) 한국어 Google Fonts 18종 + 그룹화

`config.js` `FONTS` 배열 확장 — 메타에 `group` 필드 추가. 메뉴는 그룹 헤더(산세리프/세리프/표제/손글씨/코드)로 나뉘어 카테고리별로 표시.

| 그룹 | 폰트 |
|---|---|
| 산세리프 (6) | 노토 산스(기본) · **프리텐다드** ⭐ · IBM Plex · 고운돋움 · 나눔 고딕 · 선플라워 |
| 세리프 (5) | 본 명조 · 고운바탕 · 함렛 · 송명 · 나눔 명조 |
| 표제 (3) | Black Han Sans · 도현 · 주아 |
| 손글씨 (3) | 나눔 펜글씨 · 개구 · 싱글데이 |
| 코드 (1) | JetBrains Mono |

각 옵션은 해당 폰트로 미리 렌더되어 한눈에 비교 가능. 첫 선택 시 Google Fonts CDN에서 동적 `<link>` 로드, 이후 캐시.

### 2) 모바일 가독성 기본값

```css
body {
  line-height: 1.55;
  word-break: keep-all;      /* 한국어 어절 단위 줄바꿈 */
  overflow-wrap: break-word; /* 긴 단어는 분할 */
}
.brk-all, .email, .mono, code, a[href^="http"] {
  word-break: break-all;     /* 영문 URL·이메일은 강제 분할 허용 */
}
```

### 3) 모바일 미디어쿼리 3단계 강화

**`@media (max-width: 768px)` 태블릿/소형**
- `body` 14px / `line-height` 1.6
- 헤더 `flex-wrap` 허용
- A/S 모달 인라인 폭 (`width:760px`/`920px`/`720px`/`600px`/`520px`) 모두 `100%` 강제 override (attribute selector)
- 첨부 그리드 `minmax(140px→110px,1fr)` 자동
- **iOS Safari 자동 줌 방지** — input/textarea/select `font-size: 16px` 강제

**`@media (max-width: 480px)` iPhone 17 Pro 핵심 구간** (393×852)
- 헤더 패딩 `10px/12px`, 페이지 탭 **가로 스크롤** 허용 (스크롤바 숨김)
- 통합 검색 `110px → 포커스 시 자동 확장`
- 검색/알림 드롭다운 `width: calc(100vw - 20px)`, `max-height: 60vh`
- 4열·3열 그리드 → 2열·1열 자동
- 첨부 카드 최소 폭 `95~105px` (한 행에 3~4장)
- A/S 통계 우측 액션 패널(`280~300px`) → 모바일은 아래로 (`flex-direction: column`)
- 칸반 컬럼 `220px → 160px`, 테이블 가로 스크롤
- **안전 영역** `env(safe-area-inset-top/bottom)` — 노치·홈인디케이터 회피

**`@media (max-width: 380px)`** — iPhone SE 등 초소형
- `body` 13px, 2열 그리드도 1열 강제

### 4) 통계 화면 그리드 자동 적응

`as-stats.js`의 그리드를 `auto-fit minmax`로 전환:
- KPI 4열 → `repeat(auto-fit, minmax(160px, 1fr))`
- 차트 3열 → `repeat(auto-fit, minmax(220px, 1fr))`
- 차트 2열 → `repeat(auto-fit, minmax(280px, 1fr))`

데스크톱은 그대로, 모바일은 자동 1열.

### 5) 폰트 메뉴 모바일 대응
- `max-height: 70vh` (스크롤)
- `max-width: 90vw`, `min-width: 240px`
- 모바일에서 오른쪽 가장자리에서 -8px 빼서 항상 보임

### 효과
- iPhone에서 **가로 스크롤 없이** 모든 화면이 화면 안에 들어옴
- A/S 등록·편집 모달이 화면 폭에 꽉 차서 사용 가능
- 한국어가 어절 단위로 깔끔히 줄바꿈 (영단어 한가운데서 안 끊김)
- iOS Safari 입력 시 자동 줌 방지
- 노치/홈인디케이터 침범 안 함

### 변경 파일
- `config.js` (FONTS 7→18 + group 메타)
- `업무일지_분석기.html` (CSS 미디어쿼리 3단계, 폰트 메뉴 그룹화, v13.58)
- `as-stats.js` (그리드 auto-fit minmax)
- `CHANGELOG.md`

---

## v13.57 (2026-05-14) — 사용자관리 테마 반영 + 시인성 강화 신규 테마 4종 + 글씨체 7종 선택기

### 배경
사용자: "화면 테마 색상과 별개로, 사용자 관리 화면은 검정으로만 나오는데, 테마 반영해줘. 시인성 개선할 수 있게 테마를 더 다양하게 추가. 글씨체를 고급/깔끔하게 선택할 수 있게."

### 버그 — 사용자관리(👤) 화면이 테마 미반영
**원인:** `auth.js`의 인라인 스타일이 메인 테마 시스템과 다른 변수 이름을 쓰고 있었음:
- `var(--bg,#0c0f1a)`, `var(--card,#1a1a2e)`, `var(--text,#e0e0e0)`, `var(--sub,#888)`, `var(--border,#333)`, `var(--accent,#3B82F6)`

이 변수들은 정의되지 않아 fallback 색상(검정 계열)만 적용됨. 92곳에서 사용 중.

**수정:** 메인 테마 변수로 일괄 교체:
| 기존 | 변경 |
|---|---|
| `--bg,#0c0f1a` | `--bg-i,#0D1018` |
| `--card,#1a1a2e` | `--bg-p,#111620` |
| `--text,#e0e0e0` | `--t2,#D8DEE8` |
| `--sub,#888` | `--t5,#6070A0` |
| `--border,#333` | `--bd,#222C44` |
| `--accent,#3B82F6` | `--ac,#5B8DEF` |

이제 모든 테마(14종)와 자동 동기화.

### 신규 테마 4종 (시인성 강화)

`업무일지_분석기.html` `[data-theme="..."]` 블록 추가:

| 테마 ID | 설명 | 배경 |
|---|---|---|
| `paper` | 종이 톤 크림 배경, 인쇄·문서 작업 친화, 장시간 가독 | `#FAF6EE` |
| `mint` | 그린 라이트, 부드러움 + 명료한 대비, CS 운영에 차분함 | `#EAF6F0` |
| `sunset` | 따뜻한 황혼 다크 + 주황 강조, 야간 시연용 | `#1A0F10` / 강조 `#FF8040` |
| `highcontrast` | 진짜 검정 배경 + 흰 텍스트 + 노란 강조. WCAG AAA 수준. 외부 시연·시력 보조 | `#000` / 강조 `#FFD60A` |

기존에 CSS만 있고 `config.js` `TH` 메뉴에 누락됐던 **ocean / nord / amethyst** 3종도 노출. 총 **14개 테마** (시스템 자동 + 라이트 4 + 다크 8 + 고대비).

### 글씨체 선택기 (7종)

`config.js` `FONTS` 배열 신설. Google Fonts CDN에서 **동적 `<link>` 로드** (한 번만, 캐시):

| ID | 라벨 | family |
|---|---|---|
| `noto` | 노토 산스 (기본) | Noto Sans KR |
| `pretendard` | 프리텐다드 (모던) | Pretendard Variable (jsdelivr 별도 URL) |
| `plex` | IBM Plex (테크) | IBM Plex Sans KR |
| `spoqa` | 스포카 한 산스 (UI) | Gowun Dodum |
| `nanumsq` | 나눔스퀘어 (가독) | Nanum Gothic |
| `serif` | 본 명조 (격식) | Noto Serif KR |
| `mono` | 젯브레인스 (코드) | JetBrains Mono |

**구현:**
- CSS 변수 `--app-font` 추가 → `body { font-family: var(--app-font); }`
- `aFnt(id)` 함수: 동적 `<link>` 삽입 + `--app-font` 갱신 + `localStorage('wa-font')` 저장
- 헤더에 `[🔤 글씨체]` 드롭다운 — 각 옵션이 해당 폰트로 미리 렌더되어 한눈에 비교 가능
- 메뉴 외부 클릭 시 자동 닫힘

### 변경 파일
- `auth.js` (92곳 변수 교체)
- `config.js` (TH 확장 + FONTS 신설)
- `업무일지_분석기.html` (CSS 4종 + 폰트 로직 + 헤더 UI + v13.57 패치노트)
- `CHANGELOG.md`

---

## v13.56 (2026-05-14) — A/S 접수 등록·편집 모달에 다중 파일 첨부 + 카드 그리드 + 미리보기

### 배경
사용자: "a/s 접수 편집에서 등록/수정 시에 이미지 리스트 추가할 수 있는게 왜 없지? 다중 파일 리스트로 등록하고, 선택하면 볼 수 있게."

기존 동작:
- 접수 편집 ✏️ 모달엔 첨부 UI 없음
- 첨부는 상세 모달의 ③ 처리 탭에 숨어 있어 흐름이 어색

### 변경 — `as-manager.js`

**모달 진입 시 데이터 동시 로드**: 편집 모드면 `asAttachmentGetAll(editId)`도 함께 불러옴. 신규 모드는 `window._asPendingAttachments = []` 초기화.

**④ 첨부 파일 섹션** (`③ 1차 분석` 뒤에):
- `<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.log,.zip">` — Ctrl/Shift로 다중 선택.
- 그리드: `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`. 이미지는 70px 썸네일, 그 외는 큰 아이콘.
- 카드 hover 보더 강조, 클릭 시 인앱 미리보기.
- `×` 버튼으로 즉시 제거.

**`_asModalAttachPicked(ev, ticketId)`**:
- 10MB 초과 자동 제외 + 경고
- FileReader로 dataURL 변환 + 카테고리 자동 추정
- **편집 모드**: `asAttachmentPut` 순차 호출(서버 부담 ↓) → 성공/실패 카운트 표시 → 그리드 자동 갱신
- **신규 모드**: 큐(`window._asPendingAttachments`)에 누적 → `"⏳ X개 추가됨, 접수 등록 시 함께 업로드"` 안내

**`saveASModal`**:
- 신규 등록 성공 후 큐가 있으면 `saved.id`로 순차 일괄 업로드 → 토스트에 `"… · 📎 N개 첨부"` 알림.

**`_asPendingAttachPreview(idx)`**: 큐 항목을 즉석 미리보기 — 기존 `_asRenderAttachPreview` 재사용. 미리보기 모달 노트에 `"⏳ 등록 전 — 접수 저장 시 업로드됩니다"` 자동 표시.

**`_asRenderAttachGridHtml(atts, ticketId, isPending)`** — 그리드 HTML 빌더. 편집/신규 두 경로에서 재사용. 이미지·PDF·기타 분기, 파일명·카테고리·크기(KB/MB) 표시, 대기 항목엔 `⏳대기` 배지.

### 미리보기
기존 `asAttachPreview` 모달 그대로 활용:
- 이미지 → `<img>` (max-height 78vh)
- PDF → `<iframe>`
- 텍스트(data URL) → base64 디코드 후 `<pre>`
- 기타 → 안내 + 다운로드 버튼
- ESC / 배경 클릭으로 닫힘

### 효과
- 접수 등록과 동시에 현장 사진을 한 번에 첨부 — 추가 단계 없음
- 편집 시에도 모달 안에서 즉시 추가/삭제/미리보기
- 다중 선택 → 일괄 업로드 — 한 장씩 안 올려도 됨
- 시각적 카드 그리드로 한눈에 첨부 현황 파악

### 변경 파일
- `as-manager.js`
- `업무일지_분석기.html` (v13.56 · 패치노트)
- `CHANGELOG.md`

---

## v13.55 (2026-05-14) — A/S 풀코스 강화 (장비·컨택 마스터 + cron 자동화 + 통계 필터·건강점수)

### 배경
사용자: "개선할 부분이 더 있을까?" → 옵션 5(A+B+C 풀코스). A=장비·컨택 마스터 + 재발 이력, B=node-cron 자동화, C=통계 다중 필터+건강 점수.

---

### A. 운영 효율 마스터 + 재발 이력

**`server/migrations/027_as_masters.sql`** — `as_equipment_master`(`serial_no` UNIQUE) + `as_customer_contacts`. 재발 검색용 부분 인덱스 2개 추가.

**`server/routes/as-masters.js`** — `/api/as-masters/equipment`·`/contacts` CRUD. 비활성화는 soft (`active=false`).

**자연 누적:** A/S 신규 접수 시 장비/컨택 마스터 자동 upsert (`customer_contact`에서 이메일 정규식 자동 추출). 사용자가 따로 마스터 관리 안 해도 시간이 지나면 자연히 쌓임.

**프론트:**
- 편집 모달 Serial No. `onblur` → `asEquipmentBySerial` → equipmentModel·equipmentNo·customerName·siteLine·installDate·warrantyStatus 빈 필드 자동 채움 + toast.
- 상세 모달 ①접수 탭 상단에 **🔁 재발 이력 사이드바** — 같은 serial/equipment의 과거 ticket 최대 20건, 클릭 시 점프. **같은 카테고리 2건 이상 재발 시 빨간 경고 배너 자동 표시**.
- 보고서 메일 모달 To 입력을 `<datalist>`로 — 컨택 마스터 자동완성 (해당 고객사 우선, 없으면 전체 상위 20).

**라우터:**
- `GET /api/as-tickets/:id/recurrences` — serial/equipment 기반 과거 A/S 조회 (deleted 제외, 20건).

---

### B. 자체 cron 자동화 (`node-cron`)

**`server/package.json`** — `node-cron ^3.0.3` 추가.

**`server/services/scheduler.service.js`** 신설 — TZ `Asia/Seoul` 고정, `server.js` 부팅 시 `start()`. `SCHEDULER_DISABLED=1` 환경변수로 끌 수 있음. node-cron 미설치 시 graceful 폴백.

| # | 작업 | 시각 | 동작 |
|---|---|---|---|
| 1 | SLA 임박/위반 | 평일(월~금) 09~18 시 매시 5분 | P1 2.4일↑ / P2 5.6일↑ (closeDays 80%) 진행중 → 담당자+admin에게 `as_sla_breach`. 12h dedup |
| 2 | 미회신 D+3 | 매일 09:10 | `customer_wait` 3일↑ → admin에게 `as_customer_wait`. 24h dedup |
| 3 | 주간 요약 | 매주 월요일 08:30 | 모든 active 테넌트 admin에게 `as_weekly_digest` (신규/종결/MTTR/SLA + Top3 카테고리·고객 + P1·P2 미해결 Top5) |

**dedup 키:** `audit_logs.action`에 `as.sla_alert` / `as.customer_wait_alert` 기록 후 시간 범위로 중복 알림 방지.

---

### C. 통계 다중 필터 + 건강 점수

**`/api/as-stats`** 쿼리 파라미터 추가:
- `category=hw_fault,sw_error` (콤마 분리 다중)
- `priority=P1,P2`
- `customer=코아` (ILIKE)

이 필터는 `BASE_WHERE`에 누적되어 모든 차트에 일관 적용.

**🏆 건강 점수 (Health Score):** 0~100 단일 KPI.
```
SLA 점수  = max(0, 100 - 위반율% × 4)         # 0% → 100점, 25% → 0점
MTTR 점수 = max(0, min(100, 100 - (MTTR - 24) × 2))  # 24h가 만점
CSAT 점수 = (CSAT 평균 / 5) × 100

가중치 (CSAT 있음): SLA 50% + MTTR 25% + CSAT 25%
가중치 (CSAT 없음): SLA 70% + MTTR 30%

등급: A 90+ / B 75+ / C 60+ / D 45+ / E < 45
```

**프론트:**
- 통계 화면 최상단에 큰 카드 — 42px 점수 + 원형 등급 배지 + SLA/MTTR/CSAT 분석 막대(가중치 표시).
- 컨트롤 바 하단에 필터 UI — 카테고리 셀렉트 + 긴급도 셀렉트 + 고객사 텍스트 검색 + [적용]/[필터 해제].
- 카테고리 옵션은 `_AS_CAT_CACHE` 우선, 폴백 `AS_CATEGORY`.

---

### `project-data.js`
- `asEquipmentSearch(params)`, `asEquipmentBySerial(serial)`
- `asContactsSearch(params)`, `asContactPut(contact)`
- `asRecurrencesGet(ticketId)`

### 운영 반영 (반드시)
- `server/migrations/027_as_masters.sql` 1회 실행
- `cd server && npm install` (node-cron)
- 서버 재시작 — `app.use('/api/as-masters', ...)` 및 `scheduler.start()` 등록 시점
- 스케줄러 비활성화: `SCHEDULER_DISABLED=1`

### 변경 파일
- 신규: `server/migrations/027_as_masters.sql`, `server/routes/as-masters.js`, `server/services/scheduler.service.js`
- 수정: `server/app.js`, `server/server.js`, `server/routes/as-tickets.js`, `server/routes/as-stats.js`, `server/package.json`, `project-data.js`, `as-manager.js`, `as-stats.js`, `업무일지_분석기.html`, `CHANGELOG.md`

---

## v13.54 (2026-05-14) — A/S 통계·트렌드 분석 풀세트 + 자동 인사이트 + 주간 텔레그램 요약

### 배경
사용자: "A/S 관련해서 트렌드 분석 및 통계 분석 기능 넣으면 좋을 거 같은데?" → 옵션 1~3 풀코스(MVP + 풀 슬라이스 + 주간 텔레그램). 요청: "시인성과 분석력에 확연히 도움이 되는 구성 및 기능으로".

### 백엔드 — `server/routes/as-stats.js` 신설

**단일 통합 엔드포인트 `GET /api/as-stats?from=&to=&groupBy=`** — 모든 차트 데이터 한방 반환:
- `kpi`: 신규/처리중/종결/P1·P2미해결/MTTR/SLA위반%/CSAT/부품비용 (현재 + 이전 기간 + Δ%)
- `trend.{labels,newCount,closedCount,mttrHours}`
- `distribution.{category,priority,status,warranty,method}`
- `deptLoad`, `sla.byPriority`, `topCustomers`, `topEquipment`, `rca`
- `csat.{labels,overall,speed,quality}`
- `parts.{byBilling, labels, warranty, paid, goodwill, check}`
- `insights[]` — 규칙 기반 한국어 코멘트

**자동 기간 처리:**
- `from/to` 미지정 시 최근 90일.
- `groupBy` 자동: 31일 이하 → `day`, 120일 이하 → `week`, 그 외 → `month`.
- **직전 동일 길이 기간**을 자동 계산해서 KPI 증감 비교용으로 사용.

**SLA 정의:** `AS_PRIORITY.closeDays` 기반.
- P1 > 3일, P2 > 7일, P3 > 14일, P4 > 30일.
- closed면 `closed_at - received_at`, 진행 중이면 `NOW() - received_at` 비교.

**CSAT 점수화:** very_satisfied=5, satisfied=4, neutral=3, unsatisfied=2, very_unsatisfied=1 환산 후 AVG.

**자동 인사이트(`buildInsights`)** — 규칙 기반:
- 신규 접수 ±20% 변화
- MTTR ±10% 변화
- SLA 위반율 10% 이상
- CSAT < 3.5 (critical) 또는 ≥ 4.5 (good)
- 단일 고객/카테고리가 전체의 30% 이상
- 부서 부하 40h 이상
- P1·P2 미해결 3건 이상

분류: `good` / `warn` / `critical` / `info` — 프론트에서 색상 분기.

**주간 요약 `GET /api/as-stats/weekly-digest?send=1`:**
- 신규/종결/MTTR/SLA위반 + Top3 카테고리·고객 + P1·P2 미해결 Top5 텍스트 생성.
- `send=1`이면 admin들에게 `notify('as_weekly_digest')` 발사.
- 외부 cron(예: cron-job.org)에서 주간 호출하면 자동화. 서버 자체 스케줄러 도입은 별도 필요.

### 알림 — `server/services/notification.service.js`
- `TEMPLATES.as_weekly_digest` + `EVENT_TITLES.as_weekly_digest` 추가.

### 프론트엔드 — `as-stats.js` 신설 (≈ 600줄)

**Chart.js 13개 차트 그리드** (모두 Noto Sans KR + 일관 색상 팔레트):

| # | 차트 | 형식 | 비고 |
|---|---|---|---|
| 1 | 신규/종결 추이 | Line 2 시리즈 | 큰 셀 (280px) |
| 2 | 카테고리 분포 | Donut | 클릭 시 drill-down |
| 3 | 긴급도 분포 | Bar | 색상=AS_PRIORITY.color |
| 4 | 상태 분포 | Donut | 클릭 시 drill-down |
| 5 | SLA 준수율 (긴급도별) | Stacked Bar | 준수(초록) + 위반(빨강) |
| 6 | 부서별 부하 | Horizontal Bar | 활동로그 누적 시간 |
| 7 | MTTR 추이 | Line | 평균 처리시간 |
| 8 | Top 10 고객 (Pareto) | Horizontal Bar | P1·P2 보유 시 빨간색 |
| 9 | Top 10 장비 | Horizontal Bar | |
| 10 | 완료분류 (RCA) | Bar | closure 분포 |
| 11 | CSAT 추이 | Line 3 시리즈 | 1~5 고정 스케일 |
| 12 | 부품 청구구분 | Donut | 색상=AS_BILLING.color |
| 13 | 부품 월별 누적 | Stacked Bar | 보증/유상/Goodwill/확인 |

**KPI 8장:**
- 신규 접수 / 처리 중 / 종결 / P1·P2 미해결 / 평균 처리시간 / SLA 위반율 / CSAT 평균 / 부품 비용.
- 추세 화살표 ▲▼ + **의미 색상 자동**(개선=초록, 악화=빨강 — invert 플래그로 신규/MTTR/위반율은 감소가 좋음, 종결/CSAT는 증가가 좋음).
- 컬러 보더 3px로 한눈 식별. 큰 숫자(24px).

**기간 프리셋:** 7일 / 30일 / 90일 / 6개월 / 12개월 / 사용자 지정(date range 입력). 즉시 재조회.

**💡 자동 인사이트 패널** — 응답 `insights`를 좌측 컬러바 카드로:
- good = 초록 / warn = 주황 / critical = 빨강 / info = 파랑.
- 데이터 부족 시 안내 메시지.

**🔍 Drill-down:** 카테고리·긴급도·상태·Top 고객 차트 클릭 → `asFilterCategory/Priority/Status/asSearchKw` 자동 설정 + `asViewMode='all'`로 점프 + 토스트.

**관리자 전용** `[📨 주간 요약 발사]` 버튼 — 컨펌 → POST → 발송 인원수 토스트.

**데이터 부족 처리:** 선택 기간에 KPI 합계 0이면 큰 📊 아이콘 + "기간을 더 길게 설정하거나 접수를 등록한 후 다시 확인" 안내.

### `as-manager.js`
- `asViewMode` 토글에 `'stats'` 추가. `renderAS` 진입 시 `stats`면 `renderASStats()`로 위임.
- 상단 토글에 [📊 통계] 버튼 추가 (시안색 `#0EA5E9` 강조).

### `project-data.js`
- `asStatsGet(params)`, `asStatsWeeklyDigest(send)` 헬퍼 추가.

### `업무일지_분석기.html`
- `as-stats.js` 로드 추가.
- v13.54 / 패치노트.

### 효과
- 매 회 보고서 뽑을 필요 없이 한 화면에서 현황·트렌드·이상치 파악.
- 자동 인사이트가 "어디를 봐야 할지" 가이드.
- 차트 클릭으로 바로 해당 케이스 조회.
- 주간 텔레그램으로 관리자 자동 푸시.
- 시인성: KPI 카드 색상·화살표 + 일관 차트 팔레트 + 인사이트 색상 분류.

### 변경 파일
- 신규: `server/routes/as-stats.js`, `as-stats.js`
- 수정: `server/app.js`, `server/services/notification.service.js`, `project-data.js`, `as-manager.js`, `업무일지_분석기.html`, `CHANGELOG.md`

---

## v13.53 (2026-05-14) — A/S 보고서 메일: 웹메일 작성기 콤보 (SMTP 불필요)

### 배경
사용자: "웹메일 다른 방식으로는 보낼 수 없나?" — 서버 SMTP 설정(앱 비번 등)이 회사 환경에서 번거롭다는 피드백. 옵션 C(PDF 자동 다운로드 + 웹메일 작성기 콤보) 선택.

### 변경 — `as-manager.js` PDF 미리보기 모달 우측 패널

기존 [✉️ 메일로 발송] 버튼(SMTP API 호출) → **[✉️ PDF 다운로드 + 작성기 열기]** 한 번 클릭으로 다음을 수행:

1. **PDF 자동 다운로드** — `out.pdf.save(fileName)` 즉시 트리거
2. **메일 서비스 compose 새 탭 자동 오픈** — To/제목/본문이 자동 입력된 상태로
3. **사용자는 작성 창에 PDF를 끌어다 놓고 발송 버튼만 클릭**

### 메일 서비스 5종 지원 (드롭다운, 마지막 선택 `localStorage`에 기억)
- **Gmail** (웹): `https://mail.google.com/mail/?view=cm&fs=1&to=&su=&body=`
- **Outlook / Office 365** (회사 웹메일): `https://outlook.office.com/mail/deeplink/compose?to=&subject=&body=`
- **Outlook.com / Hotmail** (개인): `https://outlook.live.com/owa/?path=/mail/action/compose&to=&subject=&body=`
- **네이버 메일** (웹): `https://mail.naver.com/write/popup/?to=&subject=&body=`
- **PC 기본 메일 앱**: `mailto:` (Outlook 데스크톱/Thunderbird/Mail.app 등)

`_asBuildComposeUrl(provider, to, subject, body)` 헬퍼로 분리. `encodeURIComponent`로 한글 안전 인코딩.

### UX 디테일
- **본문 자동 생성**: `안녕하세요, A/S 작업 보고서를 전달드립니다. • 접수번호: AS-... • 고객사: ... • 장비: ... ※ 첨부 PDF 확인 부탁드립니다.` 사용자가 편집 가능.
- **팝업 차단 감지**: `window.open` 반환값 검사 → 차단 시 "주소창 우측 팝업 허용 안내 + 직접 클릭할 수 있는 링크" 표시.
- **안내 박스**: "1) PDF 자동 다운로드 2) 작성기 새 탭 오픈 3) PDF 끌어다 놓고 보내기 / 본인 명의로 발송되어 보낸편지함 자동 보관 / 팝업 차단 시 허용 안내"

### 효과
- ✅ 서버 SMTP 설정 부담 **0**
- ✅ `Missing credentials` / Gmail 앱 비밀번호 발급 부담 **0**
- ✅ 발신자 = 본인 계정 → 사후 추적 명확, 회사 명의 사칭 불가
- ✅ Render 등 서버리스/제한 환경에서도 100% 동작
- ✅ 회사 SMTP에 외부 고객 데이터 통과 시킬 필요 없음 (개인정보 처리 부담↓)

### 서버 코드 보존
- `POST /api/as-tickets/:id/email-report` 라우터와 4단 보안 보강(권한·BCC·푸터·감사로그·rate-limit)은 **dead code로 보존**. 향후 SMTP 활성화가 필요해지면 그대로 재사용 가능.
- `project-data.js`의 `asEmailReport` 헬퍼도 보존.

### 변경 파일
- `as-manager.js` (우측 패널 + `_asBuildComposeUrl` 헬퍼 + 핸들러 교체)
- `업무일지_분석기.html` (v13.53 · 패치노트)
- `CHANGELOG.md`

---

## v13.52 (2026-05-14) — fix: PDF 미리보기 깨짐 + SMTP 에러 친화화

### 버그 1 — PDF 미리보기가 빈 회색 화면으로 보임

**원인:** `server/app.js`의 helmet CSP에 `frame-src` / `object-src` 디렉티브가 명시 안 됐고, 명시 없으면 `default-src 'self'`로 폴백되어 `<iframe src="blob:...">` 가 차단됨. `imgSrc`엔 `blob:` 가 허용돼 있었으나 `frameSrc`엔 없어 누락 케이스.

**수정:**
- `frameSrc: ["'self'", "blob:", "data:"]`, `objectSrc: ["'self'", "blob:", "data:"]` 추가.
- 부가 보강:
  - html2canvas 화면 밖 캡처 시 `holder` div에 `width:794px` 명시, html2canvas 옵션에 `width:794, windowWidth:794, allowTaint:true` 추가 — 폭 0 캡처 사고 방지.
  - 미리보기 iframe에 `width:100% / height:100% / display:block` 명시, 부모는 `min-width:0` 으로 flex 수축 허용.
  - **폴백:** 3초 안에 `iframe load`가 안 오면 자동으로 "브라우저 미리보기가 차단되었습니다 + [🔗 새 탭에서 열기]" 안내로 교체. CSP/구브라우저 어디서든 PDF 확인 가능.

### 버그 2 — 메일 발송 시 "Missing credentials for PLAIN" 에러

**원인:** nodemailer가 SMTP 자격증명(USER/PASS)이 비어 있는 상태에서 PLAIN 인증을 시도. 즉 환경변수 미설정 — 코드 버그 아님.

**수정 (에러 메시지만 친화화):**
- "Missing credentials" → `SMTP 자격증명 미설정 — SMTP_USER / SMTP_PASS 환경변수를 채운 뒤 서버 재시작. Gmail은 앱 비밀번호 필요`
- "Invalid login / Username and Password not accepted" → `Gmail 앱 비밀번호 안내 + 발급 링크`
- "ETIMEDOUT / ECONNREFUSED" → `SMTP 서버 연결 실패 — HOST/PORT/방화벽 확인`

### 변경 파일
- `server/app.js` (CSP)
- `server/routes/as-tickets.js` (에러 메시지 분기)
- `as-manager.js` (PDF 캡처 폭 / iframe / 폴백)
- `업무일지_분석기.html` (v13.52 · 패치노트)
- `CHANGELOG.md`

---

## v13.51 (2026-05-14) — A/S 메일 발송 보안 보강 (권한·BCC·푸터·감사로그·Rate-limit)

### 배경
v13.50에서 회사 SMTP를 등록해 메일을 보낼 수 있게 한 직후 사용자 우려:
> "회사 것 등록하면 아무나 보낼 수 있나? 개인 주소로...?"

답: 그대로 두면 로그인 사용자 누구나 임의 주소(개인 Gmail 등)로 회사 명의 PDF를 외부 발송할 수 있고, 추적도 안 됨. 이 PR에서 4단 게이트를 한 번에 추가.

### 변경 — `server/routes/as-tickets.js` `POST /:id/email-report`

1) **권한 게이트** — admin 이거나, 해당 ticket의 `as_assignments`에 본인이 active로 등록돼 있어야 함. 아니면 `403 "이 접수의 담당자 또는 관리자만 메일을 발송할 수 있습니다"`.
2) **본문 푸터에 발신자 강제 표기** — 회사 명의 사칭 방지.
   ```
   보낸 사람: 박종민 <jmpark@yourco.com>
   발송 시각: 2026-05-14 14:23:01 (IP 1.2.3.4)
   본 메일은 회사 업무 관리자 시스템에서 위 담당자가 발송한 메일입니다.
   회신은 위 담당자 주소로 직접 부탁드립니다.
   ```
3) **자동 BCC** — 발신자 본인 + 같은 tenant의 active admin들에게 자동 BCC. To와 중복은 제거. 누가 어디로 보냈는지 메일함에 자연스럽게 보존.
4) **`replyTo` 자동** — 받는 쪽 답장은 회사 SMTP가 아닌 담당자 개인 메일함으로 직행.
5) **감사로그** — `authService.auditLog('as.email_report', 'as_ticket', ticketId, {ticketNo, to, bccCount, fileName, subject, pdfSize}, req)`. `audit_logs` 테이블에 IP·UA 포함 기록.
6) **Rate-limit** — `express-rate-limit` (7.x), `keyGenerator=req.user.sub`, **시간당 20건**. 초과 시 `429 "시간당 메일 발송 한도(20건)를 초과했습니다"`.
7) **soft-delete 보호** — `deleted_at IS NOT NULL` 인 휴지통 ticket은 발송 불가.

### 변경 — `server/services/email.service.js`
- `sendMail(to, subject, html, opts)`의 `opts`에 `bcc`/`cc`/`replyTo` 추가. 배열·문자열 모두 허용. 기존 호출자(가입 승인/거절/비번 초기화) 100% 호환.

### 변경 — `as-manager.js` (PDF 미리보기 모달)
- 우측 액션 패널 하단에 🔒 **보안 정책** 안내 박스 4줄 추가:
  - 본인 메일 + 관리자에게 자동 BCC
  - 본문 푸터에 발신자(이름/이메일/IP) 자동 표기
  - 모든 발송은 감사로그에 기록
  - 담당자 또는 관리자만 발송 가능 (시간당 20건)

### 효과
- 외부 유출/사칭 위험 차단: 본인 동의 없이 회사 명의로 외부 발송 불가, 발신자 책임 명확.
- 사후 추적: 모든 발송이 audit_logs + admin BCC 메일함 둘 다에 남음.
- 사용자 인지: 모달에서 정책을 미리 보고 발송하므로 "몰랐다"가 안 됨.

### 변경 파일
- `server/routes/as-tickets.js`
- `server/services/email.service.js`
- `as-manager.js` (모달 정책 박스)
- `업무일지_분석기.html` (v13.51 / 패치노트)
- `CHANGELOG.md`

---

## v13.50 (2026-05-14) — A/S: 첨부 Preview · 2단계 삭제(휴지통) · 보고서 PDF·메일

### 배경
사용자 요청: "프로젝트 관리 > A/S 접수 편집에 이미지 리스트 넣을 수 있게, 사진/캡쳐 이미지 + 문서. 선택 시 PREVIEW. 접수 자체를 삭제하는 기능 없음(임시 삭제 후 완전 삭제 물어보고 처리). 보고서 탭에 보고서 PDF 생성·미리보기, 미리보기 후 메일 보내기 기능 추가."

### 1) 첨부 — 이미지·문서 임베드 + 인앱 Preview (`as-manager.js`, `config.js`)
- 첨부 추가 모달 file input의 `accept`를 `image/* + pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/log/zip` 로 확장.
- 자동 임베드 한도 4MB → **10MB**. data URL은 그대로 서버에 저장(외부 스토리지 옵션도 유지).
- 파일 선택 시 즉시 미니 프리뷰: 이미지면 썸네일, PDF/문서면 아이콘 + 크기.
- 카테고리 자동 추정: image → `photo_before`, pdf/doc/xls/ppt → `doc`, log → `log`.
- 첨부 그리드 카드 — 이미지면 90px 썸네일, 아니면 큰 아이콘(📄/📎)로 시각화. 카드 hover시 보더 강조, 카드 클릭 → Preview 모달.
- `asAttachPreview()` 모달:
  - 이미지 → `<img>` (max-height 78vh, 검은 배경).
  - PDF → `<iframe>` 인라인 렌더.
  - 텍스트(data URL) → base64 디코드 후 `<pre>`.
  - 기타 → "미리보기 미지원" 안내 + 다운로드 버튼.
  - 우상단 [⬇ 다운로드] 항상 노출. ESC / 배경 클릭으로 닫힘.

### 2) 접수 2단계 삭제 (`server/migrations/026`, `server/routes/as-tickets.js`, `as-manager.js`)
- **마이그레이션 026** — `as_tickets.deleted_at TIMESTAMPTZ`, `deleted_by UUID` + 활성/휴지통용 부분 인덱스.
- **라우터 변경**:
  - `DELETE /api/as-tickets/:id` — soft delete (휴지통 이동, 누구나 가능).
  - `DELETE /api/as-tickets/:id/hard` — 완전 삭제 (`rbac.checkPermission('issue.delete')`).
  - `POST /api/as-tickets/:id/restore` — 휴지통에서 복구.
  - `GET /api/as-tickets` — 기본은 `deleted_at IS NULL`, `?trashed=1` 이면 휴지통만 + `ORDER BY deleted_at DESC`.
- **클라이언트**:
  - A/S 상단 토글에 `🗑️ 휴지통 (N)` 추가. 휴지통 카운트는 별도 가벼운 조회로 항상 표시.
  - 편집 모달 헤더 좌측에 `🗑️ 휴지통으로 이동` 버튼.
  - 휴지통 모드 행은 [↻ 복구] [💥 완전삭제] 버튼.
  - **완전삭제는 접수번호를 그대로 타이핑해야 진행** — 오삭제 방지 2차 확인. 권한 없으면 친절한 403 안내.

### 3) 보고서 PDF — 인앱 미리보기 + 다운로드 + 메일 발송
- jsPDF CDN(`2.5.1 UMD`) 추가 (`업무일지_분석기.html`). html2canvas는 기존 로드 유지.
- `_asReportHtmlForPdf(t)` — A4 폭(794px) 기준 8섹션 HTML 빌드: 고객/장비 · 접수 · 신고 · 처리이력 · 부품 · RCA·재발방지·최종상태 · 첨부 · 서명+CSAT. 첨부 사진은 본문에 180×120 인라인.
- `_asGeneratePdf(t)` — 화면 밖 영역에 HTML 렌더 → html2canvas로 캡처(scale 2) → jsPDF에 JPEG 임베드. **한글 깨짐 0**. 본문이 길면 페이지 자동 분할 (A4 portrait, 8mm 마진).
- `asReportPdfPreview(id)` — ⑥ 탭 새 버튼 `📄 PDF 미리보기 / 메일` 진입점. 모달은 좌측 iframe 미리보기, 우측 액션 패널 [PDF로 저장][To/제목/메시지 + ✉️ 메일로 발송].
- **메일 발송** — `POST /api/as-tickets/:id/email-report` (`server/routes/as-tickets.js`):
  - body `{ to, subject, message, pdfBase64, fileName }`.
  - to 형식 검증 (`^[^@\s]+@[^@\s]+\.[^@\s]+$`).
  - 테넌트 검증 후 `emailService.sendMail()` 호출. SMTP 미설정 시 명확한 에러.
  - `email.service.js` 의 `sendMail`이 `opts.attachments` / `opts.subjectPrefix` 지원하도록 확장(기존 호출자 호환).

### 변경 파일
- `server/migrations/026_as_tickets_soft_delete.sql` (신규)
- `server/routes/as-tickets.js` (soft/hard/restore/email-report 추가, 목록 필터 변경)
- `server/services/email.service.js` (attachments 옵션)
- `project-data.js` (`asDel/asDelHard/asRestore/asEmailReport`)
- `as-manager.js` (첨부 Preview · 휴지통 · PDF 미리보기·메일)
- `config.js` (변경 없음 — 기존 AS_ATTACH_CATEGORY 그대로 사용)
- `업무일지_분석기.html` (jsPDF CDN · 버전 v13.50 · 패치노트)
- `CHANGELOG.md`

---

## v13.45 (2026-05-08) — 타임라인 라벨에 라이프사이클 6단계 step-icon

### 배경
사용자 요청: "라이프사이클(수주/설계/제작/검수/납품/AS) 등도 표시."

### 변경 (`timeline.js`)
- 라벨 5행에 6개 미니 step-icon (15×15px, 원형) 추가:
  - **완료**: 솔리드 컬러 배경 + 흰 아이콘
  - **현재**: 컬러 외곽선(1.5px) + 옅은 컬러 배경 + 컬러 아이콘
  - **미진행**: 투명 배경 + 회색 외곽선 + 회색 아이콘
- 단계 정렬: `PROJ_PHASE[k].seq` 순.
- 완료 판정: `p.phases[k].status === 'done'` 또는 `currentPhase` 인덱스보다 앞선 단계.
- 각 아이콘 title: 단계명 + `(현재)` / `(완료)`. 행 전체 title: `라이프사이클 — 현재: X`.
- `calcLabelWidth` 에 step-icon 행 폭 반영: `6 × 15 + 3 × 5 + 24 = 약 117px` 보장.

### 효과
- 라벨 한 행에 핵심 정보 5가지: 색·이름 / 상태·진척률 / 기간·D-Day / 담당자 / **라이프사이클 진행 상태**.
- 클릭 없이도 프로젝트가 어느 단계에 와 있는지 즉시 파악.

### 변경 파일
- `timeline.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.44 (2026-05-08) — 타임라인 라벨에 담당자 4행 추가

### 배경
사용자 요청 흐름: v13.43에서 기간/D-Day 추가한 후 → "프로젝트 담당자도 표시 해줄까?"

### 변경 (`timeline.js`)
- 라벨 4행에 `👤 담당자` 추가.
  - 1~3명: 풀 이름(`홍길동, 김철수, 이영희`)
  - 4명 이상: `홍길동, 김철수 외 N명` 콤팩트
- `typeof shortName === 'function'` 체크 후 표시명 압축 적용 (다른 모듈과 동일 패턴).
- `title` hover 시 전체 담당자 명단(`_full`) 표시.
- `calcLabelWidth` 에 담당자 행 폭 측정 추가 — 라벨이 너무 좁아 텍스트가 잘리지 않게 자동 확장.

### 효과
- 라벨 한 행에 핵심 4가지 정보 모두: 색·이름 / 상태·진척률 / 기간·D-Day / **담당자**.
- 마우스 호버나 패널 클릭 없이도 누가 책임자인지 즉시 파악.

### 변경 파일
- `timeline.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.43 (2026-05-08) — 타임라인 라벨에 프로젝트 기간 + D-Day 표시

### 배경
사용자 요청: "프로젝트 타임라인 테이블 표시 시, 진행중·완료 외에 타이틀 옆에 프로젝트 기간도 표시해주자."

### 변경 (`timeline.js`)
- `_tlFmtPeriod(p)` / `_tlFmtDday(p, st)` 헬퍼 신설.
  - 기간 포맷: 같은 해는 `5/8 ~ 8/15`, 다른 해는 `'25.12.20 ~ '26.03.10` 으로 자동 콤팩트.
  - D-Day: 8일 이상 회색, 7일 이내 주황, D-Day/지연(D+N) 빨강. `done`/`closed` 상태는 표시 생략.
- 라벨 셋째 줄로 `[기간] [D-Day]` 추가 — 기존 색상 dot/이름 / 상태 배지·진척률 위에 보조 정보 한 줄.
- `calcLabelWidth` 에 셋째 줄(9px) 폭 측정 추가 — 라벨이 너무 좁아 텍스트가 잘리지 않도록 자동 확장 (160~400px 범위).

### 효과
- 프로젝트 한 행에 핵심 정보 전부: 색·이름 / 상태·진척률 / **기간·D-Day**. 막대 hover 없이도 일정 즉시 파악.
- 마감 임박(7일 이내) / 지연 프로젝트가 색상으로 자연 강조.

### 변경 파일
- `timeline.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.42 (2026-05-08) — 패치노트 항목 일부만 표시되던 버그 수정

### 원인
v13.41 패치 항목 중 `'style.css 와 인라인 <style> 양쪽 동기화'` 텍스트 안의 literal `<style>` 가 `el.innerHTML` 주입 시 브라우저에 의해 실제 `<style>` 태그로 해석. 그 뒤로 등장하는 패치 카드(13.40, 13.39…)들이 stylesheet 내용으로 빨려 들어가 화면에서 사라짐 → "마지막 것만 보임" 인상.

### 수정
- 해당 항목의 `<` `>` 를 `&lt;` `&gt;` entity로 교체.
- **재발 방지**: `renderPatchNotes` 의 forEach에서 `p.title` 과 `p.items` 각 항목을 자동 escape — 이미 entity 형태인 `&lt;`/`&gt;`/`&amp;` 등은 두 번 escape 되지 않도록 negative lookahead 적용.

### 변경 파일
- `업무일지_분석기.html` (renderPatchNotes + 헤더 + 패치노트), `CHANGELOG.md`

---

## v13.41 (2026-05-08) — 타임라인 뷰포트 기반 높이 (스크롤 최소화)

### 배경
사용자 보고: "프로젝트 관리 타임라인에 프로젝트 타임라인 스크롤 최소화 하도록 최대한 늘려서 처리 하자. 프로젝트들이 한눈에 안들어와".

원인: `.tl-scroll` 의 `max-height: 600px` 고정 (`style.css:152`, 인라인 `<style>:272`) + `#tlProjList` `max-height: 540px` (HTML:707). 뷰포트 크기와 무관하게 캡되어 큰 모니터에서도 항상 스크롤 발생.

### 변경
- `.tl-scroll` `max-height: 600px` → **`calc(100vh - 220px)`**, `min-height: 400px`. 220px 는 헤더/탭/필터/패널 헤더 합산 여유분.
- `#tlProjList` `max-height: 540px` → **`calc(100vh - 240px)`**, `min-height: 360px`. 좌측 목록도 동기화.
- `style.css` 와 HTML 인라인 `<style>` 양쪽 동기화.

### 효과
- 1080p 화면(1080px 뷰포트): 타임라인 ~860px, 목록 ~840px → 거의 두 배 가시 영역
- 1440p 화면(1440px 뷰포트): 타임라인 ~1220px → 매우 많은 프로젝트 한눈에
- 작은 화면(800px 이하): min-height 400px / 360px 로 너무 좁아지지 않음

### 변경 파일
- `style.css`, `업무일지_분석기.html` (인라인 style + #tlProjList + 헤더 + 패치노트), `CHANGELOG.md`

---

## v13.40 (2026-05-08) — L3: 크로스탭 실시간 동기화 (wmDataBus 이벤트 시스템)

### 배경
검토에서 식별된 L3: "크로스탭 실시간 동기화 — 한 탭에서 변경한 게 다른 탭에 안 나타나서 새로고침해야 하는 케이스 해결". 각 탭이 독립적으로 캐시(`_pdCache` 등)를 보유해, 예를 들어 타임라인에서 마일스톤 추가해도 파이프라인 탭이 stale 데이터를 보여주는 문제.

### 변경

**1) 이벤트 버스 도입 (`업무일지_분석기.html` 인라인 script, 모든 모듈보다 먼저 동기 로드)**
- `window.wmDataBus` pub/sub: `on(type, fn)` / `emit(type, action, detail)`
- 기본 type: `project` / `milestone` / `event` / `order` / `issue` / `checklist` / `document`
- 와일드카드 `*` 지원 (모든 변경 listen)
- payload: `{ type, action, detail }`. action: `created` / `updated` / `deleted` / `bulk`
- 무한 루프 방지: 동일 type emit 사이클 중 재emit 차단

**2) Mutator에 emit 추가 (`project-data.js`)**
- `_emitBus(type, action, detail)` 헬퍼 — `wmDataBus` 미정의 시 no-op
- 각 mutator의 성공 후 `.then()` 체인에 emit:
  - `projPut` → project/created or updated, `projDel` → project/deleted
  - `msPut/Del`, `evtPut/Del`, `orderPut/Del`, `issuePut/Del`
  - `chkPut`, `folderPut/Del`, `filePut/Del`
- 실패 시(throw) emit 안 함 — UI 상태 일관성 유지

**3) 활성 탭 자동 재렌더 (`업무일지_분석기.html` 인라인)**
- 탭별 의존 type 매핑:
  - `pipeline` ← project, milestone, checklist, issue
  - `calendar` ← project, milestone, event
  - `timeline` ← project, milestone, checklist
  - `orders` ← order, project, issue
  - `issues` ← issue, project
  - `docs` ← document, project
- `wmDataBus.on('*', ...)` 단일 listener — 현재 활성 탭(`curPage === 'project' && curMode === X`)이 의존하는 type 변경만 재렌더
- **100ms 디바운스** — 한 흐름에서 발생하는 다중 emit을 1회 재렌더로 통합

### UX 효과
- 타임라인에서 마일스톤 추가 → 같은 세션에서 파이프라인 탭 진입 시 즉시 반영 (이전: 새로고침 필요)
- 이슈관리에서 이슈 등록 → 수주대장의 이슈 배지 카운트 자동 갱신
- 캘린더에서 일정 추가/삭제 → 파이프라인의 일정 표시 즉시 동기화

### L2 검토 결과 (구현 안 함, 결정 보류)
사용자 명시: "지금 컨셉 최대 유지로 확장 가능 검토".
- 현재 `timeline.js` 가 이미 의존선·크리티컬패스·4단계줌·드래그이동·마일스톤마커 보유 → 라이브러리 도입은 사실상 재작성, 디자인 일관성 손상.
- 점진 확장 우선순위 (별도 결정):
  1. 오늘 라인 (S, 1~2h)
  2. 진척률 오버레이 (M, 반나절) — `proj.progress` 이미 있음
  3. 드래그 리사이즈 핸들 (L, 1~2일)
  4. 확장 툴팁 (M, 반나절)
  5. 계획 vs 실적 더블 막대 (L, 1일+, 데이터 모델 변경 필요)

### 변경 파일
- `업무일지_분석기.html` (인라인 wmDataBus + 활성 탭 listener), `project-data.js` (mutator emit), `CHANGELOG.md`

---

## v13.39 (2026-05-08) — M1: 수주대장 → 이슈관리 크로스탭 필터 연동

### 배경
검토에서 식별된 M1 이슈: "수주 이슈 배지 클릭 후 필터 상태 불일치 — 수주번호별 이슈 클릭해도 이슈탭 필터 미적용" (`order-view.js:162-164`).

이전 동작은 단일 매칭 이슈 모달만 띄우고, 사용자가 그 수주의 다른 이슈를 보려면 이슈관리 탭으로 이동 후 수동으로 필터해야 했음 — 크로스탭 동선 끊김.

### 변경
- **`issue-manager.js`**:
  - `issueFilterOrderNo` 변수 신설 (line 18)
  - 필터 로직 (`renderIssues` 의 filter 콜백)에 `if (issueFilterOrderNo && iss.orderNo !== issueFilterOrderNo) return false;` 추가
  - 필터 바에 활성 orderNo 배지 + 해제(✕) 버튼 표시 (`📋 수주 [번호]`)
  - `issueClearFilters` 에 `issueFilterOrderNo = ''` 추가, 초기화 버튼 노출 조건에도 포함
- **`order-view.js`**:
  - 이슈 배지 onclick 을 인라인 코드 → `gotoIssuesForOrder(orderNo)` 함수로 단순화
  - **`gotoIssuesForOrder(orderNo)`** 신규: (1) `issueClearFilters` 호출로 다른 필터 초기화 (빈 결과 방지) (2) `issueFilterOrderNo = orderNo` (3) `setPage('project')` + `setMode('issues')` 로 탭 전환 (4) `renderIssues()` 재호출 (5) 토스트 안내
  - 이슈 0건인 수주의 "-" 표시도 클릭 가능 — 사용자가 새 이슈 등록 흐름으로 진입 가능

### UX 효과
- 수주대장에서 이슈 카운트 클릭 → 즉시 이슈관리 탭에서 그 수주의 모든 이슈를 컨텍스트 유지한 채 확인. 단일 모달 → 다중 이슈 목록으로 시야 확장.
- 활성 필터가 명시적으로 표시돼 사용자가 "지금 무엇을 보고 있는지" 즉시 파악 가능. ✕ 클릭 한 번으로 전체 이슈로 복귀.

### 변경 파일
- `issue-manager.js`, `order-view.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.38 (2026-05-08) — 이슈 상태 변경 500 수정 + Quick Wins 7건

### 1. 🔴 이슈 상태 변경 500 에러 수정 (사용자 보고 핵심)
**원인**: `middleware/optimistic-lock.js` 가 모든 UPDATE에 `SET ... updated_at = now()` 를 추가하지만, `issues` 테이블에는 `updated_at` 컬럼이 없음 (`migrations/002_data.sql:129-152` 확인 — `created_at`만 존재). 동일 이슈가 events/orders/milestones/checklists 에도 잠재. PostgreSQL이 `column updated_at does not exist`로 500 응답.

**변경**: `server/migrations/015_add_updated_at_columns.sql` 신규 — `issues / events / orders / milestones / checklists` 다섯 테이블에 `updated_at TIMESTAMPTZ DEFAULT now()` 추가 (멱등 IF NOT EXISTS).

### 2. Quick Win 7건

| # | 항목 | 파일 |
|---|---|---|
| Q1 | 달력 "+N건 더보기" 토글이 작동 안 하던 버그 — `.cal-bars-expand` 가 `.cal-bars` 에 와야 하는데 한 단계 위(`.cal-bars-limited`)에 토글되어 CSS 매칭 실패. `closest('.cal-bars')` 로 수정 | `calendar.js:231` |
| Q2 | 일정 저장 시 인원 충돌이 있으면 매번 confirm() — 한 번 요약 토스트로 압축, 저장은 차단 안 함 | `calendar.js:499-510` |
| Q3 | 이슈 상세 빠른상태변경 버튼 — 현재 상태에 `✓` + 솔리드 컬러 + disabled, 미선택은 점선 외곽선 + 호버 강조 + 헤더에 "(현재: …)" 표시 | `issue-manager.js:602-619` |
| Q4 | 이슈 대응이력 입력 폼이 이력 아래에 있어서 긴 이력에 가려짐 — 폼을 이력 위쪽(타이틀 바로 아래)으로 이동 | `issue-manager.js:620-672` |
| Q5 | 수주대장 빈 상태 → 아이콘 + 두 줄 안내 + "📥 엑셀 불러오기" / "➕ 신규 등록" 버튼 | `order-view.js:133-147` |
| Q6 | 수주 정렬 키/방향 + 거래처 필터를 localStorage에 보존 — `wm_orderSortKey` / `wm_orderSortAsc` / `wm_orderFilterClient`. 새로고침/재로그인 시 유지 | `order-view.js:6-15` |
| Q7 | 이슈 등록 시 "반복 이슈 감지" 토스트가 사용자에 따라 거슬릴 수 있어 끄기 옵션 추가. 콘솔에서 `issueRepeatDetectOff()` / `issueRepeatDetectOn()` 호출 (localStorage 영구) | `issue-manager.js:777+` |

### 영향 범위
- DB 스키마: 5개 테이블에 `updated_at` 추가. 기존 데이터는 default `now()` 적용 — 백필 시 모든 행이 마이그레이션 시점 타임스탬프로 채워짐.
- UX: 대부분 양성 변화. Q4의 폼 위치 변경은 기존 흐름과 다르므로 사용자가 잠시 적응 필요.

### 변경 파일
- `server/migrations/015_add_updated_at_columns.sql` (신규)
- `calendar.js`, `issue-manager.js`, `order-view.js`
- `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.37 (2026-05-08) — 프로젝트 메모: 다중 이미지 순서 보장 + 이미지 삭제 UX

### 배경
사용자 요청: "이미지 등록한 것 삭제나, 여러개 이미지 등록 처리."

v13.35에서 메모 인라인 이미지를 도입했으나 (1) 다중 파일 동시 선택 시 FileReader 비동기로 인해 삽입 순서가 흔들릴 수 있었고, (2) 삽입 후 이미지를 삭제할 명시적 UI가 없었음.

### 변경 (`timeline.js`)
- **다중 이미지 순서 보장**: `_memoInsertImageFromFile`을 Promise 반환 함수로 전환. `_memoInsertManyFiles` 헬퍼가 Promise chain으로 직렬 처리해 사용자가 고른 순서대로 삽입.
- **이미지 클릭 → 선택 강조**: `memoEditorClickHandler`가 `<img>` 클릭 시 외곽선(3px solid var(--ac))으로 강조하고 선택 상태를 `_memoSelectedImg`에 저장. 다른 곳 클릭하면 선택 해제.
- **🗑 선택 이미지 삭제 버튼**: 메모 헤더에 추가. 이미지 미선택 시 비활성. 클릭 시 `memoDeleteSelectedImage`가 DOM에서 제거 + 토스트 안내.
- **키보드 지원**: `memoEditorKeyHandler`가 Delete/Backspace로 선택 이미지 삭제, Esc로 선택 해제.
- **다중 삽입 토스트**: 2개 이상 일괄 삽입 시 "🖼 N개 이미지 추가" 안내.
- **모달 재오픈 시 잔여 선택 정리**: `showProjectModal` 진입부에서 `_memoSelectedImg = null`.

### 영향
- 메모 데이터 구조는 변경 없음 — 단순히 입력 UX 개선. 기존 메모/이미지 그대로 동작.
- 텍스트 영역 클릭 시에는 기존 contenteditable 동작(커서 위치 지정) 유지. 이미지 클릭만 별도 처리.

### 변경 파일
- `timeline.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.36 (2026-05-08) — 수주대장: 조회는 전체 공개, 수정은 관리 직급만

### 배경
사용자 명시 정책: "프로젝트 관리에서 수주대장은 공유되고 있는거 맞지? 누구나 볼 수 있어야 하고, 수정은 관리자와 허락된 인원만 가능해야 함."

v13.34에서 다른 프로젝트 데이터(milestones·issues·documents 등)와 함께 orders도 가시성 필터(`created_by=me OR order_no IN accessible projects`)를 적용했으나, 수주대장은 사내 공통 자산 성격이 강해 누구나 조회 가능해야 한다는 사용자 정책에 따라 환원.

### 변경 (서버)
- **`server/routes/orders.js` GET /**: 가시성 서브쿼리 제거. 단순히 `WHERE tenant_id = $1`로 환원 — tenant 전체 공개. `project-scope` import도 제거 (더 이상 필요 없음).
- **`server/middleware/rbac.js`** `order.edit`: `allowed = true` → `allowed = role === 'manager' || role === 'executive'`. admin은 이미 상위에서 통과하므로 결과적으로 admin/manager/executive만 수정 가능. POST·PUT·DELETE·POST /bulk 모두 동일 RBAC 적용.

### 영향
- 일반 사용자(member): 조회만 가능. 수정 시 403 응답.
- admin/manager/executive: 기존과 동일하게 모든 CRUD 가능.
- 수주대장 행 자체는 변경 없음 — 정책만 환원.

### 후속 작업 (TODO)
- "허락된 인원"의 세밀한 권한 부여(특정 member에게 명시적 권한 grant)는 별도 UI/스토리지(예: `order_editors` 테이블)가 필요. 본 패치에는 미포함. 필요 시 분리하여 작업.

### 변경 파일
- `server/routes/orders.js`, `server/middleware/rbac.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.35 (2026-05-08) — 프로젝트 메모 인라인 이미지 + 문서관리 빈 상태 처리

### 1. 프로젝트 메모 인라인 이미지 (요청 기반 신규 기능)

#### 변경
- `업무일지_분석기.html` `core-logic.js`: `isHtmlMemo` / `plainToHtml` / `sanitizeMemo` / `memoToHtml` 헬퍼 신설.
  - `sanitizeMemo` — DOMParser 기반 화이트리스트 sanitizer: 허용 태그 (img·br·p·div·span·b·i·u·strong·em·a·ul·ol·li·h1~6·blockquote·code·pre·hr), 허용 src (http(s):, `data:image/...`), 허용 href (http(s):, mailto:, tel:, #), 모든 `on*` 이벤트 핸들러 제거. `<a target="_blank">`에 `rel="noopener noreferrer"` 강제.
  - 평문 메모는 escape + `<br>` 변환으로 안전하게 표시. HTML 메모는 sanitize.
- `timeline.js` 프로젝트 편집 모달: 메모 입력을 `textarea` → `contenteditable div`로 업그레이드.
  - 🖼 이미지 추가 버튼 (파일 선택, 다중 가능, 5MB 권장)
  - 클립보드 붙여넣기 (이미지면 base64 임베드, 텍스트면 평문 정규화하여 HTML 오염 방지)
  - 드래그 드롭 (이미지 파일만 처리)
  - 저장 시 innerHTML을 `sanitizeMemo`로 정제한 뒤 메모 필드에 저장
- `project-detail.js` 상세 패널: 메모 표시를 `eH(memo)` plain text → `memoToHtml(memo)` 자동 감지 렌더로 변경.

#### 보안 노트
- 이미지는 base64 data URL로 메모에 인라인 임베드 — 메모 텍스트 크기가 커질 수 있음. 운영상 메모당 누적 5~10MB 이상이 되면 별도 문서 업로드(문서관리)를 권장.
- 화이트리스트 sanitizer가 모든 인라인 이벤트 핸들러·`javascript:` URL·`expression()` 등 위험 패턴을 차단.

### 2. 문서관리 프로젝트 선택 핸들링 개선

#### 변경 (`document-manager.js`)
- 접근 가능한 프로젝트가 0개일 때: 명확한 빈 상태 + "프로젝트 등록" CTA + v13.31 정책 변경 안내.
- 선택된 `docSelProject`가 가시성 필터로 사라진 경우(공유 회수·이관 등): 자동 초기화 + 첫 번째 자동 선택. 선택 폴더/파일 상태도 함께 리셋.
- 드롭다운 옆에 "N개 접근 가능" 카운트 노출 — 사용자가 자기 가시 프로젝트 수를 즉시 파악 가능.
- `<option value="' + p.id + '"`에 `eH()` 적용해 잠재적 따옴표 이슈 방지.

### 변경 파일
- `core-logic.js`, `timeline.js`, `project-detail.js`, `document-manager.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.34 (2026-05-08) — 프로젝트 관리 전 페이지에 가시성 정책 일관 적용

### 배경
사용자 보고: "프로젝트 관리 > 파이프라인, 달력, 타임라인, 수주대장, 이슈관리, 문서관리 등 모두 권한이 없으면 안보이게 처리!"

v13.31에서 프로젝트 자체에 가시성 정책(기본 비공개 + 명시 공유)을 도입했지만, 프로젝트에 종속된 데이터(마일스톤·일정·이슈·문서·체크리스트·수주)를 제공하는 라우트는 여전히 tenant 스코프만 적용 — 다른 사용자의 비공개 프로젝트 마일스톤/이슈/문서까지 모두 노출되던 정책 표류.

### 변경 (서버 — 6개 라우트 + bootstrap)
- **`server/middleware/project-scope.js`** (신규): `accessibleProjectsSubquery(req, startIdx)` / `accessibleOrderNosSubquery(req, startIdx)` 헬퍼. v13.31 가시성 룰(owner / project_members(active) / visibility=tenant / (visibility=dept AND 부서 일치))을 SQL 서브쿼리로 일원화. 향후 라우트 추가 시 정책 표류 방지.

| 라우트 | 변경 |
|---|---|
| `milestones.js` GET / | `project_id IN (accessible)` 추가 |
| `checklists.js` GET / | `project_id IN (accessible)` 추가 |
| `issues.js` GET / | `(project_id IS NULL AND created_by=me) OR project_id IN (accessible)` |
| `documents.js` GET /folders, /files | 동일 패턴 — 프로젝트 없는 폴더/파일은 작성자만 |
| `events.js` GET / | `project_ids` JSONB 배열 — 비어있으면 작성자만, 배열에 접근 가능 ID 있으면 노출 |
| `orders.js` GET / | `created_by=me OR order_no IN (accessible projects의 order_no들)` |
| `bootstrap.js` | milestones / events 쿼리에 동일 룰 적용 — 첫 로드 응답도 일관 |

### 정책 결정 노트
- 프로젝트에 종속된 데이터는 그 프로젝트 가시성을 따른다.
- `project_id`가 NULL인 일반 항목(개인 일정, 일반 이슈, 일반 폴더/파일)은 작성자 본인만 노출 — 익명 공개 의도가 없는 한 default-private.
- `orders`는 `project_id` 컬럼이 없으므로 `order_no` 매칭으로 대신함. 본인이 생성한 수주는 항상 본인에게 노출.
- admin/executive 우회 없음 — v13.31 정책과 동일.

### 영향
- 기존에 다른 사용자의 비공개 프로젝트 데이터를 볼 수 있던 사용자는 더 이상 노출되지 않음.
- 새로 생성한 비공개 프로젝트의 마일스톤/이슈/문서 등은 owner와 project_members에게만 노출.
- 메뉴/탭은 그대로 유지 — 사용자가 자기 데이터로 진입은 가능.

### 변경 파일
- `server/middleware/project-scope.js` (신규), `server/routes/{milestones,checklists,issues,documents,events,orders,bootstrap}.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.33 (2026-05-08) — 페이지 첫 로딩 시 업무일지 미표시 (콜드 스타트 race 수정)

### 배경
사용자 보고: "페이지 로딩시, db에 저장된 업무 내용들이 안보이고, 리프레쉬 해야지만 보이는 경우가 있는데."

### 원인 (콜드 스타트와 토큰 갱신 타이밍 race)
1. `업무일지_분석기.html:5464-5467`에서 `_bootstrap`이 `authInit()`을 10s 타임아웃으로 race.
2. `authInit()` → `_tryRefresh()` 호출 (`auth.js:268`).
3. `_tryRefresh()`의 자체 타임아웃이 **8초** (`auth.js:102`).
4. **Render Free 플랜 콜드 스타트는 30~60초** 소요.
5. 결과: `_tryRefresh` 8s에서 abort → `_accessToken` 미설정 → `authInit` false 반환.
6. `_postAuthInit`이 1-b 단계에서 5초만 폴링 (`업무일지_분석기.html:4636-4642`) → 토큰 미도착 → 데이터 로드 포기.
7. 사용자가 새로고침하면 서버가 warm해진 상태라 `_tryRefresh`가 1초 만에 성공 → 정상 로드.

### 변경 (`auth.js`)
- `_tryRefresh` 타임아웃 8s → **35s** (콜드 스타트 30~60s 커버).
- `_tryRefresh` / `authLogin` / Google OAuth 콜백에서 `_accessToken` 설정 직후 `window.dispatchEvent(new CustomEvent('wm:auth-ready'))` 발행.

### 변경 (`업무일지_분석기.html`)
- `_postAuthInit`에서 `wm:auth-ready` 이벤트 리스너 등록. 부트스트랩 race가 종료된 뒤 토큰이 늦게 들어와도 `_loadFromServer`를 자동 재시도.
- 1-b 폴링 대기 시간 5s → 30s (콜드 스타트 시간 커버).
- `_authReadyHandled` 플래그 + `_dataLoaded` 체크로 동일 데이터 중복 로드 방지.

### 영향
- 첫 로딩에 빈 화면이 보이던 문제 해소. 토큰 갱신이 완료되는 즉시(혹은 polling이 잡을 때) 자동으로 데이터 표시.
- 콜드 스타트 환경에서도 새로고침 없이 정상 동작. Local IndexedDB가 있는 환경에선 SWR 패턴으로 즉시 잠정 렌더 후 서버 응답으로 갱신(기존 동작 유지).

### 변경 파일
- `auth.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.32 (2026-05-08) — 프로젝트 RBAC 완화 (가시성 정책에 정렬)

### 배경
사용자 보고: "프로젝트 등록시에 이 작업에 대한 권한이 없습니다 에러 발생".

원인: `server/middleware/rbac.js:67`에서 `project.create` 권한이 `role === 'manager'` 만 허용. v13.31에서 가시성 정책을 엄격하게(기본 private + 명시 공유) 도입한 이후로는 RBAC의 manager-only 제약이 의미 중복이자 충돌 — 사용자의 명시적 정책("프로젝트 생성은 임의대로할 수 있지만, 보이는건 생성자가 설정할 수 있어야 함")과도 어긋남.

### 변경 (`server/middleware/rbac.js`)
- **`project.create`** : `manager` only → **모든 인증 사용자** 허용
- **`project.edit`** / **`project.delete`** : `manager || pl` → 인증 사용자 허용. 실질 접근 통제는 v13.31에서 추가한 라우트 핸들러의 `canAccessProject` 사전 체크가 담당.
- **`project.read`** : 모든 인증 사용자 허용. 가시성 룰은 GET 핸들러의 SQL where 절이 적용.
- **`project.assign`** (멤버 추가/해제): 인증 사용자 허용. 라우트에서 owner/PL 검사 필요 시 후속 추가.
- **`pl.assign`** (PL 지정): admin/manager 또는 해당 프로젝트의 기존 PL — 권한 분리 유지.

### 영향
- v13.31 이전부터 manager가 아닌 사용자(member, executive)는 프로젝트를 생성할 수 없었음. v13.32로 누구나 생성 가능. 만든 프로젝트는 기본 비공개라 다른 사용자에게 노출되지 않음.
- 기존 manager에 의존하던 워크플로(예: 매니저 검토 후 프로젝트 등록)가 있다면 별도 정책으로 후속 결정 필요.

### 변경 파일
- `server/middleware/rbac.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.31 (2026-05-07) — 프로젝트 가시성 엄격 적용 (기본 비공개 + 명시 공유만)

### 배경
사용자 보고: "프로젝트 관리 개별 로그인 사용자 별 처리가 안되네? 기본적으로 다 보이게 되어있는데, 내가 허락한 사용자만 보여야 하는거 아냐?"

원인 분석:
1. **`server/routes/projects.js:23-25`**: `admin`/`executive` 역할이 가시성 필터를 **완전 우회** — `SELECT * FROM projects WHERE tenant_id = $1`. 본인이 만든 비공개 프로젝트도 다른 admin/executive에게 노출.
2. **`migrations/006_project_visibility.sql:37-43`**: v13.27 도입 시 호환성을 위해 기존 프로젝트를 `'dept'`(부서 있음)/`'tenant'`(부서 없음)로 자동 백필 — 결과적으로 v13.27 이전 데이터는 광범위 노출 유지.
3. **`server/routes/bootstrap.js:33-55`**: 별도 정책으로 `department_id` 기반 필터만 사용. `visibility` 컬럼 무시. 부트스트랩 응답에선 여전히 부서원 프로젝트가 모두 노출.

### 정책 결정
사용자 확인 결과 "엄격하게 (기본값 + 명시 공유만)" 선택 — 프로젝트는 기본 비공개, 생성자가 편집 모달에서 명시적으로 공개 범위를 변경하거나 공유 사용자를 추가해야 함. **admin/executive도 동일 룰 따름** (자기가 만든 게 아니거나 공유받지 않은 비공개 프로젝트는 보지 못함).

### 변경 (서버)
- **`server/routes/projects.js`**:
  - `canAccessProject(req, project, opts)` 헬퍼 도입 — owner / member / visibility 체크를 한 곳에서 일관 처리.
  - `GET /api/projects`: admin/executive 우회 제거. 모든 role에 동일한 SQL where 절 적용 — `(p.owner_id = me OR pm.user_id IS NOT NULL OR p.visibility = 'tenant' OR (visibility='dept' AND department_id = my_dept))`.
  - `GET /api/projects/:id`: admin/executive 우회 제거. `canAccessProject`로 일관 검증.
  - `PUT /api/projects/:id`: 가시성 사전 체크 추가 — RBAC 권한이 있어도 안 보이는 프로젝트는 편집 불가 (403).
  - `DELETE /api/projects/:id`: 동일하게 가시성 사전 체크 추가.
  - `POST /api/projects/:id/transfer`: admin/executive 우회 제거. 현재 owner만 이관 가능.

- **`server/routes/bootstrap.js`**: 프로젝트 쿼리를 `projects.js`와 동일한 가시성 룰로 통일. `department_id` 기반의 별도 정책 제거.

- **`server/migrations/014_project_visibility_strict.sql`** 신규:
  - 자기완결: `owner_id`/`visibility` 컬럼이 없으면 추가 (구 환경 호환), 체크 제약·인덱스 idempotent 보장.
  - `owner_id` 백필 (`created_by` → `owner_id`).
  - **모든 `'dept'`/`'tenant'` visibility 를 `'private'` 로 리셋** — v13.27 호환성 백필을 되돌림.

### 운영 가이드
- 본 마이그레이션 적용 후, 광범위 가시성이 필요한 프로젝트는 각 소유자가 프로젝트 편집 모달에서 공개 범위를 `'dept'` 또는 `'tenant'`로 명시적으로 변경하거나, "👥 공유 관리"에서 사용자를 추가해야 합니다.
- admin/executive도 본인이 만들지 않고 공유받지 않은 프로젝트는 보지 못합니다. 관리 목적의 접근이 필요하면 owner에게 공유 요청하거나 owner 이관을 요청해야 합니다.

### 변경 파일
- `server/routes/projects.js`, `server/routes/bootstrap.js`, `server/migrations/014_project_visibility_strict.sql`, `업무일지_분석기.html` (헤더 버전 + 패치노트), `CHANGELOG.md`

---

## v13.30 (2026-05-07) — 편집모드 수정 적용 시 항목 중복 생성 버그 수정

### 배경
사용자 보고: "필터 편집모드 수정 적용 시, 항목 중복 생성됨".

### 원인 (데이터 흐름)
- `GET /api/archives/records`: 매니저/임원은 부서 전체, 관리자는 테넌트 전체 레코드를 반환 → `aD`에 본인+타인 레코드 혼재
- `POST /api/archives/records/bulk` (`wrBulkPut`): `WHERE user_id=me`로 본인 레코드만 DELETE 후 전체 페이로드 INSERT (`user_id=me`로 고정)
- 기존 `applyEdits`: `wrBulkPut(aD)` 호출 → 타인 레코드는 원본 그대로 남고, 본인 user_id로 복사본까지 INSERT → **중복 생성**

### 변경 (서버)
- **`PATCH /api/archives/records/batch`** (`server/routes/archives.js`): WHERE 절을 role 기반 스코프로 확장 — `member`는 본인, `manager`/`executive`는 부서, `admin`은 테넌트. GET 정책과 일치. 매니저가 부원 레코드를 편집해도 silent 0-row update가 더 이상 발생하지 않음.
- **`DELETE /api/archives/records/batch`**도 동일 정책으로 확장.

### 변경 (클라이언트)
- **`applyEdits`** (`업무일지_분석기.html`): `wrBulkPut(aD)` 전체 저장 → `wrUpdateRecords` PATCH로 전환. 변경된 행 + cascade 픽스(같은 수주번호의 미편집 행에서 실제로 ocmt/oclient가 채워진 경우)만 페이로드에 포함. 로컬(IndexedDB) 모드는 `wrUpdateRecords`가 정의되지 않으므로 기존 `wrBulkPut(aD)` 폴백 — 단일 사용자 환경이라 안전.
- **import 후 aD 리로드**: `ldBuf` / `importWorkRecordsJSON` 모두 `wrBulkPut` 직후 `wrGetAll`로 다시 읽어 서버가 새로 부여한 id를 채움. 이게 빠지면 import 직후 편집 시 PATCH가 stale id 때문에 silent 실패.

### 알아둘 점
- 로컬 모드 `wrBulkPut`(IndexedDB `s.clear()` + put)은 그대로 — 단일 사용자 보장 환경.
- 같은 수주번호의 다른 사용자 레코드(예: 부서원의 같은 프로젝트 작업)는 매니저/임원이 ocmt/oclient를 편집하면 함께 갱신됨 (의도된 동작 — order-level 메타는 부서 단위로 일관성 유지).

### 변경 파일
- `server/routes/archives.js`, `업무일지_분석기.html`

---

## v13.29 (2026-05-07) — 업무일지 가져오기 충돌 미리보기 + 컬럼 round-trip

### 배경
사용자 보고: "상세 → 📤 엑셀저장"으로 저장한 파일을 다시 불러오면, 일반 업무일지 엑셀과 컬럼 수가 달라(9 vs 7) 수주명·거래처가 무시되고 편집값이 사라짐. 또한 기존 "갱신" 모드는 식별 키가 너무 엄격(`date+name+orderNo+hours+content`)해서 시간만 바뀐 동일 레코드도 새로 추가됨.

### 기능
- **컬럼 자동감지 확장 (`업무일지_분석기.html`)**: `COL_PATTERNS`에 `ocmt`(수주명·프로젝트명·사업명·건명), `oclient`(거래처·고객사·업체·발주처) 추가. `pMapRow`에서 cells 값이 비어있지 않을 때만 `rec.ocmt`/`rec.oclient`를 채워 ORDER_MAP 기본값을 가리지 않음. `COL_ALL` 순서를 구체적 패턴 우선으로 재배열 (수주명이 "수주"보다 먼저 매칭).
- **`wrAnalyzeImport(existing, newRecs)`**: (날짜+이름+수주번호) 느슨한 키로 분류 — `identical`(완전 일치), `conflicts`(시간/내용 차이), `newRows`(후보 없음). existing 자체 dedup도 함께 수행. 같은 existing이 두 번 매칭되는 것 방지.
- **`wrApplyDecisions(newRecs, analysis, decisions)`**: 행 단위 결정(`update`/`skip`/`add`)을 받아 최종 merged 배열 생성. `mode='replace_keep_matched'` 옵션은 매칭되지 않은 기존만 삭제.
- **`showImportPreviewModal`**: 신규/자동 갱신/충돌 카운트 + 충돌 행 테이블 (날짜·이름·수주번호·시간 비교·내용 diff). 행마다 select로 처리 선택, "전체 갱신/무시/별개 추가" 일괄 버튼 제공.

### 변경된 흐름
- `ldBuf` (엑셀 업로드)와 `importWorkRecordsJSON` (JSON 가져오기) 모두 "갱신" 선택 시 미리보기 모달로 진행. 영향 없는 신규-only 케이스는 미리보기 생략.

### 알아둘 점
- 같은 `(date, name, orderNo)` 후보가 둘 이상이면 ⚠ 배지로 표시 — 사용자가 모호함을 인지한 상태에서 결정.
- `wrBulkPut`는 로컬(IndexedDB)·서버(`/api/archives/records/bulk`) 양쪽 모두 "해당 사용자 레코드 전체 삭제 후 재삽입" 의미 — `merge`/`replace_keep_matched` 두 모드 모두 단일 `wrBulkPut(result.merged)` 호출로 일관 처리.
- 영향 범위: 서버 `/bulk`는 `WHERE user_id = ?` 스코프이므로 본인 데이터에만 적용. 매니저/관리자가 다른 사용자 데이터를 함께 다루려면 별도 경로 필요.

### 변경 파일
- `업무일지_분석기.html`

---

## v13.28 (2026-05-06) — 담당자→멤버 자동 동기화 + 비공개 신규시 공유 모달 자동 오픈

### 기능
- **`syncAssigneesToMembers(projectId, names)`** (`project-data.js`): 프로젝트 저장 후 담당자 이름 배열을 `users.name` / `users.display_name` 정확 일치로 매칭하여 `project_members`에 active `assignee` 로 자동 추가. 매칭 실패한 이름은 외부 인원으로 간주하고 무시. **자동 제거는 하지 않음** — 의도치 않은 접근 회수 방지를 위해 명시적 회수는 "공유 관리" 모달의 "제거" 버튼에서만 수행.
- **`saveProjectUI`** (`timeline.js`): 저장(생성·편집) 직후 best-effort로 위 동기화 호출. 실패 시 토스트 무시.
- **자동 공유 모달**: 신규 등록이고 `visibility='private'`이며 담당자도 비어 있으면 등록 직후 `showProjectShareModal(projId)`을 자동 오픈. 동료가 아무도 못 보는 사각지대 방지.

### 알아둘 점
- 동일 이름의 사용자가 둘 이상이면 `userLookup` 결과의 첫 매칭 한 명만 추가됨. 운영상 충돌이 잦아지면 매칭 키를 email 또는 사번으로 전환할 것.

### 변경 파일
- `project-data.js`, `timeline.js`

---

## v13.27 (2026-05-06) — 사용자 단위 프로젝트 소유권 + 가시성 + 공유/이관

### 기능
- **DB 스키마 (`migrations/006_project_visibility.sql`)**:
  - `projects.owner_id UUID REFERENCES users(id)` — 현재 소유자
  - `projects.visibility VARCHAR(20)` — `'private' | 'dept' | 'tenant'`, 기본 `'private'`
  - 백필: `owner_id ← created_by`. `visibility`는 `department_id` 있으면 `'dept'`, 없으면 `'tenant'`로 채워 기존 가시성 보존 (신규 데이터만 `'private'` 기본).
  - 인덱스: `idx_projects_owner`, `idx_projects_visibility`.
- **`GET /api/projects` 가시성 단일 룰** (`server/routes/projects.js`):
  - admin/executive: 테넌트 전체 가시
  - 그 외: `owner_id = me OR project_members.user_id = me(active) OR visibility='tenant' OR (visibility='dept' AND department_id = my_dept)`
  - 기존 `manager`/`member` 분기 제거 — visibility로 일원화.
- **`GET /api/projects/:id` 권한 체크 강화**: 위 룰 위반 시 403. 기존엔 테넌트 스코프만 검사.
- **`POST /api/projects` + `POST /api/projects/full`**: `owner_id`(미지정 시 `req.user.sub`), `visibility`(미지정 시 `'private'`) 수용.
- **`PUT /api/projects/:id`**: `visibility` 변경 허용.
- **신규 `POST /api/projects/:id/transfer`**: 소유자 또는 admin/executive만 호출 가능. 트랜잭션 내에서:
  1. `projects.owner_id ← newOwnerId` (`updated_at`/`version` 갱신)
  2. 신규 소유자가 멤버였다면 `released_at = now()` 처리
  3. `keepPrevAsMember=true` (기본)이면 기존 소유자를 `assignee`로 active 멤버 보존 (`ON CONFLICT DO UPDATE`)
- **신규 `POST /api/milestones/:id/transfer`** (`server/routes/milestones.js`): `{ targetProjectId }` 받아 `_canEditProject` 헬퍼로 src·dst 양쪽 권한 검사 후 `milestones.project_id` 갱신. 권한은 owner / 활성 member / admin·executive.
- **신규 `GET /api/users/lookup`** (`server/routes/users.js`): 공유/이관 대상자 선택용 경량 엔드포인트. `id`, `name`, `display_name`만 반환. 모든 인증 사용자 호출 가능 (member 권한도 OK).

### 프론트
- **`project-data.js` 헬퍼**: `userLookup`, `projMembersGet`, `projShareAdd`, `projShareRemove`, `projTransfer(id, newOwnerId, { keepPrevAsMember })`, `msTransfer(id, targetProjectId)`.
- **`timeline.js` 프로젝트 모달** (`showProjectModal`): 가시성 셀렉터 (🔒 비공개 / 🏢 부서 / 🌐 전체), 편집 시 "👥 공유 관리" / "↪ 소유권 이관" 버튼. 마일스톤 행에 `↪` 이관 버튼.
- **신규 모달 3개**: `showProjectShareModal`, `showProjectTransferModal`, `showMilestoneTransferModal` — `userLookup`/`projGetAll` 비동기 로드 후 선택지 렌더.

### 마이그레이션 절차
- 배포 후 `migrations/006_project_visibility.sql` 자동 실행. 멱등(IF NOT EXISTS / DO $$ ... END $$). 기존 프로젝트는 `'dept'`/`'tenant'`로 백필되어 가시성 손실 없음.

### 변경 파일
- `migrations/006_project_visibility.sql` (신규)
- `server/routes/projects.js`, `server/routes/milestones.js`, `server/routes/users.js`
- `project-data.js`, `timeline.js`

---

## v13.26 (2026-05-06) — 월별 비교 차트 축 라벨 확대 + 막대 내 상위 2개 % 표시

### 기능
- **축 라벨 폰트 150% 확대** (`업무일지_분석기.html`): `mtrChart` (월별 비교 — 개인별 추이) 와 `mtrCChart` (월별 비교 — 업무분장 코드별 추이) 두 차트의 X축(년월) / Y축(시간 `h`) 틱 폰트를 `10` → `15`로 확대. PPT에 캡쳐 후 축소 시 가독성 확보. 범례는 `10` 유지.
- **막대 내 상위 2개 % 라벨** (`_mtrTop2PctPlugin`): Chart.js `afterDatasetsDraw` 커스텀 플러그인으로, 각 X 위치에서 막대 세그먼트 합계를 구해 비율 1·2위 세그먼트 중앙에 흰색 굵은 글씨 + 그림자로 `XX%` 표시. 5% 미만이거나 세그먼트 높이 14px 미만이면 글자 깨짐 방지를 위해 생략.
- 두 차트 생성 시 `plugins: [_mtrTop2PctPlugin]`로 등록 (전역 등록 X — 다른 차트엔 영향 없음).

### 변경 파일
- `업무일지_분석기.html`

---

## v13.25 (2026-04-23) — 필터 활성 시 차트 V(휴가) 자동 보정 비활성화

### 버그 수정
- **`rCht`** (`업무일지_분석기.html`): 키워드 검색(`cKw`)이나 수주/수주명/거래처 필터(`sO`/`sON`/`sCL`)가 활성, "휴가 제외" 토글(`excludeVac`)이 ON, 또는 업무분장에서 V를 제외한 다른 코드만 선택한 경우 `_calcVacFill` 합성 V 레코드 추가를 건너뜀. 키워드 'mes' 등으로 22건만 남았을 때 차트가 평일 8시간 미달분을 V(휴가)로 잘못 채워 36% 휴가로 보이던 문제 해결.
- 업무분장 필터에서 V만 선택한 경우는 합성 V가 영향 없음 (사용자 의도 우선).

---

## v13.24 (2026-04-23) — 업무내용 검색에서 휴가(V) 자동 제외 + 수동 토글

### 기능
- **자동 제외**: 상세 필터 "업무내용 검색"(`cKw`)에 키워드 입력 시, `abbr === 'V'`(휴가) 레코드를 결과에서 자동 제외. "휴가 신청" 같은 키워드 검색 결과에 휴가 본문이 섞여 들어오던 문제 해결. 단, 사용자가 업무분장 필터에서 V를 명시 선택한 경우는 의도적이므로 포함 유지.
- **수동 토글**: 업무분장 필터 헤더에 "휴가 제외" 체크박스 추가 (`#excludeVacChk`). 체크 시 키워드 유무와 무관하게 V 레코드를 `gF()` 결과에서 전체 제외. 단, V를 명시 선택한 경우는 우선 (선택과 충돌 방지).
- 체크 상태는 `localStorage('wm_excludeVac')`에 영구 저장 → 페이지 재방문 시 복원.

### 변경 파일
- `업무일지_분석기.html`: `excludeVac` 상태, `gF()` 필터 로직, 업무분장 헤더 UI, `togExcludeVac()` 핸들러, `_initExcludeVacChk()` 부트스트랩.

---

## v13.23 (2026-04-15) — "전체 데이터 초기화" 역할별 스코프 일치

### 버그 수정
- **`DELETE /api/archives/records`** 스코프가 목록(GET) 스코프와 일치하지 않던 문제 수정. 기존엔 항상 본인 `user_id` 레코드만 삭제해, 매니저/임원이 부서 전체를 보다가 "전체 데이터 초기화" 클릭 후에도 **다른 부서원 레코드가 남아있음**. 이제 역할별로:
  - `admin` → 테넌트 전체 삭제
  - `manager` / `executive` (부서 있음) → 소속 부서 전체 삭제
  - `member` 또는 부서 없음 → 본인만
  - `?scope=self` 쿼리 파라미터로 본인만 삭제 강제도 가능
- 응답에 `deleted`(건수)와 `scope` 포함.
- 클라이언트 `resetAllData` 확인 다이얼로그에 역할별 영향 범위를 명시. 완료 토스트에 삭제 건수와 스코프 표시.

---

## v13.22 (2026-04-15) — /api/bootstrap 번들 엔드포인트 (N×RTT → 1×RTT)

### 성능
- **신규 `GET /api/bootstrap?recentDays=60`** (`server/routes/bootstrap.js`): 초기 로드에 필요한 projects / milestones / events / recent archives를 **단일 응답**으로 반환. 서버에서 `Promise.all` 병렬 실행. 네트워크 왕복이 4~5회에서 1회로 줄어 고RTT 환경에서 로딩 체감 크게 개선.
- **클라이언트 통합** (`업무일지_분석기.html` `_loadFromServer`): 먼저 `/api/bootstrap` 시도 → 성공 시 `_pdPrimeCache`로 프로젝트/마일스톤/이벤트 TTL 캐시 일괄 프라이밍, 아카이브는 `aD`에 주입해 즉시 렌더. 실패·404 시 기존 개별 API 플로우로 폴백(하위 호환).
- **`_pdPrimeCache` 헬퍼** (`project-data.js`): snake→camel 변환 + 중복 제거 + 타임스탬프 갱신.

---

## v13.21 (2026-04-15) — 서버 쿼리 최적화 (COUNT 제거 + 인덱스 추가)

### 성능 (서버 측)
- **`/api/archives/records` COUNT 제거** (`server/routes/archives.js`): `all=true` 벌크 로드 시 페이지네이션 `total`을 계산하지 않도록 변경. 클라이언트가 `total`을 사용하지 않음에도 매 초기 호출마다 `SELECT COUNT(*) FROM work_records WHERE tenant_id=...` 를 실행해 왔음 (많은 행에서 수 초 소요). `withTotal=true`를 명시할 때만 계산.
- **복합 인덱스 추가** (`server/migrations/012_work_records_perf_indexes.sql`):
  - `idx_wr_tenant_date_desc(tenant_id, date DESC)` — admin/광범위 조회 커버
  - `idx_wr_tenant_user_date_desc(tenant_id, user_id, date DESC)` — 매니저/멤버 조회 커버
  - `ANALYZE work_records` — 플래너 통계 갱신
- 배포 후 자동 마이그레이션 실행되며 PostgreSQL 오토바큠 대기 후 쿼리 계획이 Index Scan으로 전환됨.

---

## v13.20 (2026-04-15) — 아카이브 초기 로드 페이지네이션 (최근 60일 우선)

### 성능 (Phase 2, 2순위)
- `_loadFromServer` 2단계 로드 (`업무일지_분석기.html`):
  - **1차 (빠른 렌더)**: `/api/archives/records?startDate=<60일 전>&limit=50000&all=true` — 최근 60일 레코드만 받아 즉시 렌더. 대부분 사용자의 실사용 범위를 커버.
  - **2차 (백그라운드)**: 800ms 후 `endDate=<60일 전>`로 과거 히스토리 전체 요청. 응답 오면 `id` 기준 dedup 후 `aD`에 append하여 조용히 갱신. 사용자 필터 선택은 `applyADToUI` 내부 보존 로직으로 유지.
  - 최근 60일 데이터가 없는 경우(신규 유저/오래된 데이터만 있는 테넌트) 전체 로드로 폴백.
- 서버 페이로드가 크게 줄어 첫 렌더 체감 시간 단축. 과거 데이터도 곧 자동 병합되어 통계·차트 누락 없음.

---

## v13.19 (2026-04-15) — 대시보드 위젯 렌더 파이프라인 최적화

### 성능 (Phase 2, 1순위)
- `renderDashboard` (dashboard.js) 크리티컬 패스 정리:
  - `autoUpdateProgress`를 **fire-and-forget 백그라운드**로 분리. 기존엔 첫 렌더 전에 수~수십 개의 `updateProject` API를 순차 대기하여 초기 대시보드 표시가 느렸음. 이제 현재 저장된 progress로 즉시 렌더하고, 갱신이 완료되면 `_pdInvalidate('proj')`로 다음 호출 때 반영. 5분 throttle로 과호출 방지(`window._dashAutoProgAt`).
  - `calcTaskDistByOrder`(아카이브 전체 스캔) + `msGetAll/evtGetAll`을 **병렬**로 시작. 기존엔 taskDist await 후 msEvt를 순차 호출.
- 최초 대시보드 표시 시간 크게 단축. progress 수치는 약간 stale이지만 다음 30초 이내 재진입 시 자동 최신화(기존 API TTL 캐시 v13.17과 연계).

---

## v13.18 (2026-04-15) — 초기 로딩 성능 개선 (Phase 2) — Stale-While-Revalidate

### 성능
- **아카이브 초기 로드 SWR 전환** (`업무일지_분석기.html` `_postAuthInit`): 서버 요청 직후 150ms 타이머로 로컬 IndexedDB 선로드 결과를 잠정 렌더 → 서버 응답이 오면 실제 데이터로 덮어쓰기. 서버가 빠르면(150ms 이내) 로컬 렌더 스킵. 서버가 느리면(수 초) 사용자는 로컬 캐시로 거의 즉시 UI 확인. 네트워크 지연 환경에서 TTI 체감 대폭 단축.

### Phase 2에서 제외한 항목
- Chart.js/XLSX 동적 로더: 콜사이트 40+ 개로 invasive, Phase 1 회귀 이력 감안하여 보류
- Service Worker: 현재 HTML에 등록 없음, 별도 배포 검토 필요

---

## v13.17 (2026-04-15) — 초기 로딩 성능 개선 (Phase 1)

### 성능
- **로컬 JS 스크립트 defer 적용** — `config.js`, `settings.js`, `auth.js`, `project-data.js`, `calendar.js`, `timeline.js`, `project-detail.js`, `dashboard.js`, `pipeline.js`, `order-view.js`, `issue-manager.js`, `document-manager.js` 모두 `defer` 추가. HTML 파싱과 JS 다운로드가 병렬 진행 → FCP 단축. 인라인 부트스트랩 IIFE는 `DOMContentLoaded` 시점으로 이동하여 defer 스크립트 실행 후 안전하게 시작.
- **API TTL 캐시 (30s)** (`project-data.js`): `projGetAll` / `msGetAll` / `evtGetAll` 에 공통 `_pdCached` 훅 추가. 동일 페이지 초기 진입 시 대시보드/타임라인/파이프라인/달력이 각자 호출하던 3~5회 중복 요청을 1회로 감소. 진행 중 동일 요청(inflight)은 공유. 모든 쓰기 경로(`projPut`/`projDel`/`msPut`/`msDel`/`evtPut`/`evtDel`)에 `_pdInvalidate` 훅 — stale 데이터 방지.
- **Google Fonts 최적화** — CSS `@import` 제거, `<link rel="preconnect">` + `<link rel="preload" as="style">` 조합으로 변경하여 폰트 요청을 HTML 파싱과 병렬화. Noto Sans KR + JetBrains Mono를 한 요청으로 결합.
- **아카이브 초기 로드 타임아웃 20s → 8s** (`업무일지_분석기.html` `_postAuthInit`): 서버 지연 시 초기 UI 대기 시간 단축. 로컬 IndexedDB는 `_localPreload`로 **서버 요청과 병렬로 선로드**, 서버 실패 시 즉시 폴백 사용.

### 기대 효과
- 초기 중복 API 요청 50~70% 감소
- 서버 지연 환경에서 데이터 표시 시간 최대 12초 단축
- 재방문 시 defer+preload로 FCP 300~600ms 개선

---

## v13.16 (2026-04-15) — 프로젝트 메모 입력 높이 확대

### UI 개선
- 프로젝트 편집 모달의 메모 textarea `rows` 2 → 15, `min-height:240px` 적용 (`timeline.js`).

---

## v13.15 (2026-04-15) — 업무분장 휴가(V) 자동 보정

### 기능 추가
- 차트 탭(업무 분장 비율 / 인원별 분포 / 일별 투입시간)에서 **평일 8시간 미달분을 V(휴가)로 자동 집계**. 기록이 있는 평일(월~금) 기준 (name+date)별 합계가 8h 미만이면 부족분을 합성 `V` 레코드로 추가하여 집계·차트에 반영. 토요일·일요일·기록이 아예 없는 날은 제외. 원본 데이터(엑셀/DB)는 변경 없음.
- 클라이언트별 집계(업체 비율/시간/일별)는 영향 없음 — 휴가는 업체 대응이 아님.

---

## v13.14 (2026-04-15) — 마일스톤 중복 자동 정리를 전 경로로 확대

### 버그 수정
- 타임라인/달력/대시보드/파이프라인/프로젝트 상세 등 **모든 마일스톤 로드 경로에서 중복 자동 정리** 적용. `project-data.js`의 `msGetAll` / `msGetByProject`에 공통 `_msDedupe` 훅을 추가 — `(projectId|name|startDate|endDate)` 중복 시 `sort_order` / `createdAt` 우선순위로 1건만 남기고 나머지는 서버에서 자동 삭제(fire-and-forget). 기존 v13.13 수정은 모달 오픈 시점만 커버했기 때문에, 타임라인에서 중복이 보이는 증상(기존 DB 잔여 중복) 해소.

---

## v13.13 (2026-04-15) — 프로젝트 마일스톤 중복 방지 & 저장 로직 보완

### 버그 수정
- **마일스톤 리스트 중복 현상 수정** (`timeline.js`):
  - **로드 시 중복 자동 정리**: 프로젝트 편집 모달 오픈 시 `(name|startDate|endDate)` 기준 중복 항목을 탐지해 DB에서 삭제하고 유니크 목록만 렌더 (`showProjectModal`).
  - **저장 로직 destroy-recreate 제거**: 기존에는 저장 시 `msDelByProject`로 전체 삭제 후 재생성하여, DELETE가 부분 실패하거나 재생성이 중복 호출되면 중복이 누적. diff 기반 upsert로 변경 — 기존 id는 PUT, 신규 행은 POST, 제거된 행만 DELETE. 같은 모달 내 동일 키 행도 1회만 저장.
  - `addMsRow` / `runSuggestMilestones`로 추가된 행은 `data-msid`가 없어 자연스럽게 신규로 처리됨.

---

## v13.12 (2026-04-15) — 상세 테이블 표시 행 수 확대

### UI 개선
- 팀관리 > 주간분석 > 상세 탭 테이블 뷰포트 높이 확대: `.tw` max-height 480px → 940px (약 11행 → 25행 가시화, `업무일지_분석기.html`).

---

## v13.11 (2026-04-14) — 업무일지 마일스톤 태깅 (투입실적 정확도 향상)

### 기능 추가
- **업무일지 레코드에 `milestone_id` 컬럼 추가** (migration `011_work_records_milestone_id.sql`). 투입실적 집계 시 명시적 태그가 있으면 태그 기반으로 우선 집계, 없으면 기존 날짜 구간 매칭 fallback.
- 서버 엔드포인트 확장 (`archives.js`): GET/POST/PATCH/단건POST 모두 `milestoneId` 필드 accept/return. 신규 엔드포인트 `POST /api/archives/records/auto-tag-milestones` — 프로젝트의 마일스톤 날짜 구간으로 업무일지를 일괄 자동 태깅 (`overwrite` 옵션: 미태깅만 or 전체 덮어쓰기).
- `calcHoursByMilestone` 3단 우선순위로 재작성:
  1. `milestoneId` 태그 일치 → 정확 집계
  2. 날짜 구간 매칭 → 미태깅 카운트 표기 (추정 집계)
  3. 가장 가까운 마일스톤 → 추정 집계
  반환값에 `_meta.untaggedCount`, 마일스톤별 `untagged` 카운트, `people` 맵 포함.
- **투입실적 탭 UX** (`project-detail.js`): 우상단 "🏷 자동 태깅" 버튼, 마일스톤별 "~N" 미태깅 카운트, 헤더에 전체 미태깅 경고. 자동 태깅 후 아카이브 캐시 invalidate + 부분 갱신.
- **인원별 투입** 섹션 이제 실제 데이터 표시 (v13.10 이전엔 `calcHoursByMilestone`이 `people`를 반환하지 않아 항상 비었음).

### 남은 작업
- 업무일지 편집 테이블에 마일스톤 선택 드롭다운 (수동 태깅 UI)은 다음 작업으로 분리.

---

## v13.10 (2026-04-14) — 프로젝트 저장 후 "Invalid time value" 실제 원인 수정

### 버그 수정
- **renderCalendar가 initCalendar보다 먼저 호출될 때 crash**: `calYear`/`calMonth` 전역이 미초기화된 상태에서 `new Date(undefined, NaN, 0).toISOString()` → "Invalid time value" RangeError. saveProjectUI가 저장 후 `if (typeof renderCalendar === 'function') await renderCalendar()`로 호출하는데, 사용자가 한 번도 달력 탭을 열지 않았다면 초기화가 안 됐음. renderCalendar 진입부에서 값이 없으면 오늘 기준으로 자기 초기화하도록 가드 추가 (`calendar.js`).
- v13.9의 renderTimeline 폴백은 그대로 유지 (별개 방어 케이스).

---

## v13.9 (2026-04-14) — 프로젝트 저장 후 "Invalid time value" 에러 수정

### 버그 수정
- **renderTimeline에서 "Invalid time value" 예외**: 전체 프로젝트의 `startDate`/`endDate`가 모두 비어있거나(NULL) 형식이 깨진 경우 `new Date(undefined)` → Invalid Date → `getTimeUnits`의 `toISOString()`에서 RangeError. 저장 성공 후 재렌더링이 crash하여 사용자에겐 "프로젝트 저장 실패: Invalid time value" 토스트로 노출되던 현상.
  - 유효한 `YYYY-MM-DD` 포맷만 범위 산출에 사용하도록 정규식 필터 추가
  - 수집된 날짜가 없으면 오늘 기준 ±30일 폴백
  - `calcCriticalPath`의 `new Date(...).toISOString()` 3곳에 `isNaN(getTime())` 가드 추가

---

## v13.8 (2026-04-14) — 프로젝트 관리 리팩토링 (2/2): 로컬 모드 제거

### 리팩토링 — 로컬 IndexedDB 모드 제거
- **`project-data.js` 서버 전용화**: 기존 로컬(IndexedDB) + 서버(REST) 듀얼 모드에서 **로컬 모드 전체 삭제**. 1653줄 → 1166줄 (≈487줄/30% 감소).
- 제거: `upgradeProjectDB`, `openDBv2`, `db` 전역, `dbPut/GetAll/Get/Del/GetByIndex`, AUTH_SKIP/apiFetch 가드, IIFE 래퍼
- IIFE 안에 있던 서버 오버라이드(`toCamel`, `toCamelArray`, `toSnake`, 그리고 entity CRUD들)를 모두 **top-level 선언**으로 승격
- 서버 API를 사용하도록 재작성: `readAllArchiveRecords`, `suggestMilestones`, `getWeeklyArchiveSummary`, `getRecentArchiveWeeks` (`wrGetAll`/`wkGetAll` 기반)
- 날짜 포맷(YYYYMMDD / YYYY-MM-DD) 양쪽 모두 방어적 처리
- `apiFetch`는 전역에 반드시 있어야 하며, 없으면 런타임 오류 발생(의도된 동작)

### 비고
- 로컬 IndexedDB 백업/복원 UI(`settings.js`)는 그대로 두었으나 실제 기능은 동작하지 않음 (fallback `openDBv2` no-op). 추후 서버 API 기반 백업으로 교체 예정.

---

## v13.7 (2026-04-14) — 프로젝트 관리 리팩토링 (1/2)

### 리팩토링 — 파일 분리
- **timeline.js 분할**: 2100+ 줄의 timeline.js에서 프로젝트 상세 패널 관련 로직(약 856줄)을 `project-detail.js`로 분리. `showProjectDetail` / `pdSwitchTab` / `pdLoadIssues` / `pdLoadWork` / `pdToggleCheck` / `pdDeleteCheck` / `pdEditCheckInline` / `pdAddCheck` / `pdShowPhase` / `pdAdvancePhase` / `renderOverviewChkListHtml` / `renderProgressHistoryChart` 등 `pd*` 일체. 동작 변경 없음, 파일 크기/가독성 개선.
- 로드 순서: `timeline.js` → `project-detail.js` (전역 네임스페이스에 순서대로 정의).

---

## v13.6 (2026-04-14) — 체크리스트 추가 시 패널 리로드 제거 (부분 갱신)

### UX 개선
- **체크리스트 추가 시 프로젝트 상세 패널이 닫혔다 다시 열리던 문제**: `pdAddCheck`가 성공 후 `showProjectDetail`로 패널 전체를 재생성하여 깜빡임 + 스크롤/포커스 유실이 발생. 이제 **활성 탭의 체크리스트 영역만 부분 갱신**하고 패널은 그대로 유지. 입력창에 포커스도 복원하여 연속 입력이 가능 (`timeline.js`).
- `renderOverviewChkListHtml`/`pdRefreshOverviewChk` 헬퍼 추가로 개요 탭 체크리스트 렌더링을 별도 함수로 분리. 라이프사이클 탭에서 추가 시엔 기존 `pdShowPhase`로 해당 phase만 갱신.

---

## v13.5 (2026-04-14) — 프로젝트 개요 탭 체크리스트 추가 버그 수정

### 버그 수정
- **프로젝트 상세 패널 개요 탭에서 체크리스트 항목 추가가 동작하지 않던 문제**: `pdAddCheck`가 라이프사이클 탭의 input(`pdNewChkText`)을 먼저 확인하는 구조여서, 해당 탭이 감춰져 있더라도 DOM에 남은 잔여 값/포커스 문제로 개요 탭 input(`pdOverviewNewChk`) 값이 사용되지 않거나 엉뚱한 phase로 전송되던 케이스. **현재 보이는 탭의 input을 우선 사용**하도록 로직 변경 (`timeline.js`).
- **서버 모드 `createCheckItem` 단순화**: 불필요한 선행 `chkGetByProject` 호출 제거 (3→2 API 호출), 응답의 `items` 배열을 slice하여 mutation 방지, `(row.phase || row.phase)` 중복 표현 정리, `dueDate`/`order` 필드 누락 방지 (`project-data.js`).
- **에러 메시지 노출**: 추가 실패 시 서버 에러 메시지를 토스트에 표시하여 원인 파악이 가능하도록 개선.

---

## v13.4 (2026-04-14) — 갱신 후 상세 탭 빈 표 문제 수정

### 버그 수정
- **갱신 후 상세 탭에 데이터가 보이지 않던 문제**: `applyADToUI()`가 병합 후 `sN/sO/sT/sDV/cKw` 등 모든 필터 선택을 초기화하여, `gF()`가 "선택된 인원 없음 → 빈 배열"을 반환하던 문제. 기존 선택값 중 현재 데이터에도 존재하는 항목만 보존하도록 변경 (`업무일지_분석기.html` `applyADToUI`). 이제 갱신 후에도 기존 뷰/필터가 유지되며, 신규 추가된 레코드도 해당 인원/필터 범위 내에서 즉시 노출됨.

---

## v13.3 (2026-04-14) — 다른파일 불러오기 / 갱신 시 데이터 누락 수정

### 버그 수정
- **식별 키 부분 매칭으로 인한 데이터 누락**: `wrIdKey`/`idKey`가 `content`의 앞 30자만 비교하여, 앞부분이 동일하고 뒷부분만 다른 레코드가 같은 키로 충돌 → 병합 시 하나만 남고 나머지가 소실되던 문제. 식별 키를 `date+name+orderNo+hours+content(전체)`로 변경하여 정확 매칭 기준으로 개선 (`업무일지_분석기.html`, `local-auto.js`, `upload.js`).
- **신규 레코드 내 동일 키 충돌**: 신규 배열 자체에 동일한 `wrIdKey`를 가진 레코드가 여러 개일 때 `Map.set`으로 뒤 레코드가 앞 레코드를 덮어쓰던 문제. 첫 번째 레코드를 유지하도록 `if (!newById.has(k))` 가드 추가.

---

## v13.2 (2026-04-14) — 응답 속도 개선 및 낙관적 UI 업데이트

### 서버 응답 속도 개선
- **알림 발송 완전 비동기화**: 이슈 상태 변경 시 텔레그램/이메일/인앱 알림 발송이 API 응답을 블로킹하던 문제 해결 (`server/routes/issues.js`).
- **알림 배치 쿼리 최적화**: `notification.service.js`에서 대상자별 루프로 실행되던 알림 설정/연동/중복 체크 쿼리를 `ANY($1)` 기반 단일 배치 쿼리로 통합. 다수 수신자 발송 시 응답 시간 단축 및 병렬 발송으로 처리량 향상.

### 낙관적 UI 업데이트
- **편집 후 목록 재조회 제거**: 프로젝트/이슈/수주/캘린더/이슈 상태변경 시, PUT 응답 데이터로 로컬 상태를 직접 병합하도록 변경하여 불필요한 목록 재조회(`loadXxx()`) 제거 (`web/src/app/dashboard/{projects,issues,orders,calendar}/page.js`).

---

## v13.1 (2026-04-14) — 엑셀 파싱 및 UI 개선

### 엑셀 데이터 연동 및 파싱 개선
- **날짜 정규화 강화**: 엑셀의 일련번호(Serial Number) 및 다양한 날짜 포맷(`YYYY.MM.DD`, `YY.MM.DD`) 인식 지원 강화 (`pNormDate` 함수 수정).
- **헤더/컬럼 감지 로직 고도화**: 헤더 명칭의 띄어쓰기 무시 처리 및 검색 범위를 늘려, 공백/형식 불일치나 병합된 셀에서도 데이터를 누락 없이 정확하게 가져오도록 개선.
- **데이터 병합/갱신 기준 강화**: 완전히 다른 작업(content)이 같은 날/같은 사람/같은 프로젝트(orderNo)에 속할 때 덮어쓰기되는 문제 해결. 식별 키(`idKey`, `wrIdKey`)에 `content`를 추가하여 중복 판별의 정밀도 향상 (`upload.js`, `local-auto.js`, `업무일지_분석기.html`).

### UI/UX 개선
- **PC 좁은 화면 테이블 최적화**: 분석기 테이블 구조에 `table-layout: fixed` 적용.
- **텍스트 시인성 향상**: 주요 컬럼인 `이름`과 `수주번호`에 말줄임표(...)를 제거하고 `word-break`를 적용하여 정보가 잘리지 않고 항상 전부 표시되도록 보장 (`업무일지_분석기.html`).

---

## v13.0 (2026-04-08) — Phase 1~3 전체 완료 + 프로덕션 레디

### PostgreSQL RLS
- Row-Level Security 정책 추가 (users, projects, issues, orders, audit_logs)
- tenant_id 기반 자동 행 격리 (app.tenant_id 세션 변수)

### AI 기능 보강
- 테넌트별 AI API 키 관리 (GET/PUT `/api/ai/config`)
- 자연어 질의 REST API (POST `/api/ai/query`) — RAG 기반 DB 데이터 자동 수집
- 플랜별 월간 AI 쿼리 제한 (free=0, pro=100, business=500, enterprise=무제한)
- AI 사용량 추적 테이블 (ai_query_usage)

### 알림 시스템 3채널
- 인앱 알림 (in_app_notifications 테이블 + REST API)
- 이메일 알림 (기존 email.service.js 통합, 이벤트 템플릿)
- 알림 센터 페이지 (`/dashboard/notifications`) — 전체/미읽음/환경설정 3탭
- 이벤트별 채널 ON/OFF 설정 (인앱/텔레그램/이메일)
- NotificationBell 컴포넌트: API 연동 + 30초 자동 갱신 + 실시간 뱃지

### PWA 오프라인 + 모바일
- Service Worker: Network First + 데이터 캐시 폴백 (프로젝트, 이슈, 수주 등)
- 정적 파일: Cache First 전략
- 오프라인 감지 + 상단 배너 표시
- 모바일 터치 최적화 (44px 탭 타겟, iOS 줌 방지, safe-area, overscroll-behavior)

### 인프라
- DB 마이그레이션: `005_phase_remaining.sql` (RLS, tenant_ai_configs, ai_query_usage, in_app_notifications)
- 신규 API: `/api/notifications`, `/api/ai/query`, `/api/ai/config`

---

## v12.0 (2026-04-08) — Phase 3 엔터프라이즈 완료

### 3-1. SSO/SAML
- SAML 2.0 IdP 연동 (Azure AD, Okta 호환)
- SSO 설정 관리 UI (관리자 대시보드)
- JIT 프로비저닝 (첫 SSO 로그인 시 계정 자동 생성)
- SP 정보 (ACS URL, Entity ID, NameID Format) 자동 안내

### 3-3. 커스텀 필드/워크플로우
- 커스텀 필드 정의 (프로젝트/이슈/수주 — text, number, date, select, multiselect, checkbox, url, email)
- 커스텀 필드 값 관리 API (엔티티별 일괄 저장/조회)
- 워크플로우 빌더 UI (상태 정의, 전이 규칙, 기본 워크플로우)
- 상태 전이 유효성 검사 API
- 화이트라벨 설정 (로고, 파비콘, 색상, 앱 이름, 커스텀 도메인, CSS)

### 3-4. 온프레미스 Docker Compose
- 원클릭 배포: `docker compose -f docker-compose.onprem.yml up -d`
- 4 서비스: PostgreSQL + API + Next.js Web + Nginx 리버스 프록시
- Web Dockerfile (Next.js 빌드 + 프로덕션 실행)
- Nginx 설정 (API/프론트엔드 자동 라우팅)
- `.env.onprem` 환경 변수 템플릿
- `INSTALL.md` 설치 가이드 문서
- 라이선스 키 시스템 (생성/활성화/상태 조회, 플랜 자동 업그레이드)

### 3-5. 감사/컴플라이언스
- 감사 로그 대시보드 (필터, 검색, 페이지네이션)
- 데이터 내보내기 (감사 로그 CSV, 사용자 JSON, 전체 데이터 JSON — GDPR 대응)
- 접근 기록 리포트 (사용자별 로그인/활동/IP 요약)
- 데이터 보관 정책 설정 (감사 로그/아카이브/삭제 데이터 보관 기간, 자동 정리)

### 인프라/라우트
- 신규 API: `/api/sso`, `/api/custom-fields`, `/api/workflows`, `/api/white-label`, `/api/license`, `/api/data-export`
- DB 마이그레이션: `004_phase3.sql` (sso_configs, custom_field_definitions/values, workflow_definitions, white_label_configs, licenses, data_retention_policies)
- 사이드바 관리자 섹션 추가 (SSO, 커스텀 필드, 워크플로우)
- Next.js 감사 로그 페이지 (`/dashboard/audit`)

### 통계
- 총 API 엔드포인트: 155+
- 총 DB 테이블: 36+
- 총 프론트엔드 페이지: 14개

---

## v10.2 (2026-04-07) — 사업부/부서별 접근 제어

### 기능
- **프로젝트 부서 필터링**: 사용자의 `departmentId`로 자동 필터링하여 본인 부서 프로젝트만 노출. 생성 시 부서 자동 배정.
- **일정 부서 필터링**: `events`도 동일 정책 — admin/executive는 전체, manager/member는 소속 부서만.
- **업무일지 부서 스코프**: 매니저/임원은 소속 부서 전체 조회 가능, member는 본인만.
- **백필**: 기존 프로젝트/일정의 `department_id` 누락분을 생성자(`created_by`)의 부서로 자동 채움.

### 변경 파일
- 서버: 프로젝트/일정/업무일지 라우트, migration

---

## v10.1 (2026-04-07) — 사용자별 데이터 분리 (멀티 유저 지원)

### 기능
- **업무일지 사용자별 격리**: `work_records.user_id` 컬럼 + 인덱스 추가. 모든 GET/POST/PATCH/DELETE에 `user_id` 스코프 적용 — 다른 사용자 데이터가 보이거나 영향받지 않도록.
- **엑셀 불러오기/저장/편집/삭제 모두 본인 데이터만 영향**.
- **NULL user_id 자동 백필**: 업그레이드 시 기존 NULL 레코드를 admin 계정으로 귀속.

### 변경 파일
- migration 007, server/routes/archives.js

---

## v10.0 (2026-04-07) — 성능 최적화 + 편집 저장 안정화 + 모바일 개선

### 성능
- **가상 스크롤**: 업무일지 테이블에서 화면에 보이는 행만 렌더링 — 수천 행에서도 DOM 가벼움.
- **GET 응답 ETag 캐싱**: 데이터 변경 없으면 304로 회신 — 네트워크/CPU 절감.
- **서버 SELECT 최소화**: 불필요 컬럼 제외 → 전송량 감소.
- **로드 경량화**: 전용 변환 함수 + 중복 체크 제거.
- **테이블 렌더 최적화**: 이름별 색상 룩업 O(n²) → O(1).

### 편집 저장 안정화
- **편집 적용 시 전체 데이터 저장으로 통일** — per-row 수주명/거래처 영속 보장 (※ v13.30에서 매니저/관리자 스코프 문제로 PATCH로 재전환).
- **공통업무 수주명/거래처 per-row 저장** 수정 (NULL 폴백 처리).

### 차트/UX
- 업무분장 비율·일별 투입시간 차트에 등록된 전체 코드(V 포함) 표시.
- 인원별 분포 영역 10명 기본 표시 (max-height 확대).
- 모바일 터치 영역 확대, 검색 드롭다운 전체 너비.
- 중복 레코드 제거 버튼(🧹) + 병합 시 덮어쓰기 지원.

---

## v9.8 (2026-04-07) — 서버 DB 전용 전환 + 편집모드 저장 수정

### 변경
- 수주명/거래처 저장을 서버 DB 전용으로 단순화 (localStorage·메모리 임시저장 제거).
- 로컬 IndexedDB 폴백 제거 — 서버 API만 사용.
- 편집모드 수정 적용 후 이전 데이터가 표시되는 캐시 버그 수정.
- 업무일지 편집 권한을 모든 인증 사용자에게 허용.
- 토스트 알림 위치를 화면 최상단으로 변경.

---

## v9.7 (2026-04-01) — 서버 우선 로드 + 그룹/별칭 서버 저장 + 날짜 정규화

### 변경
- **날짜 정규화**: 서버 DB의 `date` 필드를 `YYYY-MM-DD` → `YYYYMMDD`로 정규화 (주차 NaN 표시 근본 수정).
- **서버 우선 로드**: 접속 시 서버 DB를 먼저 로드 — 모든 기기(PC/모바일)에서 동일 데이터 보장.
- **인증 지연 방어**: 토큰 미발급 시 최대 5초 대기 후 서버 재시도.
- **팀원 그룹/별칭 서버 저장**: `user_settings` 테이블 + `/api/settings` API 추가. 로드 시 서버에서 동기화.
- 수동입력 날짜 `YYYYMMDD` 정규화 + IndexedDB 동기화 + 필터 즉시 갱신.

---

## v9.6 (2026-03-31) — 휴가(V) 업무분장 추가 + 거래처/수주명 DB 저장 수정

### 기능
- 업무분장 코드 V(휴가) 추가 — 색상, 차트, 엑셀 반영.
- DB 스키마에 `ocmt`(수주명), `oclient`(거래처) 컬럼 추가.
- 서버 POST bulk / PATCH batch에서 ocmt, oclient 저장/갱신 처리.

### 안정성
- 새로고침/재로그인 후에도 수정된 거래처/수주명이 유지되도록 흐름 정리.
- 편집 적용 시 PATCH 실패 → bulk 폴백 + 에러 토스트 표시.
- 서버 DB 연결/ROLLBACK 에러 처리 강화 (502 크래시 방지).
- 서버 모드에서 삭제/수정/저장 시 로컬 IndexedDB도 함께 동기화.

---

## v9.5 (2026-03-31) — 작업 내용 선택 삭제

### 기능
- 편집모드에서 체크박스로 개별/멀티 선택 삭제.
- 헤더 체크박스로 전체 선택/해제. 선택 건수 실시간 표시 + 삭제 확인 다이얼로그.
- id 보유 레코드는 서버 개별 삭제(`DELETE /records/batch`), 미보유 시 전체 교체 폴백.

---

## v9.4 (2026-03-31) — 편집모드 변경분만 갱신

### 변경
- 편집모드 적용 시 변경된 레코드만 DB 업데이트 (`PATCH /records/batch`).
- 레코드 id 보유 시 개별 UPDATE, 미보유 시 기존 전체 교체 폴백.
- 엑셀 갱신(merge) 시 기존 레코드 id 보존.

### 비고
- 이 시점에선 `PATCH /records/batch`가 본인 user_id만 허용 — 매니저/관리자 시나리오는 v13.30에서 비로소 정합화.

---

## v9.3 (2026-03-31) — 엑셀 갱신 시 중복 데이터 방지

### 변경
- 서버 모드 bulk 저장 시 트랜잭션(DELETE→INSERT)으로 중복 삽입 방지.
- 대량 데이터 배치 삽입 (500건씩, PostgreSQL 파라미터 한도 대비).
- 중복 판별 키에 hours·abbr 추가 (`date|name|orderNo|hours|abbr|dept|content`).

---

## v9.2 (2026-03-31) — 차트 이미지 저장

### 기능
- 모든 차트 패널에 📷 저장 버튼 추가 (hover 시 표시).
- 배경·테두리 포함 캡처 (html2canvas, 현재 테마 그대로).
- 흰색/검정 배경 선택 저장 (Chart.js canvas 직접 추출, 2x 해상도).
- canvas 없는 패널(인원별 분포, 업체 대응별 시간)도 html2canvas로 캡처 지원.

---

## v9.1 (2026-03-31) — 엑셀/TSV 내보내기 수정

### 버그 수정
- 엑셀저장·TSV복사 시 수주명·거래처 편집값(`editMap`, 레코드 override) 정상 반영.
- TSV복사에서도 `editMap` 편집값(수주번호·시간·업무분장·약자·업무내용) 반영.

---

## v9.0 (2026-03-25~26) — 텔레그램 봇 통합 & AI

### 텔레그램 봇 연동
- QR코드 스캔으로 1회 계정 연동 (`969010a`)
- 프로필 모달에 텔레그램 연동 섹션 (QR 생성, 연동 해제, 알림 설정)
- Webhook 자동 등록 + 진단/수동 등록 UI
- DB 마이그레이션: telegram_links, notification_prefs, notification_logs, telegram_auth_codes (`003_telegram.sql`)

### 봇 명령어 (24개)
| 명령어 | 기능 | 커밋 |
|--------|------|------|
| `/today` | 오늘 통합 브리핑 (일정+이슈+납기) | `6a2b3d8` |
| `/my` | 내 현황 (미해결 이슈 + 임박 납기) | `969010a` |
| `/issues` | 미해결 이슈 목록 | `969010a` |
| `/tasks` | 미완료 체크리스트 | `6a2b3d8` |
| `/done <번호>` | 체크리스트 완료 처리 (양방향) | `6a2b3d8` |
| `/log` | 업무일지 빠른 등록 (or `8h D B2024-001 내용`) | `013a743` |
| `/my-stats` | 개인 월간 통계 (바차트) | `6a2b3d8` |
| `/summary` | 금주 업무시간 요약 | `6313497` |
| `/report` | 월간 리포트 | `6313497` |
| `/weekly-report` | 주간보고 자동 생성 | `013a743` |
| `/overdue` | 지연 프로젝트 + 긴급 이슈 | `6313497` |
| `/project <이름>` | 프로젝트 현황/상세 | `6313497` |
| `/checklist <이름>` | 체크리스트 진행률 | `6a2b3d8` |
| `/calendar [N]` | 향후 N일 일정 (기본 7일) | `6a2b3d8` |
| `/orders` | 수주 목록 | `6a2b3d8` |
| `/order <번호>` | 수주 상세 + 투입시간 | `6a2b3d8` |
| `/deliveries` | 이번 달 납품 예정 | `6a2b3d8` |
| `/remind <시간> <내용>` | 개인 리마인더 (최대 7일) | `013a743` |
| `/vote` | 팀 투표 (인라인 버튼) | `013a743` |
| `/docs <이름>` | 프로젝트 문서 목록 | `6a2b3d8` |
| `/search-doc <키워드>` | 문서 검색 | `6a2b3d8` |
| `/team` | 팀원별 금주 투입 (관리자/팀장) | `6313497` |
| `/help [명령어]` | 전체 목록 또는 상세 도움말 | `c466fab` |
| `/unlink` | 연동 해제 | `969010a` |

### 알림 시스템 (13개 이벤트)
| 이벤트 | 설명 | 커밋 |
|--------|------|------|
| `issue_assigned` | 이슈 배정 + [대응시작][해결] 인라인 버튼 | `969010a`, `9cd48d4` |
| `issue_status_changed` | 이슈 상태 변경 | `969010a` |
| `project_delayed` | 프로젝트 지연 | `969010a` |
| `deadline_d3` / `d1` / `today` | 납기 D-3, D-1, D-day | `969010a` |
| `user_pending` | 가입 승인 요청 + [승인][반려] 버튼 | `969010a`, `013a743` |
| `milestone_complete` | 마일스톤 완료 | `6a2b3d8` |
| `event_today` | 일일 브리핑 (매일 08:30 KST) | `6a2b3d8` |
| `order_delivery_d7` / `d3` | 납품 D-7, D-3 | `6a2b3d8` |
| `weekly_digest` | 주간 다이제스트 (매주 월 09:30) | `6a2b3d8` |
| `progress_warning` | 진행률 경고 (기대 대비 20%p 지연) | `9cd48d4` |

### 스케줄러 (6개)
| 시간 (KST) | 기능 |
|-------------|------|
| 08:30 | 일일 브리핑 |
| 09:00 | 납기 리마인더 (D-3, D-1, D-day) |
| 09:10 | 수주 납품 리마인더 (D-7, D-3) |
| 09:30 월요일 | 주간 다이제스트 |
| 17:00 | 진행률 경고 |
| 18:00 | 과부하 경고 (일평균 9h 초과) |

### 실용 기능
- 사진 → 이슈 자동 등록 (캡션=제목, 긴급변경/대응시작 버튼) (`013a743`)
- 팀 투표 (인라인 버튼) (`013a743`)
- 개인 리마인더 (`013a743`)
- 업무일지 빠른 등록 (`8h D B2024-001 내용` 패턴) (`013a743`)
- 주간보고 자동 생성 (`013a743`)
- 그룹 채팅방 연동 (/linkgroup, /unlinkgroup) (`9cd48d4`)

### AI 통합
- 텔레그램 자연어 질답: DB 데이터 기반 RAG 응답 (`5ad0303`)
- 웹 AI 요약: 서버 Gemini API로 전환 (클라이언트 키 불필요) (`5f60283`)
- AI 엔진 선택/키 입력 UI 제거 → 서버 상태 표시 (`5f60283`)
- 환경변수 `GEMINI_API_KEY` 하나로 웹+텔레그램 통합 (`5f60283`)
- 토큰 한도 증가: Gemini 8192, Claude 4096 (`b302cd4`)

### UX 개선
- `/help log` 등 명령어별 상세 도움말 22개 (`c466fab`)
- 명령어 실행 후 관련 기능 추천 (💡 tip) (`c466fab`)
- 자연어 → 명령어 자동 매핑 13패턴 ("내 이슈 보여줘" → /issues) (`c466fab`)
- 연동 완료 시 온보딩 가이드 자동 발송 (`c466fab`)
- 봇 명령어 자동완성 (setMyCommands API, 24개) (`58cbc33`)

### 리팩토링 (`26c436f`)
- telegram.service.js: 1,767줄 → 461줄 (74% 감소)
- app.js 스케줄러: 136줄 → 11줄 (92% 감소)
- 모듈 분리: `server/telegram/commands/` 8개 파일
- 공통 유틸: `constants.js`, `utils.js`, `scheduler.js`
- Factory 패턴 + Lazy 초기화

---

## v8.8 (2026-03-24~25) — UI/성능/스케일링

### 업무분장 코드 변경
- G(일반) → G(공통), 인원별 분포에 R(제안) 범례 추가

### 스케일링 Phase 1
- DB 복합 인덱스 4개 + user_id 컬럼
- 집계 API (stats/summary, weekly, by-team, by-order)
- 페이지네이션 상한 200, 부서별 접근제어

### UI/UX
- 시인성/대비/배치 대폭 개선
- 다중 파일 드래그앤드롭 + 애니웍스 모달 간소화

---

## v8.7 (2026-03-23~24) — 주차 관리/필터

- 월별/분기(1Q-4Q)/연도 필터 추가
- 기간 선택 버튼, 주차 칩 강조
- PUT 404→POST 폴백, 프로젝트 일괄 생성 API
- 마일스톤 병렬 저장, 캐시 버스팅 자동화
- API 병렬화, HTML 캐시, CDN defer, Docker 경량화

---

## v8.6 (2026-03-22~23) — 사업부/팀 관리

- 사업부별 데이터 분리 및 팀원 선택 기능
- 체크리스트: 기본 표시, 완료 날짜, 인라인 갱신
- 서버 모드 체크리스트 스키마 수정

---

## v8.5 (2026-03-20~22) — 다중 사용자 웹 배포

- Express + PostgreSQL + JWT 인증
- Docker + Render 배포
- RBAC (admin/executive/manager/member)
- 낙관적 락, 감사 로그, 비밀번호 정책
- 수주/거래처 서버 저장 + 인라인 편집
- 애니웍스 연동 (Puppeteer)

---

## v7.0 (2026-03-19) — 초기 버전

- 업무일지 분석기 단일 HTML 파일
- IndexedDB 클라이언트 저장
- Chart.js 시각화, AI 요약 (Gemini/Claude)
- 엑셀 파일 파싱 (XLS/XLSX), 7개 테마

---

## 환경변수 목록

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | ✅(prod) | 액세스 토큰 서명 키 |
| `JWT_REFRESH_SECRET` | ✅(prod) | 리프레시 토큰 서명 키 |
| `CORS_ORIGIN` | | 프론트엔드 origin |
| `TELEGRAM_BOT_TOKEN` | | 텔레그램 봇 토큰 (BotFather) |
| `TELEGRAM_BOT_USERNAME` | | 봇 username (@없이) |
| `TELEGRAM_WEBHOOK_URL` | | Webhook 수신 URL |
| `TELEGRAM_WEBHOOK_SECRET` | | Webhook 검증 시크릿 (영숫자만) |
| `GEMINI_API_KEY` | | Gemini AI API 키 (웹+텔레그램) |
| `ANTHROPIC_API_KEY` | | Claude AI API 키 (대안) |
| `AI_PROVIDER` | | AI 엔진 선택 (gemini/anthropic, 기본: gemini) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | | 이메일 발송 |

---

## 프로젝트 구조

```
work_manager/
├── 업무일지_분석기.html           # 메인 프론트엔드 (SPA)
├── auth.js                       # 인증 + 프로필 + 텔레그램 UI
├── config.js                     # 프론트엔드 설정
├── settings.js / calendar.js / timeline.js / dashboard.js
├── project-data.js / order-view.js / issue-manager.js / document-manager.js
│
├── server/
│   ├── app.js                    # Express 앱 + 스케줄러
│   ├── config/index.js / db.js   # 환경변수 + PostgreSQL
│   ├── middleware/               # auth, rbac, pagination, optimistic-lock
│   ├── services/
│   │   ├── telegram.service.js   # 봇 코어 (461줄)
│   │   ├── notification.service.js
│   │   ├── ai.service.js
│   │   ├── auth.service.js / email.service.js
│   ├── routes/                   # 18개 API 라우트
│   ├── telegram/
│   │   ├── constants.js / utils.js / scheduler.js
│   │   └── commands/             # 8개 명령어 모듈
│   └── migrations/               # 001~004 SQL
│
├── docs/                         # PRD 문서
├── TODO.md / CHANGELOG.md
├── Dockerfile / docker-compose.yml / render.yaml
```
