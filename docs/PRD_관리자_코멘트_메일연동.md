# PRD: 관리자 코멘트·피드백 + 이벤트 알림/활동 로그 (메일·텔레그램)

> **Version**: 1.1
> **Date**: 2026-06-10
> **Status**: Draft
> **연관**: 운영자 모드(Phase 1 v13.112), 마일스톤 작업노트/보고(v13.105~110). 분석/트렌드 뷰(별도 PRD)와 함께 운영자 워크플로 보완.
> **v1.1 변경**: 텔레그램 연동을 **핵심(P0)** 으로 승격. 코멘트뿐 아니라 **프로젝트 등록/수정·작업(마일스톤 진척/노트) 업데이트 등 주요 이벤트를 메일·텔레그램으로 알리고 활동 로그(audit_logs)로 남김**.

---

## 1. 개요

두 축으로 구성:
1. **관리자→담당자 코멘트/피드백**: 관리자/운영자/PL가 프로젝트·마일스톤에 코멘트를 남기면, 해당 업무 할당자에게 **메일+텔레그램**으로 전달되고 앱 내 코멘트 스레드로 남는다. (예: "마일스톤 지연 확인 바람", "이 부분 보완 필요")
2. **주요 이벤트 알림 + 활동 로그**: 프로젝트 등록/수정, 작업(마일스톤 진척/작업노트·투입) 업데이트, 코멘트 등 **핵심 변경을 메일·텔레그램으로 반영**하고 **모두 활동 로그(audit_logs)로 기록**한다.

### 1.1 배경

- 현재 관리자가 담당자에게 업무 피드백을 줄 **인앱 채널이 없음**(텔레그램 알림은 시스템 이벤트 위주, 자유 코멘트 불가).
- 마일스톤 진척/작업노트(`milestone_progress_logs`)는 **담당자→기록** 방향만 있고, **관리자→담당자 피드백** 역방향이 없음.
- 이메일 발송 인프라(`email.service.sendMail`, Gmail SMTP)와 사용자 이메일(`users.email`)이 이미 있어 **즉시 재사용 가능**.

### 1.2 목표

| 목표 | 측정 기준 |
|------|-----------|
| 관리자가 담당자에게 피드백을 1분 내 전달 | 코멘트 작성→메일·텔레그램 발송 완료 |
| 피드백/이벤트 누락 방지 | 담당자 메일·텔레그램 자동 수신율 95%+ |
| 맥락 보존 | 코멘트가 프로젝트/마일스톤에 귀속·이력화 |
| **추적성** | 프로젝트 등록/수정·작업 업데이트·코멘트가 **활동 로그 100% 기록** |
| 기존 인프라 재사용 | sendMail·notification.service(텔레그램)·auditLog 재사용, 신규 테이블 1개 |

### 1.3 비목표

- 이메일 **회신(인바운드)** 으로 양방향 스레드 → P2 이후(인바운드 메일 파싱 필요).
- 실시간 채팅 → 비대상.
- 외부 메신저(슬랙 등) → 비대상. **텔레그램은 핵심 연동(P0)**.

---

## 2. 사용자 & 권한

- **작성(코멘트/피드백)**: admin / 운영자 / 해당 프로젝트 PL. (rbac — 신규 권한 `project.comment` 또는 기존 edit 권한 재사용)
- **수신/조회**: 코멘트 대상 할당자 + 프로젝트 멤버 + 관리자.
- 메일 수신자 주소: `users.email` (담당자 이름→user 매핑). 이메일 없는 사용자는 인앱만.

---

## 3. 사용자 스토리

| ID | 스토리 | 우선순위 |
|----|--------|----------|
| US-01 | 관리자로서, 마일스톤에 코멘트를 남기면 그 마일스톤 담당자에게 메일이 가길 원한다 | P0 |
| US-02 | 관리자로서, 프로젝트 전체에 피드백을 남기고 프로젝트 멤버에게 알리고 싶다 | P0 |
| US-03 | 관리자로서, 코멘트 작성 시 수신자(담당자)를 확인·수정하고 싶다 | P0 |
| US-04 | 담당자로서, 받은 피드백을 메일과 앱에서 모두 확인하고 싶다 | P0 |
| US-05 | 담당자로서, 피드백에 인앱으로 답글(확인/회신)을 남기고 싶다 | P1 |
| US-06 | 관리자로서, 마일스톤/프로젝트별 코멘트 이력을 시간순으로 보고 싶다 | P1 |
| US-07 | 관리자로서, 코멘트/피드백을 **메일과 텔레그램으로 동시에** 보내고 싶다 | P0 |
| US-08 | 담당자로서, 내가 맡은 마일스톤에 **작업/진척 업데이트가 생기면** 텔레그램·메일로 알고 싶다 | P0 |
| US-09 | 관리자로서, **프로젝트가 등록/수정되면** 이해관계자가 텔레그램·메일로 알림받길 원한다 | P0 |
| US-10 | 관리자로서, 위 모든 변경(등록/수정/작업/코멘트)이 **활동 로그에 남아** 추후 추적 가능하길 원한다 | P0 |
| US-11 | 사용자로서, 알림(메일·텔레그램) 수신 여부를 유형별로 설정하고 싶다 | P1 |

---

## 4. 기능 요구사항

### 4.1 코멘트 대상(귀속) (FR-1)

코멘트는 **마일스톤 또는 프로젝트**에 귀속:
- **마일스톤 코멘트**: 대상 마일스톤 + 기본 수신자 = 그 마일스톤 담당자(`assignee_targets` 키 → user 매핑).
- **프로젝트 코멘트**: 대상 프로젝트 + 기본 수신자 = 프로젝트 멤버/담당자.
- (확장) 이슈/업무일지 단위 — P2.

### 4.2 작성 흐름 (FR-2)

1. 진입점:
   - 마일스톤 진척 업데이트 모달(🖉) 또는 마일스톤 행에 **💬 피드백** 버튼.
   - 프로젝트 상세/운영자 분석 뷰에 **💬 코멘트** 버튼.
2. 작성 모달(표준 가드 `wmGuardedModal` 필수): 본문(텍스트) + **수신자(자동 추천, 체크로 가감)** + 옵션(메일 보내기 on/off, 텔레그램 동시 P2).
3. 저장 → 인앱 코멘트 스레드에 기록 + 선택된 수신자에게 **메일 발송**.

### 4.3 메일 연동 (FR-3)

- `email.service.sendMail(to, subject, html)` 재사용.
- 제목: `[업무 관리자] {프로젝트명} · {마일스톤명} 피드백`.
- 본문(HTML): 작성자·대상(프로젝트/마일스톤)·코멘트 내용 + **앱에서 보기 링크**(deep link).
- 다수 수신자: 개별 발송(또는 BCC). 실패해도 인앱 저장은 유지(best-effort).
- 비동기 발송(응답 지연 방지), 발송 결과 로깅.

### 4.4 인앱 코멘트 스레드 (FR-4)

- 대상(프로젝트/마일스톤)별 코멘트 목록: 작성자·시간·본문·수신자·읽음 상태.
- 답글(P1): 담당자가 인앱에서 회신 → 작성자(관리자)에게 알림.
- 읽음 표시(P1): 수신자가 열람 시 read.

### 4.5 알림 통합 (FR-5)

- **메일 + 텔레그램 동시 발송(둘 다 P0)**. `notification.service.notify`/`notifyProjectStakeholders` + `email.service.sendMail` 함께 호출.
- 수신자 알림 수신 설정 존중(`user_settings`, P1).

### 4.6 이벤트 알림 & 활동 로그 (FR-6)

아래 **주요 이벤트**를 발생 시점에 (a) 이해관계자에게 **메일·텔레그램 알림** + (b) **활동 로그(`audit_logs`) 기록**:

| 이벤트 | 트리거(서버) | 알림 대상 | 로그 action |
|--------|--------------|-----------|-------------|
| 프로젝트 등록 | POST /api/projects | 멤버/관리자 | `project.create` |
| 프로젝트 수정 | PUT /api/projects/:id | 멤버 | `project.update` |
| 마일스톤 진척/작업노트 업데이트 | POST /api/milestones/:id/logs | 마일스톤 담당자·PL | `milestone.progress` |
| 마일스톤 생성/수정/삭제 | milestones POST/PUT/DELETE | 멤버 | `milestone.*` |
| 코멘트/피드백 | POST /api/comments | 수신자 | `comment.create` |
| (기존) 이슈 배정·지연·완료 등 | 기존 notify | 기존 | (유지) |

- **알림 채널**: 기본 텔레그램(연결된 사용자) + 메일(이메일 보유). 중복/과알림 방지(중요 이벤트만, 묶음/디바운스 고려).
- **로그 내용**: 작성자·대상·변경 요약(diff 핵심)·시각. `auth.service.auditLog(userId, action, targetType, targetId, detail, req)` 재사용.
- **조회**: 기존 `/api/audit`(관리자) + 운영자 분석 뷰/프로젝트 상세에 "활동 로그" 표시(P1).
- **신뢰성**: 알림/로그는 best-effort(실패해도 주 트랜잭션 유지), 비동기.

---

## 5. 데이터 모델 (신규 테이블 1개)

`comments`(또는 `project_comments`) — 마이그레이션 신규:

```sql
CREATE TABLE IF NOT EXISTS comments (
  id            VARCHAR(60) PRIMARY KEY,
  target_type   VARCHAR(20) NOT NULL,        -- 'project' | 'milestone'
  target_id     VARCHAR(100) NOT NULL,       -- project_id 또는 milestone_id
  project_id    VARCHAR(100),                -- 조회 편의(마일스톤도 소속 프로젝트)
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  author_id     UUID REFERENCES users(id),
  author_name   TEXT,
  body          TEXT NOT NULL,
  recipients    JSONB DEFAULT '[]',          -- [{userId,name,email,emailed:bool}]
  parent_id     VARCHAR(60),                 -- 답글(스레드) — P1
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_target ON comments(target_type, target_id, created_at DESC);
CREATE INDEX idx_comments_project ON comments(project_id);
```

(읽음 상태는 P1에서 `comment_reads(comment_id,user_id,read_at)` 또는 recipients JSON에 read 플래그.)

---

## 6. 서버 설계

- `POST /api/comments` — { targetType, targetId, body, recipientIds?[] }. 권한 체크(작성). 수신자 자동 결정(미지정 시 담당자/멤버) → 인앱 저장 + 비동기 메일 발송.
- `GET /api/comments?targetType&targetId` — 대상 코멘트 목록(가시성: 해당 프로젝트 접근권).
- `DELETE /api/comments/:id` — 작성자/admin.
- 수신자 해석: 마일스톤 `assignee_targets` 이름 → `users.name`/`display_name` 매핑 → email. 프로젝트는 `project_members`/`assignees`.
- 가시성: 코멘트 조회는 프로젝트 접근권(`canAccessProject`/operator) 기준.

---

## 7. UI/UX

- 마일스톤 행/모달의 **💬 피드백**, 프로젝트 상세·운영자 분석의 **💬 코멘트**.
- 코멘트 모달: 본문 textarea + 수신자 칩(자동 추천·토글) + "메일 발송" 체크 + 저장.
- 코멘트 스레드: 작성자·상대시간·본문·수신자·(P1 읽음/답글). `_pdRelTime`·eH 재사용.
- 메일 미설정(SMTP 없음) 시: 인앱 저장만 + "메일 미발송(SMTP 미설정)" 안내.
- 모든 모달은 **표준 가드 `wmGuardedModal`**.

---

## 8. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| 권한 | 작성은 admin/운영자/PL, 조회는 프로젝트 접근권. 서버 검증 필수 |
| 신뢰성 | 메일 실패해도 인앱 저장 유지(best-effort), 발송 결과 로깅 |
| 보안 | 메일 헤더 인젝션 방지(sanitizeHeader 기존), 본문 sanitize |
| 성능 | 메일 비동기 발송으로 응답 지연 방지 |
| 프라이버시 | 수신자 이메일 노출 최소(개별 발송/BCC) |

---

## 9. 단계별 구현

| 단계 | 범위 |
|------|------|
| **1 (P0)** | comments 테이블 + POST/GET, 마일스톤/프로젝트 코멘트 모달, 담당자 자동 수신, **메일+텔레그램 발송**, 인앱 스레드. **이벤트(프로젝트 등록/수정·마일스톤 진척) 알림 + 활동 로그(audit_logs)** |
| **2 (P1)** | 답글(스레드)·읽음 표시·코멘트/활동 로그 이력 뷰·삭제, 알림 수신 설정(유형별) |
| **3 (P2)** | 이슈/업무일지 단위 코멘트, 알림 묶음/요약, (검토)이메일 회신 인바운드 |

---

## 10. 미해결/결정 필요 사항

1. **작성 권한 범위**: admin/운영자만 vs PL/매니저까지.
2. **기본 수신자**: 마일스톤 담당자만 vs 프로젝트 멤버 전체 — 대상별 기본값.
3. **저장 vs 메일전용**: 인앱 스레드 저장(권장) 확정 여부.
4. **답글/양방향 시점**: P1 인앱 답글 우선, 이메일 회신은 후순위 확정.
5. **권한 모델**: 신규 `project.comment` 권한 vs 기존 edit 재사용.
6. **deep link**: 앱 내 해당 마일스톤/프로젝트로 바로 여는 URL 스킴 정의.

---

## 부록. 재사용 자산

| 기능 | 재사용 |
|------|--------|
| 메일 발송 | `server/services/email.service.js` `sendMail`(헤더 sanitize 포함) |
| 텔레그램 알림 | `server/services/notification.service.js` `notify`/`notifyProjectStakeholders`/`notifyAdmins` |
| 활동 로그 | `server/services/auth.service.js` `auditLog(userId, action, targetType, targetId, detail, req)` → `audit_logs`, 조회 `/api/audit`(audit.js), 내보내기 data-export.js |
| 수신자 매핑 | `users`(email/name), `project_members`, `assignee_targets` |
| 권한/접근 | `rbac`, `canAccessProject`, `isOperator` |
| 모달 가드 | `wmGuardedModal`/`wmWaitForEl` |
| 시간/이스케이프 | `_pdRelTime`, `eH` |
