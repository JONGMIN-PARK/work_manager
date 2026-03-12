FROM node:20-alpine

WORKDIR /app

# 서버 의존성 설치
COPY server/package.json server/
RUN cd server && npm install --production

# 서버 소스
COPY server/ server/
COPY migrations/ migrations/

# 프론트엔드 정적 파일
COPY *.html *.js *.css ./

EXPOSE 3000

CMD ["node", "server/server.js"]
