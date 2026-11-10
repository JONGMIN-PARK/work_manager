# 💾 백업 · 복원 (v13.431)

## 무엇이 어떻게 백업되나

| 대상 | 방법 | 주기 · 보관 |
|---|---|---|
| **DB 전체** (테이블 전부 · 구조 · 마인드맵/프로젝트 이미지 · DB에 든 파일 칸(bytea) · 메신저 · 노트북 · A/S …) | GitHub Actions `DB backup` (`.github/workflows/db-backup.yml`) 이 `pg_dump` → GCS `backups/db/` | 매일 03:30 KST · 30일 (가장 최근 7개는 항상 남김) |
| **GCS 원본 파일** (문서관리 · 메신저 · 노트북 · 사양서 파일) | GCS 버킷의 *삭제 보관(soft delete)* · *버전 보관* — 아래 '처음 한 번' 3번 | 버킷 설정대로 |
| Neon 자체 | Neon 의 시점 복원(Restore / Branch from time) | Neon 플랜의 보관 기간 |
| 화면의 '화면 데이터 · 환경설정 내려받기' | 브라우저가 JSON 으로 | 필요할 때 — 환경설정 되돌리기용 |

매번 백업 직후 **작업 안의 빈 PostgreSQL 에 실제로 복원**해 보고, 테이블별 행 수를 원본과 맞춰 본다.
테이블이 빠졌거나 행 수가 크게(5% 넘게 · 20줄 넘게) 모자라면 실패로 끝나고 GitHub 가 메일을 보낸다.
결과는 ⚙️ → 💾 백업 · 복원 창 맨 위 **🗄 DB 전체 백업** 에 보인다(기본 회사 관리자 또는 `BACKUP_ADMIN_EMAILS` 만).

## 처음 한 번

1. **GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret** 으로 4개 등록

   | 이름 | 값 |
   |---|---|
   | `BACKUP_DATABASE_URL` | Render 의 `DATABASE_URL` 값 그대로 (주소의 `-pooler` 는 작업이 직접 연결로 바꿔 씀) |
   | `GCS_SA_KEY` | Render 의 `GCS_SA_KEY` 값 그대로 (서비스계정 JSON 을 base64) |
   | `GCS_BUCKET` | Render 의 `GCS_BUCKET` (예: `work-manager-docs`) |
   | `GCS_PROJECT_ID` | Render 의 `GCS_PROJECT_ID` (예: `gcalcli-488210`) |

2. **Actions → DB backup → Run workflow** 로 한 번 실행
   - 먼저 `dry_run` 을 켜고 실행 → 작은 시험 DB 로 도구 · 복원 확인 · GCS 올리기(`backups/db-test/`)만 시험
   - 그다음 `dry_run` 끄고 실행 → 운영 DB 첫 백업. 끝나면 요약(Summary)에 크기 · 테이블 · 행 수가 나온다
3. **GCS 원본 파일 보호** (Google Cloud 콘솔 → Cloud Storage → 버킷 `work-manager-docs` → 보호)
   - *Soft delete* 보관 기간 30일 (지운 파일을 30일 동안 되살릴 수 있음)
   - 필요하면 *Object versioning* 켜기 (덮어쓴 파일의 이전 판 보관 — 저장 비용이 늘어남)
4. (선택) Render 환경변수 `BACKUP_ADMIN_EMAILS` = 백업을 볼 · 내려받을 사람 이메일(쉼표로 여러 명)

## 되돌리기 (복원) — 운영 DB 에 바로 덮어쓰지 않는다

> 백업 파일을 운영 DB 에 바로 넣으면 그 뒤에 쌓인 데이터가 사라진다. **늘 새 DB 에 먼저 복원 → 확인 → 결정.**

1. ⚙️ → 💾 백업 · 복원 → 🗄 DB 전체 백업 에서 원하는 날짜의 `.dump` 를 내려받는다
   (또는 GCS 콘솔 `backups/db/` 에서)
2. Neon 콘솔 → **Branches → New branch** (빈 브랜치 또는 아무 시점) → 그 브랜치의 연결 주소(직접 연결, `-pooler` 없는 것)를 복사
3. PostgreSQL 18 도구(`pg_restore`)가 있는 곳에서
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists \
     --dbname="postgres://…새 브랜치 주소…" wm-2026-11-11T0330.dump
   ```
   일부 테이블만 필요하면 `--table=mindmaps --table=mindmap_images` 처럼 고른다 (`pg_restore --list 파일` 로 목록 확인).
4. 새 브랜치에서 내용을 확인한 뒤
   - **일부만 되살리기:** 필요한 행만 운영 DB 로 옮긴다 (가장 안전)
   - **전체를 되돌리기:** Render 의 `DATABASE_URL` 을 새 브랜치 주소로 바꾸고 재배포 (그 사이 운영에 새로 쌓인 데이터는 빠지므로 사용자 공지 후)

Neon 의 시점 복원만으로 충분한 경우(몇 시간 ~ 며칠 전 실수)는 Neon 콘솔에서 그 시각으로 브랜치를 만들어 같은 4번으로 처리하면 된다.

## 주의

- 백업 파일에는 **모든 회사(테넌트)의 데이터와 비밀번호 해시**가 들어 있다. 내려받은 파일은 안전한 곳에만 두고, 내려받기는 감사 로그(`backup.download`)에 남는다.
- 백업 중에도 운영은 평소대로 쓸 수 있다(`pg_dump` 는 읽기만 함). 백업하는 몇 분 동안 테이블 구조를 바꾸는 배포는 끝날 때까지 기다린다.
- `server/scripts/backup-db.js` 는 옛 방식(테이블 16개 JSON)이라 개발용으로만 남겨 둠. 서버가 예전처럼 자동 실행하지 않는다.
