FROM node:20-slim

# Chromium은 애니웍스 주간일지 다운로드 기능에만 필요 (선택적)
# 빌드 시 --build-arg INSTALL_CHROMIUM=true 로 활성화
ARG INSTALL_CHROMIUM=false

RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-noto-cjk \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Puppeteer가 시스템 Chromium 사용하도록 설정 (Chromium 설치 시에만 유효)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 서버 의존성 설치
COPY server/package.json server/
RUN cd server && npm install --production

# 서버 소스
COPY server/ server/
COPY migrations/ migrations/

# 프론트엔드 정적 파일
COPY *.html *.js ./

EXPOSE 3000

CMD ["node", "server/server.js"]
