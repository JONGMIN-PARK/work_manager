FROM node:20-slim

# Chromium + 한글 폰트 설치 (애니웍스 주간일지 다운로드 기능)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer가 시스템 Chromium 사용하도록 설정
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 서버 의존성 설치
COPY server/package.json server/
RUN cd server && npm install --production

# 서버 소스
COPY server/ server/
COPY migrations/ migrations/

# 프론트엔드 정적 파일 (*.css 포함 — 누락 시 style.css 미배포로 반응형 CSS 미적용)
COPY *.html *.js *.css ./

EXPOSE 3000

CMD ["node", "server/server.js"]
