# 배포 가이드 — 업무 관리자

## 추천 구성 (전부 무료)

```
[Render.com]     ←  Express 서버 (정적파일 + API 한번에)
      ↓
[Supabase]       ←  PostgreSQL DB (무료 500MB)
      ↓
[Google OAuth2]  ←  구글 계정 로그인
```

---

## STEP 1. Supabase — DB 생성

1. https://supabase.com 접속 → **Start your project** (GitHub 계정으로 가입)
2. **New Project** 클릭
   - 이름: `work-manager`
   - DB 비밀번호: 안전한 비밀번호 설정 (메모해 두세요)
   - Region: `Northeast Asia (Seoul)` 선택
3. 프로젝트 생성 후 → 왼쪽 **SQL Editor** 클릭
4. 아래 SQL 파일을 순서대로 붙여넣고 **Run** 실행:
   - `migrations/001_auth.sql`
   - `migrations/002_data.sql`
   - `migrations/003_google_oauth.sql`
5. **Settings → Database → Connection string** 에서 `URI` 복사
   - 형식: `postgresql://postgres.[ref]:[비밀번호]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
   - 이것이 `DATABASE_URL`

---

## STEP 2. Google OAuth2 — 구글 로그인 설정

1. https://console.cloud.google.com 접속 → 프로젝트 생성 (또는 기존 프로젝트 선택)
2. 왼쪽 메뉴 → **API 및 서비스** → **OAuth 동의 화면**
   - User Type: **외부** 선택 → 만들기
   - 앱 이름: `업무 관리자`
   - 사용자 지원 이메일: 본인 이메일
   - 개발자 연락처: 본인 이메일
   - 범위 추가: `email`, `profile`, `openid`
   - 테스트 사용자: 본인 이메일 추가 (출시 전까지 필요)
   - 저장 완료
3. 왼쪽 메뉴 → **사용자 인증 정보** → **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
   - 유형: **웹 애플리케이션**
   - 이름: `work-manager`
   - 승인된 리디렉션 URI 추가:
     - `http://localhost:3000/api/auth/google/callback` (로컬 테스트용)
     - `https://your-app.onrender.com/api/auth/google/callback` (배포 후 추가)
   - **만들기** 클릭
4. **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사 (메모)

---

## STEP 3. Render.com — 서버 배포

### 3-1. GitHub에 코드 올리기

```bash
# (아직 안했으면) GitHub 저장소 생성 후
git remote add origin https://github.com/YOUR_USER/work-manager.git
git add -A
git commit -m "업무 관리자 v8.5 — 다중 사용자 버전"
git push -u origin main
```

### 3-2. Render 배포

1. https://render.com 접속 → GitHub 계정으로 가입
2. **New** → **Web Service** → GitHub 저장소 연결
3. 설정:
   - **Name**: `work-manager`
   - **Runtime**: `Docker`
   - **Instance Type**: `Free`
4. **Environment Variables** 추가 (Add Environment Variable):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | (STEP 1에서 복사한 Supabase URI) |
| `JWT_SECRET` | (Generate 클릭 또는 랜덤 문자열 입력) |
| `JWT_REFRESH_SECRET` | (Generate 클릭 또는 랜덤 문자열 입력) |
| `CORS_ORIGIN` | `https://work-manager.onrender.com` |
| `GOOGLE_CLIENT_ID` | (STEP 2에서 복사한 클라이언트 ID) |
| `GOOGLE_CLIENT_SECRET` | (STEP 2에서 복사한 보안 비밀번호) |
| `GOOGLE_CALLBACK_URL` | `https://work-manager.onrender.com/api/auth/google/callback` |

5. **Create Web Service** 클릭 → 자동 빌드 시작 (3~5분)
6. 배포 완료 후 → Google Console로 돌아가서 리디렉션 URI에 실제 URL 추가

### 3-3. 관리자 계정 생성

Render 대시보드 → Shell 탭에서:
```bash
cd /app/server && node scripts/seed-admin.js --email admin@company.com --name 관리자 --password YourPassword1!
```

---

## STEP 4. 접속 확인

- 사이트: `https://work-manager.onrender.com`
- 헬스체크: `https://work-manager.onrender.com/health`
- 로그인: 이메일/비밀번호 또는 **Google로 로그인** 버튼

---

## 로컬 개발 환경

```bash
# 의존성 설치
cd server && npm install

# 환경 변수 (.env 파일 생성)
cp .env.example .env
# .env에서 DATABASE_URL, GOOGLE_CLIENT_ID 등 설정

# DB 마이그레이션 (Supabase SQL Editor에서 이미 실행했으면 스킵)
psql $DATABASE_URL -f ../migrations/001_auth.sql
psql $DATABASE_URL -f ../migrations/002_data.sql
psql $DATABASE_URL -f ../migrations/003_google_oauth.sql

# 관리자 계정 생성
npm run seed -- --email admin@company.com --name 관리자 --password YourPassword1!

# 서버 실행
npm run dev
# → http://localhost:3000
```

---

## Docker Compose (자체 호스팅)

```bash
# .env 파일 설정 후
docker-compose up -d

# 마이그레이션
docker-compose exec db psql -U postgres -d workmanager -f /migrations/001_auth.sql
docker-compose exec db psql -U postgres -d workmanager -f /migrations/002_data.sql
docker-compose exec db psql -U postgres -d workmanager -f /migrations/003_google_oauth.sql

# 관리자 생성
docker-compose exec api npm run seed -- --email admin@company.com --name 관리자 --password YourPassword1!
```

---

## 환경 변수 전체 목록

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | ✅ | Access Token 서명 키 |
| `JWT_REFRESH_SECRET` | ✅ | Refresh Token 서명 키 |
| `PORT` | | 서버 포트 (기본: 3000) |
| `NODE_ENV` | | production / development |
| `CORS_ORIGIN` | | 허용 Origin |
| `GOOGLE_CLIENT_ID` | | Google OAuth2 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | | Google OAuth2 보안 비밀번호 |
| `GOOGLE_CALLBACK_URL` | | Google 콜백 URL |
| `BCRYPT_ROUNDS` | | bcrypt 라운드 (기본: 12) |
| `SMTP_HOST` | | SMTP 호스트 (기본: smtp.gmail.com) |
| `SMTP_PORT` | | SMTP 포트 (기본: 587) |
| `SMTP_USER` | | SMTP 인증 이메일 |
| `SMTP_PASS` | | SMTP 앱 비밀번호 |
| `SMTP_FROM` | | 발신자 표시 |
| `MAX_FILE_SIZE` | | 업로드 제한 (기본: 50MB) |

---

## 백업

```bash
# JSON 백업
npm run backup

# pg_dump (권장)
pg_dump $DATABASE_URL -F c -f backup_$(date +%Y%m%d).dump

# 복원
pg_restore -d $DATABASE_URL backup.dump
```

---

## 보안 체크리스트

- [ ] JWT_SECRET / JWT_REFRESH_SECRET을 충분히 긴 랜덤 문자열로 설정
- [ ] NODE_ENV=production 설정
- [ ] CORS_ORIGIN을 실제 도메인으로 제한
- [ ] HTTPS 적용 (Render/Supabase는 기본 제공)
- [ ] Google OAuth2 — 테스트 → 프로덕션 게시 (동의 화면)
- [ ] 정기 백업 스케줄 설정
- [ ] .env 파일이 Git에 포함되지 않는지 확인

---

## 무료 티어 제한 사항

| 서비스 | 무료 한도 | 주의사항 |
|--------|-----------|---------|
| **Render** | 750시간/월, 512MB RAM | 15분 미사용 시 슬립 (첫 요청 ~30초 대기) |
| **Supabase** | 500MB DB, 2GB 전송 | 1주일 미사용 시 일시정지 (대시보드에서 복구) |
| **Google OAuth2** | 무제한 | 테스트 모드: 100명 제한 (게시하면 해제) |
