# PRD: 텔레그램 연동

> **Version**: 1.0
> **Date**: 2026-03-25
> **Status**: Draft

---

## 1. 개요

Work Manager에 텔레그램 봇을 연동하여, 주요 이벤트 발생 시 실시간 알림을 전송하고 간단한 조회/응답을 텔레그램 채팅으로 수행할 수 있도록 한다.

### 1.1 배경

- 현재 알림 수단은 이메일(가입승인/비밀번호 초기화)뿐이며, 실시간 알림 채널이 없음
- 납기 지연, 이슈 발생 등 긴급 상황에 대한 즉시 인지가 어려움
- 팀원들이 텔레그램을 일상적으로 사용하고 있어 추가 앱 설치 불필요

### 1.2 목표

| 목표 | 측정 기준 |
|------|-----------|
| 이벤트 발생 → 알림 수신 지연 5초 이내 | 서버 로그 기준 전송 완료 시간 |
| 알림 수신율 95% 이상 | Telegram API 응답 성공률 |
| 사용자 80% 이상 텔레그램 연동 활성화 | 연동 완료 사용자 수 / 전체 활성 사용자 수 |

---

## 2. 사용자 스토리

### 2.1 연동 설정

| ID | 스토리 | 우선순위 |
|----|--------|----------|
| US-01 | 사용자로서, 프로필 설정에서 텔레그램 연동 버튼을 눌러 봇과 1:1 채팅을 시작하고 싶다 | P0 |
| US-02 | 사용자로서, `/start` 명령으로 인증 코드를 입력하여 내 계정과 텔레그램을 연결하고 싶다 | P0 |
| US-03 | 사용자로서, 알림 유형별로 수신 여부를 설정하고 싶다 (이슈, 납기, 프로젝트 등) | P1 |
| US-04 | 사용자로서, 텔레그램 연동을 해제하고 싶다 | P0 |
| US-05 | 관리자로서, 팀/그룹 채팅방에 봇을 추가하여 팀 단위 알림을 받고 싶다 | P2 |

### 2.2 알림 수신

| ID | 스토리 | 우선순위 |
|----|--------|----------|
| US-10 | 담당자로서, 나에게 이슈가 배정되면 텔레그램으로 알림을 받고 싶다 | P0 |
| US-11 | PL로서, 내 프로젝트 상태가 '지연'으로 변경되면 알림을 받고 싶다 | P0 |
| US-12 | 담당자로서, 마일스톤/납기 D-3, D-1, D-day에 리마인더를 받고 싶다 | P0 |
| US-13 | 관리자로서, 신규 사용자 가입 승인 요청이 들어오면 알림을 받고 싶다 | P1 |
| US-14 | 담당자로서, 내가 등록한 이슈의 상태가 변경되면 알림을 받고 싶다 | P1 |
| US-15 | PL로서, 프로젝트 진행률이 일정 기준 이하로 떨어지면 알림을 받고 싶다 | P2 |

### 2.3 봇 명령어 (조회)

| ID | 스토리 | 우선순위 |
|----|--------|----------|
| US-20 | 사용자로서, `/my` 명령으로 오늘 내 할 일 요약을 조회하고 싶다 | P1 |
| US-21 | 사용자로서, `/issues` 명령으로 내게 배정된 미해결 이슈 목록을 보고 싶다 | P1 |
| US-22 | 사용자로서, `/project <프로젝트명>` 으로 프로젝트 현황을 조회하고 싶다 | P2 |
| US-23 | PL로서, `/team` 명령으로 팀원별 금주 투입시간 요약을 보고 싶다 | P2 |

---

## 3. 시스템 설계

### 3.1 아키텍처

```
┌─────────────┐     Webhook (HTTPS POST)     ┌──────────────────┐
│  Telegram    │ ──────────────────────────→  │  Express Server  │
│  Bot API     │ ←──────────────────────────  │  /api/telegram/* │
└─────────────┘     sendMessage API           └────────┬─────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │  Notification    │
                                              │  Service         │
                                              │  (telegram.      │
                                              │   service.js)    │
                                              └────────┬─────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │  PostgreSQL      │
                                              │  - telegram_links│
                                              │  - noti_prefs    │
                                              │  - noti_logs     │
                                              └──────────────────┘
```

### 3.2 DB 스키마 변경

```sql
-- 사용자-텔레그램 연동
CREATE TABLE telegram_links (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id       BIGINT NOT NULL UNIQUE,
  username      VARCHAR(100),
  linked_at     TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id)
);

-- 알림 설정
CREATE TABLE notification_prefs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       VARCHAR(20) DEFAULT 'telegram',  -- telegram | email
  event_type    VARCHAR(50) NOT NULL,             -- issue_assigned, deadline_remind, ...
  is_enabled    BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, channel, event_type)
);

-- 알림 발송 로그
CREATE TABLE notification_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  chat_id       BIGINT,
  event_type    VARCHAR(50),
  payload       JSONB,
  status        VARCHAR(20) DEFAULT 'sent',       -- sent | failed | retry
  error_detail  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 인증 코드 (임시)
CREATE TABLE telegram_auth_codes (
  code          VARCHAR(8) PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  used          BOOLEAN DEFAULT FALSE
);
```

### 3.3 서버 구성요소

#### 3.3.1 신규 파일

| 파일 | 역할 |
|------|------|
| `server/services/telegram.service.js` | Telegram Bot API 래퍼 (sendMessage, setWebhook 등) |
| `server/services/notification.service.js` | 이벤트 → 알림 변환, 수신자 결정, 발송 오케스트레이션 |
| `server/routes/telegram.js` | Webhook 수신, 봇 명령어 처리, 연동 API |
| `server/migrations/XXX-telegram.js` | 위 테이블 생성 마이그레이션 |

#### 3.3.2 기존 파일 수정

| 파일 | 변경 내용 |
|------|-----------|
| `server/routes/issues.js` | 이슈 생성/상태변경 시 `notification.service.notify()` 호출 |
| `server/routes/projects.js` | 프로젝트 상태변경 시 알림 트리거 |
| `server/routes/users.js` | 가입 승인 요청 시 관리자 알림 |
| `server/config/index.js` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL` 환경변수 추가 |

### 3.4 알림 이벤트 정의

| event_type | 트리거 시점 | 수신 대상 | 메시지 예시 |
|------------|-------------|-----------|-------------|
| `issue_assigned` | 이슈 배정/변경 | 배정된 담당자 | 🔴 **[긴급] 이슈 배정**\nSK하이닉스 - 카메라 보정 오류\n담당: 홍길동 |
| `issue_status_changed` | 이슈 상태 변경 | 이슈 등록자 + 담당자 | 🔵 이슈 상태 변경: 접수 → 대응중\nSK하이닉스 - 카메라 보정 오류 |
| `project_delayed` | 프로젝트 → 지연 | PL + 관리자 | ⚠️ **프로젝트 지연**\n[B2024-001] SK하이닉스 2호기\n예정 납기: 2026-04-15 |
| `deadline_d3` | 납기 D-3 | PL + 담당자 | ⏰ 납기 D-3 리마인더\n[B2024-001] SK하이닉스 2호기\n납기일: 2026-03-28 |
| `deadline_d1` | 납기 D-1 | PL + 담당자 | 🔔 **내일 납기!**\n[B2024-001] SK하이닉스 2호기 |
| `deadline_today` | 납기 D-day | PL + 담당자 | 🏁 **오늘 납기일**\n[B2024-001] SK하이닉스 2호기 |
| `user_pending` | 신규 가입 요청 | 관리자 전원 | 👤 신규 가입 승인 요청\n이름: 김철수\n부서: 제어 |
| `milestone_complete` | 마일스톤 완료 | PL | ✅ 마일스톤 완료\n[B2024-001] 설계 단계 완료 |

### 3.5 봇 명령어

| 명령어 | 동작 |
|--------|------|
| `/start <인증코드>` | 계정 연동 |
| `/unlink` | 연동 해제 |
| `/my` | 오늘 할 일 요약 (배정 이슈 + 임박 납기) |
| `/issues` | 미해결 이슈 목록 (최대 10건) |
| `/project <이름>` | 프로젝트 현황 요약 |
| `/team` | 팀원 금주 투입시간 (PL/관리자 전용) |
| `/help` | 명령어 안내 |

---

## 4. 연동 플로우

### 4.1 계정 연동

```
사용자(웹)                    서버                     텔레그램 봇
   │                          │                          │
   ├─ [프로필] 텔레그램 연동 ──→│                          │
   │                          ├─ 8자리 인증코드 생성       │
   │                          ├─ telegram_auth_codes 저장  │
   │  ← 인증코드 + 봇 링크 ───┤                          │
   │                          │                          │
   ├─ 봇 채팅방 열기 ─────────────────────────────────────→│
   │                          │  ← /start ABC12345 ──────┤
   │                          ├─ 코드 검증                 │
   │                          ├─ telegram_links 저장       │
   │                          ├─ "연동 완료!" 메시지 ──────→│
   │  ← 웹 UI 연동 상태 갱신 ─┤                          │
```

### 4.2 알림 발송

```
이벤트 발생 (이슈 생성 등)
   │
   ▼
notification.service.notify(eventType, payload)
   │
   ├─ 수신 대상 결정 (담당자, PL, 관리자 등)
   ├─ notification_prefs 조회 (수신 허용 여부)
   ├─ telegram_links 조회 (chat_id)
   │
   ├─ 메시지 템플릿 렌더링 (Markdown)
   ├─ telegram.service.sendMessage(chat_id, text)
   │
   ├─ 성공 → notification_logs (status: sent)
   └─ 실패 → notification_logs (status: failed) + 1회 재시도
```

---

## 5. 프론트엔드 변경

### 5.1 프로필 설정 영역

- **텔레그램 연동** 섹션 추가
  - 미연동: `[텔레그램 연동하기]` 버튼 → 인증코드 모달
  - 연동됨: `@username 연동됨` 표시 + `[연동 해제]` 버튼

### 5.2 알림 설정 패널

- 이벤트 유형별 토글 스위치
- 채널 선택 (텔레그램 / 이메일)

```
┌─ 알림 설정 ──────────────────────────────┐
│                          텔레그램  이메일  │
│ 이슈 배정                  [✓]     [ ]   │
│ 이슈 상태 변경              [✓]     [ ]   │
│ 프로젝트 지연              [✓]     [✓]   │
│ 납기 리마인더 (D-3,1,0)    [✓]     [ ]   │
│ 가입 승인 요청 (관리자)     [✓]     [✓]   │
│ 마일스톤 완료              [ ]      [ ]   │
└──────────────────────────────────────────┘
```

---

## 6. 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFather에서 발급받은 토큰 | `123456:ABC-DEF...` |
| `TELEGRAM_WEBHOOK_URL` | 서버의 webhook 수신 URL | `https://api.example.com/api/telegram/webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook 검증용 시크릿 | 랜덤 문자열 |

---

## 7. 보안 고려사항

| 항목 | 대책 |
|------|------|
| Webhook 위조 방지 | Telegram `secret_token` 헤더 검증 |
| 인증코드 탈취 | 5분 만료, 1회 사용, 8자리 영숫자 |
| chat_id 노출 | DB 암호화 불필요 (Telegram 내부 ID), API 응답에 미포함 |
| 봇 명령어 권한 | chat_id → user_id 매핑 후 기존 RBAC 적용 |
| 알림 스팸 방지 | 동일 이벤트 5분 내 중복 발송 차단 |
| 토큰 보안 | 환경변수로만 관리, 코드에 하드코딩 금지 |

---

## 8. 스케줄러 (납기 리마인더)

```javascript
// 매일 09:00 KST 실행 (node-cron)
// D-3, D-1, D-day 납기 프로젝트 조회 → 알림 발송
cron.schedule('0 0 * * *', async () => {  // UTC 00:00 = KST 09:00
  await notificationService.sendDeadlineReminders();
});
```

---

## 9. 구현 단계

### Phase 1 — 기본 연동 (P0)

- [ ] 텔레그램 봇 생성 (BotFather)
- [ ] DB 마이그레이션 (4개 테이블)
- [ ] `telegram.service.js` — Bot API 래퍼
- [ ] `notification.service.js` — 알림 오케스트레이션
- [ ] Webhook 라우트 + 봇 명령어 (`/start`, `/unlink`, `/help`)
- [ ] 계정 연동 플로우 (인증코드 발급 → 검증 → 연동)
- [ ] 프로필 UI에 텔레그램 연동 섹션 추가
- [ ] 이슈 배정/상태변경 알림
- [ ] 프로젝트 지연 알림
- [ ] 납기 리마인더 스케줄러 (D-3, D-1, D-day)

### Phase 2 — 확장 (P1)

- [ ] 알림 설정 UI (이벤트별 수신 토글)
- [ ] 가입 승인 요청 알림
- [ ] 이슈 상태 변경 알림
- [ ] `/my`, `/issues` 봇 명령어
- [ ] 알림 발송 로그 조회 (관리자)

### Phase 3 — 고급 (P2)

- [ ] 그룹 채팅방 알림 지원
- [ ] `/project`, `/team` 봇 명령어
- [ ] 프로젝트 진행률 저하 알림
- [ ] 마일스톤 완료 알림
- [ ] 인라인 버튼 (이슈 상태 변경 등)

---

## 10. 의존성

| 패키지 | 용도 | 비고 |
|--------|------|------|
| `node-telegram-bot-api` | Telegram Bot API 클라이언트 | Webhook 모드 사용 |
| `node-cron` | 납기 리마인더 스케줄러 | 매일 09:00 KST |

---

## 11. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Telegram API 장애 | 알림 미수신 | 실패 시 1회 재시도 + 로그 기록, 이메일 폴백 검토 |
| Webhook URL 변경 | 알림 중단 | 서버 시작 시 자동 `setWebhook` 호출 |
| 사용자 봇 차단 | 알림 실패 | 403 응답 시 `is_active = false` 처리 |
| 대량 알림 발송 | Rate limit (30 msg/sec) | 큐 기반 순차 발송, 그룹 알림은 그룹 채팅방 활용 |
