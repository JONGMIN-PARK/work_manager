# Work Manager 온프레미스 설치 가이드

## 시스템 요구사항

- Docker 24+ & Docker Compose v2
- 최소 2GB RAM, 10GB 디스크
- 포트: 8080 (웹), 5432 (DB, 선택)

## 빠른 시작 (5분)

```bash
# 1. 저장소 클론
git clone https://github.com/JONGMIN-PARK/work_manager.git
cd work_manager

# 2. 환경 설정
cp .env.onprem .env
# .env 파일을 열어 JWT_SECRET, DB_PASSWORD 등을 반드시 변경!

# 3. 시작
docker compose -f docker-compose.onprem.yml up -d

# 4. 접속
# http://localhost:8080
```

## 환경 변수 설명

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `DB_PASSWORD` | O | - | PostgreSQL 비밀번호 |
| `JWT_SECRET` | O | - | 액세스 토큰 서명 키 (32바이트 hex) |
| `JWT_REFRESH_SECRET` | O | - | 리프레시 토큰 서명 키 |
| `APP_PORT` | - | 8080 | 웹 접속 포트 |
| `CORS_ORIGIN` | - | http://localhost:8080 | CORS 허용 도메인 |
| `SMTP_HOST` | - | - | 이메일 발송 서버 |
| `TELEGRAM_BOT_TOKEN` | - | - | 텔레그램 봇 토큰 |
| `AI_PROVIDER` | - | - | AI 제공자 (gemini/anthropic) |
| `LICENSE_KEY` | - | - | 엔터프라이즈 라이선스 키 |

### JWT 시크릿 생성

```bash
openssl rand -hex 32
```

## 초기 설정

1. http://localhost:8080 접속
2. 회원가입 (첫 번째 사용자가 관리자)
3. 설정 > 조직 생성 > 팀원 초대

## 라이선스 활성화

엔터프라이즈 라이선스 키를 보유한 경우:

1. 관리자 계정으로 로그인
2. 설정 > 라이선스에서 키 입력
3. SSO, 화이트라벨 등 엔터프라이즈 기능 활성화

## 서비스 관리

```bash
# 상태 확인
docker compose -f docker-compose.onprem.yml ps

# 로그 확인
docker compose -f docker-compose.onprem.yml logs -f api

# 중지
docker compose -f docker-compose.onprem.yml down

# 업데이트
git pull
docker compose -f docker-compose.onprem.yml up -d --build

# DB 백업
docker compose -f docker-compose.onprem.yml exec db pg_dump -U postgres workmanager > backup.sql

# DB 복원
cat backup.sql | docker compose -f docker-compose.onprem.yml exec -T db psql -U postgres workmanager
```

## SSL/HTTPS 설정 (프로덕션)

nginx.conf에서 SSL 인증서를 추가하거나, Traefik/Caddy 등의 리버스 프록시를 앞단에 배치하세요.

```bash
# Let's Encrypt 예시 (Caddy)
# docker-compose.onprem.yml에서 nginx 대신 caddy 사용
caddy reverse-proxy --from yourdomain.com --to localhost:8080
```

## 문제 해결

| 증상 | 해결 |
|------|------|
| DB 연결 실패 | `docker compose logs db`로 상태 확인 |
| 포트 충돌 | `.env`에서 `APP_PORT` 변경 |
| 빌드 실패 | `docker compose build --no-cache` |
| 메모리 부족 | Docker Desktop > Settings > Resources에서 메모리 증가 |
