FROM node:20-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# API URL은 빌드 타임에 설정 (런타임에 리버스 프록시로 연결)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Production ───
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# standalone 모드가 아닌 경우를 위한 전체 복사
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

EXPOSE 3001

CMD ["npm", "start", "--", "-p", "3001"]
